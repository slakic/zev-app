// Public (link-token) download of a proposal attachment, so the voter can read what the acknowledgement says he read
// before sending it (V-N05). Every failure is the same generic 404 — nothing says whether the link or the file was wrong.
import { NextRequest, NextResponse } from "next/server";
import { headers } from "next/headers";
import { readVotingAttachment } from "@/server/services/meetings";
import { sha256 } from "@/server/auth/tokens";
import { isPrefetchRequest, prefetchIgnored } from "@/server/http/prefetch";

const notAvailable = () => new NextResponse("Prilog nije dostupan.", { status: 404, headers: { "Cache-Control": "no-store" } });

export async function GET(req: NextRequest, ctx: { params: Promise<{ token: string; attachmentId: string }> }) {
  if (isPrefetchRequest(req)) return prefetchIgnored(); // never audit a <Link> prefetch
  const { token, attachmentId } = await ctx.params;
  const h = await headers();
  const ip = h.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null;
  try {
    const res = await readVotingAttachment({ tokenPlain: token, attachmentId, ipHash: ip ? sha256(ip) : null });
    if (!res.ok) return notAvailable();
    return new NextResponse(new Uint8Array(res.buffer), {
      headers: {
        "Content-Type": res.attachment.mime || "application/octet-stream",
        "Content-Disposition": `inline; filename="${res.attachment.filename.replace(/[^\w.\-]/g, "_")}"`,
        "Cache-Control": "private, no-store",
        "X-Robots-Tag": "noindex",
      },
    });
  } catch {
    return notAvailable();
  }
}
