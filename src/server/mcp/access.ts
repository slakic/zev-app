// Provjera opsega veze asistenta na SVAKOM pozivu alata (Plans/mcp-platforma-plan.md §3). Opseg koji je
// veza dobila pri pravljenju ne znači da važi i danas: nacrt je u međuvremenu mogao biti objavljen ili
// odbačen. Zato se stanje čita iz baze svaki put. Jedina izmjena je `lastUsedAt` pristupa administratora (najviše
// jednom u 5 minuta).
import { prisma } from "@/lib/prisma";
import { t, tf } from "@/lib/i18n";
import { parseDraftData } from "@/lib/onboarding/draft";
import type { McpScope } from "@/lib/mcp/scopes";

/** Naziv nacrta za prikaz: naziv ZEV-a koji je klijent upisao, inače radni naziv iz poziva. */
export function draftScopeLabel(draft: { data: unknown; invite: { workingName: string } }): string {
  return parseDraftData(draft.data).zev.legalName.trim() || draft.invite.workingName;
}

/** Koliko često se smije upisati lastUsedAt pristupa (isti obrazac kao touchConnection u auth.ts). */
const LAST_USED_THROTTLE_MS = 5 * 60 * 1000;

/** Aktivan pristup administratora nacrtu (red postoji i nije uklonjen). Provjera super admina je posao pozivaoca. */
async function findActiveAdminAccess(userId: string, draftId: string) {
  return prisma.onboardingDraftAdminAccess.findFirst({
    where: { draftId, adminUserId: userId, revokedAt: null },
    select: { id: true, lastUsedAt: true },
  });
}

/** Fire-and-forget: poziv alata ne čeka upis, a `where` ponavlja uslov da paralelni pozivi u istom prozoru ne naprave višak upisa. */
export function touchDraftAdminAccess(access: { id: string; lastUsedAt: Date | null }, now = new Date()) {
  if (access.lastUsedAt && now.getTime() - access.lastUsedAt.getTime() <= LAST_USED_THROTTLE_MS) return;
  prisma.onboardingDraftAdminAccess
    .updateMany({
      where: { id: access.id, OR: [{ lastUsedAt: null }, { lastUsedAt: { lt: new Date(now.getTime() - LAST_USED_THROTTLE_MS) } }] },
      data: { lastUsedAt: now },
    })
    .catch(() => {});
}

export type McpAccessVia = "MCP_OWNER" | "MCP_ADMIN";

export type McpAccessResult =
  | { ok: true; draftId: string; via: McpAccessVia }
  | { ok: false; message: string };

/** Podaci o vezi koji su potrebni za provjeru opsega (podskup McpRequestContext). */
export type McpAccessCtx = { userId: string; isSuperAdmin: boolean; scopes: McpScope[] };

/**
 * Smije li veza (korisnik `userId`) sada da radi sa nacrtom `scope`? Vraća razlog koji se može pokazati
 * asistentu. Vlasnik nacrta ima prednost; super admin smije samo uz aktivan pristup (OnboardingDraftAdminAccess).
 */
export async function resolveMcpAccess(
  ctx: McpAccessCtx,
  scope: Extract<McpScope, { kind: "ONBOARDING_DRAFT" }>
): Promise<McpAccessResult> {
  const granted = ctx.scopes.some((s) => s.kind === "ONBOARDING_DRAFT" && s.draftId === scope.draftId);
  const draft = await prisma.onboardingDraft.findUnique({
    where: { id: scope.draftId },
    select: { id: true, status: true, ownerUserId: true, data: true, invite: { select: { workingName: true } } },
  });
  const label = draft ? draftScopeLabel(draft) : t("assistants.scope.unknownDraft");
  if (!granted) return { ok: false, message: tf("assistants.errors.noScope", { naziv: label }) };
  if (!draft) return { ok: false, message: tf("assistants.errors.draftClosed", { naziv: label }) };
  // Tuđ nacrt se ne otkriva ni statusom: bez prava je odgovor isti kao za nacrt bez opsega.
  if (draft.ownerUserId === ctx.userId) {
    if (draft.status !== "IN_PROGRESS") return { ok: false, message: tf("assistants.errors.draftClosed", { naziv: label }) };
    return { ok: true, draftId: draft.id, via: "MCP_OWNER" };
  }
  if (ctx.isSuperAdmin) {
    const access = await findActiveAdminAccess(ctx.userId, draft.id);
    if (access) {
      if (draft.status !== "IN_PROGRESS") return { ok: false, message: tf("assistants.errors.draftClosed", { naziv: label }) };
      touchDraftAdminAccess(access);
      return { ok: true, draftId: draft.id, via: "MCP_ADMIN" };
    }
  }
  return { ok: false, message: tf("assistants.errors.noScope", { naziv: label }) };
}

export type DescribedScope = { scope: McpScope; label: string; active: boolean; via: "OWNER" | "ADMIN" | null };

/** Čitljiv opis opsega veze i da li još važi (nacrt u toku i njegov vlasnik, ili super admin sa pristupom). Ništa ne mijenja. */
export async function describeScopes(ctx: { userId: string; isSuperAdmin: boolean }, scopes: McpScope[]): Promise<DescribedScope[]> {
  const draftIds = scopes.flatMap((s) => (s.kind === "ONBOARDING_DRAFT" ? [s.draftId] : []));
  const [drafts, accessRows] = draftIds.length
    ? await Promise.all([
        prisma.onboardingDraft.findMany({
          where: { id: { in: draftIds } },
          select: { id: true, status: true, ownerUserId: true, data: true, invite: { select: { workingName: true } } },
        }),
        ctx.isSuperAdmin
          ? prisma.onboardingDraftAdminAccess.findMany({ where: { draftId: { in: draftIds }, adminUserId: ctx.userId, revokedAt: null }, select: { draftId: true } })
          : Promise.resolve([]),
      ])
    : [[], []];
  return scopes.map((scope) => {
    // (Jedini opseg do sada je ONBOARDING_DRAFT; novi opsezi dobijaju svoju granu ovdje.)
    const draft = drafts.find((d) => d.id === scope.draftId);
    const inProgress = Boolean(draft && draft.status === "IN_PROGRESS");
    const via: DescribedScope["via"] =
      draft && inProgress
        ? draft.ownerUserId === ctx.userId
          ? "OWNER"
          : ctx.isSuperAdmin && accessRows.some((r) => r.draftId === draft.id)
            ? "ADMIN"
            : null
        : null;
    return {
      scope,
      label: draft ? draftScopeLabel(draft) : t("assistants.scope.unknownDraft"),
      active: via !== null,
      via,
    };
  });
}
