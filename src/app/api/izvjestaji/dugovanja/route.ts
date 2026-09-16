import { NextRequest, NextResponse } from "next/server";
import { getAuthContext } from "@/server/auth/session";
import { generateOwnerDebtReportPdf } from "@/server/services/documents";
import { endOfDay } from "@/lib/i18n";

// generateOwnerDebtReportPdf aggregates balances across every owner before rendering the
// PDF — can be tight for a larger ZEV against a platform's default (e.g. Vercel's 10s).
// No-op on Docker; respected on Vercel (Plans/deployment-portability-plan.md §8.4).
export const maxDuration = 60;

export async function GET(req: NextRequest) {
  const session = await getAuthContext();
  if (!session) return NextResponse.redirect(new URL("/login", req.url));
  const actor = { userId: session.userId, roles: session.roles, partyId: session.partyId, zevId: session.zevId, isSuperAdmin: session.isSuperAdmin };
  if (!actor.roles.some((r) => r === "PRESIDENT" || r === "ACCOUNTANT")) {
    return new NextResponse("Zabranjen pristup.", { status: 403 });
  }
  const sp = req.nextUrl.searchParams;
  const asOf = sp.get("asOf") ? endOfDay(sp.get("asOf")!) : new Date();
  const partyIds = sp.getAll("owner").filter(Boolean);
  const { row, buffer } = await generateOwnerDebtReportPdf(actor, { asOf, partyIds: partyIds.length > 0 ? partyIds : undefined });
  return new NextResponse(new Uint8Array(buffer), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${row.number}.pdf"`,
    },
  });
}
