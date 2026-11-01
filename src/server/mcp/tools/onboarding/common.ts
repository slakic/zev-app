// Zajednički dio alata za nacrt (Plans/mcp-onboarding-asistent-plan.md, O-A): odgovori alata, izbor nacrta iz opsega
// veze i omotač koji čuva da greška alata nikad ne postane HTTP 401 niti otkrije unutrašnje detalje.
import { t, tf } from "@/lib/i18n";
import type { McpRequestContext } from "@/server/mcp/auth";
import type { McpScope } from "@/lib/mcp/scopes";
import { DraftAccessError, draftAccessFromMcp, type DraftAccess } from "@/server/services/draftAccess";
import { getDraftByAccess, type MyDraft } from "@/server/services/onboarding";
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
