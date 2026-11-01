// Dokaz prava pristupa nacrtu novog ZEV-a (Plans/mcp-onboarding-asistent-plan.md, Faza O-A). `DraftAccess` je
// „žeton" koji nastaje SAMO kroz dva konstruktora ispod — svaki provjerava vlasništvo ili odobren pristup administratora.
// Servis koji čita nacrt (getDraftByAccess) traži takav žeton, pa ga ne može pozvati kod koji prava nije provjerio.
// Ne pravite `DraftAccess` literalom ni `as` pretvaranjem.
import { prisma } from "@/lib/prisma";
import { t } from "@/lib/i18n";
import type { Actor } from "@/server/auth/guards";
import { resolveMcpAccess, type McpAccessCtx } from "@/server/mcp/access";
import type { McpScope } from "@/lib/mcp/scopes";

export type DraftAccessVia = "WIZARD" | "MCP_OWNER" | "MCP_ADMIN";

export type DraftAccess = {
  readonly draftId: string;
  readonly userId: string;
  readonly via: DraftAccessVia;
} & { readonly __brand: "DraftAccess" };

/** Pristup nacrtu nije dozvoljen (ili nacrt više nije u toku); poruka se smije pokazati asistentu. */
export class DraftAccessError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DraftAccessError";
  }
}

function make(draftId: string, userId: string, via: DraftAccessVia): DraftAccess {
  return { draftId, userId, via } as DraftAccess;
}

/** Vlasnik u čarobnjaku: nacrt je njegov i u toku. */
export async function draftAccessForOwner(actor: Pick<Actor, "userId">, draftId: string): Promise<DraftAccess> {
  const d = await prisma.onboardingDraft.findFirst({
    where: { id: draftId, ownerUserId: actor.userId, status: "IN_PROGRESS" },
    select: { id: true },
  });
  if (!d) throw new DraftAccessError(t("onboarding.noDraft"));
  return make(d.id, actor.userId, "WIZARD");
}

/** MCP veza: opseg, vlasništvo ili odobren pristup administratora i stanje nacrta (resolveMcpAccess). */
export async function draftAccessFromMcp(ctx: McpAccessCtx, scope: Extract<McpScope, { kind: "ONBOARDING_DRAFT" }>): Promise<DraftAccess> {
  const res = await resolveMcpAccess(ctx, scope);
  if (!res.ok) throw new DraftAccessError(res.message);
  return make(res.draftId, ctx.userId, res.via);
}
