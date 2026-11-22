import { NextRequest, NextResponse } from "next/server";
import { getAuthContext } from "@/server/auth/session";
import { ForbiddenError } from "@/server/auth/guards";
import { isPrefetchRequest, prefetchIgnored } from "@/server/http/prefetch";
import { LEDGER_CSV_TYPES, ledgerReportCsv, reportRange, type LedgerCsvType } from "@/server/services/ledgerReports";
import { asOfDay, RECON_CSV_TYPES, reconciliationCsv, type ReconCsvType } from "@/server/services/ledgerReconciliation";

/** CSV izvještaja iz knjige (B3a §2.4): `?type=…&from=…&to=…` uz parametre izvještaja. Prava provjerava servis. */
export async function GET(req: NextRequest) {
  if (isPrefetchRequest(req)) return prefetchIgnored(); // never generate/audit on a <Link> prefetch
  const session = await getAuthContext();
  if (!session) return NextResponse.redirect(new URL("/login", req.url));
  const actor = { userId: session.userId, roles: session.roles, partyId: session.partyId, zevId: session.zevId, isSuperAdmin: session.isSuperAdmin, label: session.displayName };
  const sp = req.nextUrl.searchParams;
  const type = sp.get("type") as LedgerCsvType;
  const recon = sp.get("type") as ReconCsvType;
  try {
    // Izvještaji „na dan” i godišnji pregled (B3b).
    if (RECON_CSV_TYPES.includes(recon)) {
      const asOf = asOfDay(sp.get("dan"));
      const csv = await reconciliationCsv(actor, recon, { asOf, year: sp.get("godina") });
      const suffix = recon === "godisnji" ? sp.get("godina") ?? "" : asOf;
      return new NextResponse(csv, {
        headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="knjiga-${recon}-${suffix}.csv"` },
      });
    }
    if (!LEDGER_CSV_TYPES.includes(type)) return new NextResponse("Nepoznat izvještaj.", { status: 400 });
    const range = await reportRange(actor, sp.get("from"), sp.get("to"));
    const csv = await ledgerReportCsv(actor, type, {
      from: range.from, to: range.to,
      accountId: sp.get("konto"), id: sp.get("id"), kind: sp.get("kind"),
      purposeId: sp.get("namjena"), projectId: sp.get("projekat"), withSummary: sp.get("prikaz") === "zbirno",
    });
    return new NextResponse(csv, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="knjiga-${type}-${range.from}-${range.to}.csv"`,
      },
    });
  } catch (e) {
    if (e instanceof ForbiddenError) return new NextResponse("Zabranjen pristup.", { status: 403 });
    return new NextResponse(e instanceof Error ? e.message : "Greška", { status: 400 });
  }
}
