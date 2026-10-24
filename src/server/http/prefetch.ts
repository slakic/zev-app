// Next.js <Link> prefetches its target (on hover, and when it scrolls into view) with an ordinary
// GET carrying the RSC prefetch headers / `_rsc` query. Our download routes have side effects on GET
// (the e-vote consent form moves NONE -> PENDING, the owner card stores a Document version,
// downloads and exports are audited), so a prefetch must never run them (v2.40.1). Links to
// /api/* are plain <a> now (ui.tsx NavLink); this is the second line of defence.

/** True for a Next.js router prefetch / RSC request rather than a real download. */
export function isPrefetchRequest(req: Request): boolean {
  const h = req.headers;
  if (h.get("next-router-prefetch") === "1") return true;
  if (h.get("rsc") === "1") return true;
  const purpose = (h.get("purpose") ?? h.get("sec-purpose") ?? "").toLowerCase();
  if (purpose.includes("prefetch")) return true;
  return new URL(req.url).searchParams.has("_rsc");
}

/** Empty response for a prefetch: nothing is generated, stored or audited. */
export function prefetchIgnored(): Response {
  return new Response(null, { status: 204, headers: { "Cache-Control": "no-store" } });
}
