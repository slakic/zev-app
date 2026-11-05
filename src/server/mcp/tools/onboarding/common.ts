// Zajednički dio alata za nacrt (Plans/mcp-onboarding-asistent-plan.md, O-A/O-B/O-C): odgovori alata, izbor nacrta iz
// opsega veze, omotač upisa (audit, brava, greške grupe) i omotač koji čuva da greška alata nikad ne postane HTTP 401 niti
// otkrije unutrašnje detalje.
import { t, tf } from "@/lib/i18n";
import type { McpRequestContext } from "@/server/mcp/auth";
import type { McpScope } from "@/lib/mcp/scopes";
import { DraftAccessError, draftAccessFromMcp, type DraftAccess } from "@/server/services/draftAccess";
import { DraftBatchError, StaleDraftError, getDraftByAccess, type MyDraft, type PartyChoice } from "@/server/services/onboarding";
import type { OnboardingDraftData } from "@/lib/onboarding/draft";
import { audit } from "@/server/audit";
import { displayNameFor } from "@/server/auth/displayName";
import { draftScopeLabel } from "@/server/mcp/access";
import { prisma } from "@/lib/prisma";
import { z } from "zod";

export type ToolResult = { content: { type: "text"; text: string }[]; structuredContent?: Record<string, unknown>; isError?: boolean };

/** Greška alata (isError): asistent je vidi i može reći korisniku; protokol i HTTP ostaju uspješni. */
export function toolError(message: string): ToolResult {
  return { isError: true, content: [{ type: "text", text: message }] };
}

export function toolJson(payload: Record<string, unknown>): ToolResult {
  return { content: [{ type: "text", text: JSON.stringify(payload) }], structuredContent: payload };
}

/** Ulaz `draft_id` zajednički za alate nacrta. */
export const draftIdInput = z.string().min(1).max(100).optional();

type DraftScope = Extract<McpScope, { kind: "ONBOARDING_DRAFT" }>;

/**
 * Nacrt na koji se poziv odnosi: `draft_id` mora biti među opsezima veze; bez njega se uzima jedini opseg, a za više
 * njih greška sa spiskom (nazivi, ne id-jevi tuđih nacrta — samo opsezi koje veza već ima).
 */
export async function pickDraftScope(ctx: McpRequestContext, draftId?: string): Promise<DraftScope> {
  const scopes = ctx.scopes.filter((s): s is DraftScope => s.kind === "ONBOARDING_DRAFT");
  if (draftId) {
    const hit = scopes.find((s) => s.draftId === draftId);
    if (!hit) throw new DraftAccessError(tf("assistants.errors.noScope", { naziv: t("assistants.scope.unknownDraft") }));
    return hit;
  }
  if (scopes.length === 0) throw new DraftAccessError(t("assistants.errors.noDraftScope"));
  if (scopes.length === 1) return scopes[0];
  const drafts = await prisma.onboardingDraft.findMany({
    where: { id: { in: scopes.map((s) => s.draftId) } },
    select: { id: true, data: true, invite: { select: { workingName: true } } },
  });
  const list = scopes.map((s) => {
    const d = drafts.find((x) => x.id === s.draftId);
    return `${s.draftId} (${d ? draftScopeLabel(d) : t("assistants.scope.unknownDraft")})`;
  });
  throw new DraftAccessError(tf("assistants.errors.draftIdRequired", { spisak: list.join(", ") }));
}

/** Pozivi alata nad nacrtom: izbor opsega, provjera prava na svakom pozivu, čitanje nacrta. */
export async function withDraft(
  ctx: McpRequestContext,
  draftId: string | undefined,
  fn: (draft: MyDraft & { label: string }, access: DraftAccess) => Promise<ToolResult>
): Promise<ToolResult> {
  try {
    const scope = await pickDraftScope(ctx, draftId);
    const access = await draftAccessFromMcp(ctx, scope);
    const draft = await getDraftByAccess(access);
    return await fn(draft, access);
  } catch (e) {
    if (e instanceof DraftAccessError) return toolError(e.message);
    console.error("[mcp] greška alata", e instanceof Error ? e.name : "nepoznata");
    return toolError(t("assistants.errors.internal"));
  }
}

export function accessLabel(access: DraftAccess): "OWNER" | "ADMIN" {
  return access.via === "MCP_ADMIN" ? "ADMIN" : "OWNER";
}

// ---- Alati za upis (Faze O-B i O-C) ------------------------------------------------------------------------------

/** Ulaz `expected_version` zajednički za alate upisa: verzija iz get_draft / get_onboarding_status (optimistička brava). */
export const expectedVersionInput = z.number().int().nonnegative();

/** Lice za udio ili organ: postojeće (ključ iz get_draft ili "president") ili novo — tačno jedno od dva. */
export const partyInput = {
  party_key: z.string().min(1).max(100).optional(),
  new_party: z
    .object({
      kind: z.enum(["PERSON", "ORGANIZATION"]),
      first_name: z.string().max(100).optional(),
      last_name: z.string().max(100).optional(),
      org_name: z.string().max(200).optional(),
      org_id_number: z.string().max(50).optional(),
      email: z.string().max(200).optional(),
      phone: z.string().max(50).optional(),
    })
    .optional(),
};

export function partyChoice(input: { party_key?: string; new_party?: z.infer<NonNullable<typeof partyInput.new_party>> }): PartyChoice {
  if (Boolean(input.party_key) === Boolean(input.new_party)) throw new DraftAccessError(t("assistants.errors.partyRequired"));
  if (input.party_key) return { partyKey: input.party_key };
  const p = input.new_party!;
  return {
    partyKey: "new",
    newParty: { kind: p.kind, firstName: p.first_name, lastName: p.last_name, orgName: p.org_name, orgIdNumber: p.org_id_number, email: p.email, phone: p.phone },
  };
}

/** Greška pravila iz servisa (obična `Error` sa porukom za korisnika) — za razliku od neočekivane greške (baza, kod). */
function isRuleError(e: unknown): e is Error {
  return e instanceof Error && Object.getPrototypeOf(e) === Error.prototype;
}

type CreatedItem = { key: string } & Record<string, unknown>;

export type DraftWriteSpec<Args> = {
  /** Naziv alata (ulazi u audit `mcp.call`). */
  tool: string;
  /** Broj stavki za audit (bez sadržaja). */
  items: (args: Args) => number;
  /** Stavke odjeljka čiji se novi ključevi vraćaju asistentu (da ih koristi u sljedećim pozivima bez ponovnog čitanja). */
  created?: (data: OnboardingDraftData) => CreatedItem[];
  run: (access: DraftAccess, draft: MyDraft & { label: string }, args: Args) => Promise<{ version: number; result?: Record<string, unknown> }>;
};

/**
 * Poziv alata koji mijenja nacrt: isto što i withDraft (opseg i pravo na svakom pozivu), zatim izmjena kroz servis
 * čarobnjaka i audit `mcp.call` (alat, broj stavki, veza, opseg — bez sadržaja; platforma §4). Greške pravila, zastarjela
 * verzija i greške grupe idu asistentu kao greške alata; ništa nije upisano.
 */
export async function runDraftWrite<Args>(
  ctx: McpRequestContext,
  draftId: string | undefined,
  args: Args,
  spec: DraftWriteSpec<Args>
): Promise<ToolResult> {
  return withDraft(ctx, draftId, async (draft, access) => {
    try {
      const before = new Set(spec.created ? spec.created(draft.data).map((x) => x.key) : []);
      const { version, result } = await spec.run(access, draft, args);
      await audit({ userId: access.userId, label: (await displayNameFor(access.userId)) || undefined }, {
        action: "mcp.call",
        targetType: "OnboardingDraft",
        targetId: access.draftId,
        after: { tool: spec.tool, items: spec.items(args), connectionId: ctx.connectionId, scope: `ONBOARDING_DRAFT:${access.draftId}`, via: access.via },
      });
      let created: CreatedItem[] | undefined;
      if (spec.created) {
        const after = await getDraftByAccess(access);
        created = spec.created(after.data).filter((x) => !before.has(x.key));
      }
      return toolJson({ ok: true, version, ...(created ? { created } : {}), ...result });
    } catch (e) {
      if (e instanceof StaleDraftError) {
        const cur = await prisma.onboardingDraft.findUnique({ where: { id: access.draftId }, select: { version: true } });
        return toolError(tf("assistants.errors.stale", { verzija: cur?.version ?? "?" }));
      }
      if (e instanceof DraftBatchError) {
        const payload = { error: e.message, issues: e.issues };
        return { isError: true, content: [{ type: "text", text: JSON.stringify(payload) }], structuredContent: payload };
      }
      if (isRuleError(e)) return toolError(e.message);
      throw e;
    }
  });
}

/** Napomene alata (MCP annotations) za upis: nije samo čitanje, ne izlazi van aplikacije; brisanje je označeno. */
export function writeAnnotations(destructive = false) {
  return { readOnlyHint: false, destructiveHint: destructive, idempotentHint: false, openWorldHint: false };
}
