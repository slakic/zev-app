import { NextRequest, NextResponse } from "next/server";
import { getAuthContext } from "@/server/auth/session";
import { generateOwnerStatementPdf, readDocumentFile } from "@/server/services/documents";

/** Generate + download an owner statement. Owners can fetch only their own. */
export async function GET(req: NextRequest, ctx: { params: Promise<{ partyId: string }> }) {
  const { partyId } = await ctx.params;
  const session = await getAuthContext();
  if (!session) return NextResponse.redirect(new URL("/login", req.url));
  const actor = { userId: session.userId, roles: session.roles, partyId: session.partyId };
  try {
    const doc = await generateOwnerStatementPdf(actor, partyId);
    const { buffer } = await readDocumentFile(actor, doc.id);
    return new NextResponse(new Uint8Array(buffer), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `inline; filename="kartica.pdf"`,
        "Cache-Control": "private, no-store",
      },
    });
  } catch {
    return new NextResponse("Zabranjen pristup.", { status: 403 });
  }
}
