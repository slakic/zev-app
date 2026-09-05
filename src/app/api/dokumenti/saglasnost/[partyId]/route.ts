import { NextRequest, NextResponse } from "next/server";
import { getAuthContext } from "@/server/auth/session";
import { generateEVoteConsentPdf } from "@/server/services/documents";

/** Personalized "Izjava o saglasnosti" for print-and-sign. Owners can fetch only their own. */
export async function GET(req: NextRequest, ctx: { params: Promise<{ partyId: string }> }) {
  const { partyId } = await ctx.params;
  const session = await getAuthContext();
  if (!session) return NextResponse.redirect(new URL("/login", req.url));
  const actor = { userId: session.userId, roles: session.roles, partyId: session.partyId };
  try {
    const buffer = await generateEVoteConsentPdf(actor, partyId);
    return new NextResponse(new Uint8Array(buffer), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `inline; filename="izjava-saglasnosti.pdf"`,
        "Cache-Control": "private, no-store",
      },
    });
  } catch {
    return new NextResponse("Zabranjen pristup.", { status: 403 });
  }
}
