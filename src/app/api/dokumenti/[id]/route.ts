import { NextRequest, NextResponse } from "next/server";
import { getAuthContext } from "@/server/auth/session";
import { readDocumentFile } from "@/server/services/documents";

export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const session = await getAuthContext();
  if (!session) return NextResponse.redirect(new URL("/login", _req.url));
  try {
    const { doc, buffer } = await readDocumentFile(
      { userId: session.userId, roles: session.roles, partyId: session.partyId },
      id
    );
    return new NextResponse(new Uint8Array(buffer), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `inline; filename="${doc.number.replace(/[^\w-]/g, "_")}.pdf"`,
        "Cache-Control": "private, no-store",
      },
    });
  } catch {
    return new NextResponse("Zabranjen pristup ili dokument ne postoji.", { status: 403 });
  }
}
