// Preuzimanja uz uvoz nacrta za vlasnika nacrta: obrazac.csv, primjer.json, nacrt.json. Uvijek nad SVOJIM nacrtom u toku.
import { NextRequest, NextResponse } from "next/server";
import { getAuthContext } from "@/server/auth/session";
import { getMyDraft } from "@/server/services/onboarding";
import { draftAccessForOwner } from "@/server/services/draftAccess";
import { importFileResponse } from "@/server/http/onboardingImportFiles";
import { isPrefetchRequest, prefetchIgnored } from "@/server/http/prefetch";

export async function GET(req: NextRequest, ctx: { params: Promise<{ fajl: string }> }) {
  if (isPrefetchRequest(req)) return prefetchIgnored();
  const session = await getAuthContext();
  if (!session) return NextResponse.redirect(new URL("/login", req.url));
  const draft = await getMyDraft({ userId: session.userId });
  if (!draft) return new NextResponse("Nema nacrta u toku.", { status: 403 });
  const access = await draftAccessForOwner({ userId: session.userId }, draft.id);
  const { fajl } = await ctx.params;
  return importFileResponse(fajl, access);
}
