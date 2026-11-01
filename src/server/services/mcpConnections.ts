// Veze asistenata (MCP) sa nalogom korisnika (Plans/mcp-platforma-plan.md §2). Veza pripada NALOGU, ne
// ZEV-u: radi i za klijenta u onboardingu koji još nema ZEV, pa se audit piše bez zevId (kao poziv).
// Token se pokazuje jednom; ovdje se čuva samo sha256. Opseg se bira među ponuđenima — server ga
// ponovo izvodi iz baze i nikad ne vjeruje draftId-u koji dođe iz forme.
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { audit } from "@/server/audit";
import { requireAnyUser, type Actor } from "@/server/auth/guards";
import { generateToken, sha256 } from "@/server/auth/tokens";
import { t } from "@/lib/i18n";
import { MCP_EXPIRY_DAYS, MCP_TOKEN_PREFIX, parseScopes, type McpScope } from "@/lib/mcp/scopes";
import { describeScopes, draftScopeLabel, type DescribedScope } from "@/server/mcp/access";
import type { McpClient } from "@/generated/prisma/client";

const DAY_MS = 24 * 60 * 60 * 1000;

/** Audit veza ne pripada nijednom ZEV-u, i kad korisnik ima aktivan ZEV (nalog je iznad ZEV-a). */
function accountActor(actor: Actor) {
  return { userId: actor.userId, label: actor.label };
}

export type OfferedScope = { key: string; scope: McpScope; label: string };

/** Opsezi koje korisnik trenutno smije da dodijeli vezi: nacrti novog ZEV-a koje sam popunjava. */
export async function listOfferedScopes(actor: Actor): Promise<OfferedScope[]> {
  requireAnyUser(actor);
  const drafts = await prisma.onboardingDraft.findMany({
    where: { ownerUserId: actor.userId, status: "IN_PROGRESS" },
    select: { id: true, data: true, invite: { select: { workingName: true } } },
    orderBy: { createdAt: "desc" },
  });
  // O-A: nacrti kojima super admin ima odobren pristup (OnboardingDraftAdminAccess).
  return drafts.map((d) => ({
    key: `draft:${d.id}`,
    scope: { kind: "ONBOARDING_DRAFT" as const, draftId: d.id },
    label: draftScopeLabel(d),
  }));
}

const createSchema = z.object({
  name: z.string().trim().min(1, t("assistants.errors.nameRequired")).max(80, t("assistants.errors.nameTooLong")),
  client: z.enum(["CLAUDE", "OPENAI", "OTHER"]),
  scopeKey: z.string().max(100),
  days: z.coerce.number().refine((n) => (MCP_EXPIRY_DAYS as readonly number[]).includes(n), t("assistants.errors.daysInvalid")),
});

export type CreateMcpConnectionInput = { name: string; client: McpClient; scopeKey: string; days: number };

/** Pravi vezu i vraća token koji se prikazuje JEDNOM. Token ni hash nikad ne ulaze u audit. */
export async function createMcpConnection(
  actor: Actor,
  input: CreateMcpConnectionInput
): Promise<{ connection: { id: string; name: string; expiresAt: Date }; token: string }> {
  requireAnyUser(actor);
  const parsed = createSchema.safeParse(input);
  if (!parsed.success) throw new Error(parsed.error.issues[0]?.message ?? t("assistants.errors.invalid"));
  const { name, client, scopeKey, days } = parsed.data;

  let scopes: McpScope[] = [];
  if (scopeKey !== "none") {
    const offered = (await listOfferedScopes(actor)).find((o) => o.key === scopeKey);
    if (!offered) throw new Error(t("assistants.errors.scopeNotOffered"));
    scopes = [offered.scope];
  }

  const token = MCP_TOKEN_PREFIX + generateToken(32);
  const expiresAt = new Date(Date.now() + days * DAY_MS);
  const connection = await prisma.$transaction(async (tx) => {
    const row = await tx.mcpConnection.create({
      data: { userId: actor.userId, name, client, kind: "TOKEN", scopes, tokenHash: sha256(token), expiresAt },
      select: { id: true, name: true, expiresAt: true },
    });
    await audit(
      accountActor(actor),
      {
        action: "mcp.connection.create",
        targetType: "McpConnection",
        targetId: row.id,
        after: { name, client, scopes, expiresAt: expiresAt.toISOString() },
      },
      tx
    );
    return row;
  });
  return { connection, token };
}

export type McpConnectionListRow = {
  id: string;
  name: string;
  client: McpClient;
  createdAt: Date;
  expiresAt: Date;
  lastUsedAt: Date | null;
  scopes: DescribedScope[];
};

/** Aktivne veze korisnika (nije prekinuta i nije istekla). Hash tokena se ne čita. */
export async function listMyMcpConnections(actor: Actor): Promise<McpConnectionListRow[]> {
  requireAnyUser(actor);
  const rows = await prisma.mcpConnection.findMany({
    where: { userId: actor.userId, revokedAt: null, expiresAt: { gt: new Date() } },
    select: { id: true, name: true, client: true, createdAt: true, expiresAt: true, lastUsedAt: true, scopes: true },
    orderBy: { createdAt: "desc" },
  });
  return Promise.all(
    rows.map(async ({ scopes, ...r }) => ({ ...r, scopes: await describeScopes(actor.userId, parseScopes(scopes)) }))
  );
}

/** Prekida vezu (samo svoju): asistent odmah gubi pristup, a prekinuta veza se ne može ponovo uključiti. */
export async function revokeMcpConnection(actor: Actor, id: string): Promise<{ name: string }> {
  requireAnyUser(actor);
  return prisma.$transaction(async (tx) => {
    const row = await tx.mcpConnection.findFirst({ where: { id, userId: actor.userId, revokedAt: null }, select: { name: true } });
    const res = row
      ? await tx.mcpConnection.updateMany({
          where: { id, userId: actor.userId, revokedAt: null },
          data: { revokedAt: new Date(), revokedById: actor.userId },
        })
      : { count: 0 };
    if (!row || res.count === 0) throw new Error(t("assistants.errors.notFound"));
    await audit(
      accountActor(actor),
      { action: "mcp.connection.revoke", targetType: "McpConnection", targetId: id, before: { name: row.name } },
      tx
    );
    return { name: row.name };
  });
}
