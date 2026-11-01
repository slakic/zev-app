// Provjera opsega veze asistenta na SVAKOM pozivu alata (Plans/mcp-platforma-plan.md §3). Opseg koji je
// veza dobila pri pravljenju ne znači da važi i danas: nacrt je u međuvremenu mogao biti objavljen ili
// odbačen. Zato se stanje čita iz baze svaki put, a ništa se ne mijenja.
import { prisma } from "@/lib/prisma";
import { t, tf } from "@/lib/i18n";
import { parseDraftData } from "@/lib/onboarding/draft";
import type { McpScope } from "@/lib/mcp/scopes";

/** Naziv nacrta za prikaz: naziv ZEV-a koji je klijent upisao, inače radni naziv iz poziva. */
export function draftScopeLabel(draft: { data: unknown; invite: { workingName: string } }): string {
  return parseDraftData(draft.data).zev.legalName.trim() || draft.invite.workingName;
}

export type McpAccessResult =
  | { ok: true; draftId: string; via: "MCP_OWNER" }
  | { ok: false; message: string };

/**
 * Smije li veza (korisnik `userId`) sada da radi sa nacrtom `scope`? Vraća razlog koji se može pokazati
 * asistentu. Vlasnik nacrta je jedini put u P-A.
 */
export async function resolveMcpAccess(
  ctx: { userId: string; scopes: McpScope[] },
  scope: Extract<McpScope, { kind: "ONBOARDING_DRAFT" }>
): Promise<McpAccessResult> {
  const granted = ctx.scopes.some((s) => s.kind === "ONBOARDING_DRAFT" && s.draftId === scope.draftId);
  const draft = await prisma.onboardingDraft.findUnique({
    where: { id: scope.draftId },
    select: { id: true, status: true, ownerUserId: true, data: true, invite: { select: { workingName: true } } },
  });
  const label = draft ? draftScopeLabel(draft) : t("assistants.scope.unknownDraft");
  if (!granted) return { ok: false, message: tf("assistants.errors.noScope", { naziv: label }) };
  if (!draft || draft.status !== "IN_PROGRESS") return { ok: false, message: tf("assistants.errors.draftClosed", { naziv: label }) };
  if (draft.ownerUserId === ctx.userId) return { ok: true, draftId: draft.id, via: "MCP_OWNER" };
  // O-A: OnboardingDraftAdminAccess — super admin sa odobrenim pristupom tuđem nacrtu (model nastaje u O-A).
  return { ok: false, message: tf("assistants.errors.noScope", { naziv: label }) };
}

export type DescribedScope = { scope: McpScope; label: string; active: boolean };

/** Čitljiv opis opsega veze i da li još važi (nacrt u toku i njegov vlasnik). Ništa ne mijenja. */
export async function describeScopes(userId: string, scopes: McpScope[]): Promise<DescribedScope[]> {
  const draftIds = scopes.flatMap((s) => (s.kind === "ONBOARDING_DRAFT" ? [s.draftId] : []));
  const drafts = draftIds.length
    ? await prisma.onboardingDraft.findMany({
        where: { id: { in: draftIds } },
        select: { id: true, status: true, ownerUserId: true, data: true, invite: { select: { workingName: true } } },
      })
    : [];
  return scopes.map((scope) => {
    // (Jedini opseg u P-A je ONBOARDING_DRAFT; novi opsezi dobijaju svoju granu ovdje.)
    const draft = drafts.find((d) => d.id === scope.draftId);
    return {
      scope,
      label: draft ? draftScopeLabel(draft) : t("assistants.scope.unknownDraft"),
      active: Boolean(draft && draft.status === "IN_PROGRESS" && draft.ownerUserId === userId),
    };
  });
}
