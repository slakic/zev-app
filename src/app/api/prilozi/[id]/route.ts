import { NextRequest, NextResponse } from "next/server";
import { getAuthContext } from "@/server/auth/session";
import { readAttachmentFile } from "@/server/services/attachments";

/** Download a user-uploaded Attachment (proof of ownership, scanned invoice, minutes...). */
export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const session = await getAuthContext();
  if (!session) return NextResponse.redirect(new URL("/login", _req.url));
  try {
    const { attachment, buffer } = await readAttachmentFile(
      { userId: session.userId, roles: session.roles, partyId: session.partyId },
      id
    );
    return new NextResponse(new Uint8Array(buffer), {
      headers: {
        "Content-Type": attachment.mime || "application/octet-stream",
        "Content-Disposition": `inline; filename="${attachment.filename.replace(/[^\w.\-]/g, "_")}"`,
        "Cache-Control": "private, no-store",
      },
    });
  } catch {
    return new NextResponse("Zabranjen pristup ili fajl ne postoji.", { status: 403 });
  }
}
