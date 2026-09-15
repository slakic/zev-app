import { NextRequest, NextResponse } from "next/server";
import { getAuthContext } from "@/server/auth/session";
import { generateFinancialReportPdf } from "@/server/services/documents";

export async function GET(req: NextRequest) {
  const session = await getAuthContext();
  if (!session) return NextResponse.redirect(new URL("/login", req.url));
  const actor = { userId: session.userId, roles: session.roles, partyId: session.partyId, zevId: session.zevId, isSuperAdmin: session.isSuperAdmin };
  if (!actor.roles.some((r) => r === "PRESIDENT" || r === "ACCOUNTANT")) {
    return new NextResponse("Zabranjen pristup.", { status: 403 });
  }
  const sp = req.nextUrl.searchParams;
  const range = {
    from: sp.get("from") ? new Date(sp.get("from")!) : undefined,
    to: sp.get("to") ? new Date(sp.get("to")!) : undefined,
  };
  const { row, buffer } = await generateFinancialReportPdf(actor, range);
  return new NextResponse(new Uint8Array(buffer), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${row.number}.pdf"`,
    },
  });
}
