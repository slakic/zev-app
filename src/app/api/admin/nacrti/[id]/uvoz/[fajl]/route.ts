// Preuzimanja uz uvoz nacrta za super admina: samo uz AKTIVAN pristup nacrtu (kartica „Asistent” na /admin/nacrti/[id]).
import { NextRequest, NextResponse } from "next/server";
import { getAuthContext } from "@/server/auth/session";
import { DraftAccessError, draftAccessForAdminWeb } from "@/server/services/draftAccess";
import { importFileResponse } from "@/server/http/onboardingImportFiles";
import { isPrefetchRequest, prefetchIgnored } from "@/server/http/prefetch";

export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string; fajl: string }> }) {
  if (isPrefetchRequest(req)) return prefetchIgnored();
  const session = await getAuthContext();
  if (!session) return NextResponse.redirect(new URL("/login", req.url));
  const { id, fajl } = await ctx.params;
  try {
    const access = await draftAccessForAdminWeb({ userId: session.userId, isSuperAdmin: session.isSuperAdmin }, id);
    return await importFileResponse(fajl, access);
  } catch (e) {
    if (e instanceof DraftAccessError) return new NextResponse(e.message, { status: 403 });
    throw e;
  }
}
