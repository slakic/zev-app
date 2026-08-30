import { NextRequest, NextResponse } from "next/server";
import { getAuthContext } from "@/server/auth/session";
import { cashFlowReport, incomeExpenseReport, receivablesReport, supplierReport, toCsv } from "@/server/services/reports";
import { audit } from "@/server/audit";

export async function GET(req: NextRequest) {
  const session = await getAuthContext();
  if (!session) return NextResponse.redirect(new URL("/login", req.url));
  const actor = { userId: session.userId, roles: session.roles, partyId: session.partyId };
  if (!actor.roles.some((r) => r === "PRESIDENT" || r === "ACCOUNTANT")) {
    return new NextResponse("Zabranjen pristup.", { status: 403 });
  }
  const sp = req.nextUrl.searchParams;
  const type = sp.get("type") ?? "cashflow";
  const range = {
    from: sp.get("from") ? new Date(sp.get("from")!) : undefined,
    to: sp.get("to") ? new Date(sp.get("to")!) : undefined,
  };
  let csv = "";
  if (type === "cashflow") {
    csv = toCsv(await cashFlowReport(actor, range));
  } else if (type === "incexp") {
    csv = toCsv(await incomeExpenseReport(actor, range));
  } else if (type === "receivables") {
    const r = await receivablesReport(actor, range.to ?? new Date());
    csv = toCsv(r.rows as unknown as Record<string, unknown>[]);
  } else if (type === "suppliers") {
    csv = toCsv(await supplierReport(actor, range));
  } else {
    return new NextResponse("Nepoznat izvještaj.", { status: 400 });
  }
  await audit(actor, { action: "report.export", targetType: "Report", targetId: type });
  return new NextResponse(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="izvjestaj-${type}.csv"`,
    },
  });
}
