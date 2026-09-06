import { NextRequest, NextResponse } from "next/server";
import { getAuthContext } from "@/server/auth/session";
import { generateOwnerDebtReportPdf } from "@/server/services/documents";
import { endOfDay } from "@/lib/i18n";

export async function GET(req: NextRequest) {
  const session = await getAuthContext();
  if (!session) return NextResponse.redirect(new URL("/login", req.url));
  const actor = { userId: session.userId, roles: session.roles, partyId: session.partyId };
  if (!actor.roles.some((r) => r === "PRESIDENT" || r === "ACCOUNTANT")) {
    return new NextResponse("Zabranjen pristup.", { status: 403 });
  }
  const sp = req.nextUrl.searchParams;
  const asOf = sp.get("asOf") ? endOfDay(sp.get("asOf")!) : new Date();
  const partyIds = sp.getAll("owner").filter(Boolean);
  const stored = await generateOwnerDebtReportPdf(actor, { asOf, partyIds: partyIds.length > 0 ? partyIds : undefined });
  const fs = await import("node:fs");
  const buffer = fs.readFileSync(stored.filePath);
  return new NextResponse(new Uint8Array(buffer), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${stored.number}.pdf"`,
    },
  });
}
