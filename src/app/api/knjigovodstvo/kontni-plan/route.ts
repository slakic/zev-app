import { NextRequest, NextResponse } from "next/server";
import { getAuthContext } from "@/server/auth/session";
import { exportChartFile } from "@/server/services/chartExport";
import { ForbiddenError } from "@/server/auth/guards";
import { isPrefetchRequest, prefetchIgnored } from "@/server/http/prefetch";

/** Izvoz kontnog plana ZEV-a: `?format=xlsx` (podrazumijevano) ili `?format=pdf`. Prava provjerava servis. */
export async function GET(req: NextRequest) {
  if (isPrefetchRequest(req)) return prefetchIgnored(); // never generate/audit on a <Link> prefetch
  const session = await getAuthContext();
  if (!session) return NextResponse.redirect(new URL("/login", req.url));
  const actor = { userId: session.userId, roles: session.roles, partyId: session.partyId, zevId: session.zevId, isSuperAdmin: session.isSuperAdmin, label: session.displayName };
  const format = req.nextUrl.searchParams.get("format") === "pdf" ? "pdf" : "xlsx";
  try {
    const file = await exportChartFile(actor, { kind: "zev" }, format);
    return new NextResponse(new Uint8Array(file.body), {
      headers: { "Content-Type": file.contentType, "Content-Disposition": `attachment; filename="${file.filename}"` },
    });
  } catch (e) {
    if (e instanceof ForbiddenError) return new NextResponse("Zabranjen pristup.", { status: 403 });
    return new NextResponse(e instanceof Error ? e.message : "Greška", { status: 400 });
  }
}
