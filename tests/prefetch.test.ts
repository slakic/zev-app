// v2.41.0: a Next.js <Link> prefetch must never run a download route (it moved owners' e-vote
// consent to "Izjava preuzeta" on mere hover). isPrefetchRequest recognises every prefetch shape.
import { describe, it, expect } from "vitest";
import { isPrefetchRequest } from "@/server/http/prefetch";

const url = "http://localhost:3000/api/dokumenti/saglasnost/p1";

describe("isPrefetchRequest", () => {
  it("recognises Next.js router prefetches and RSC requests", () => {
    expect(isPrefetchRequest(new Request(url, { headers: { "Next-Router-Prefetch": "1" } }))).toBe(true);
    expect(isPrefetchRequest(new Request(url, { headers: { RSC: "1" } }))).toBe(true);
    expect(isPrefetchRequest(new Request(`${url}?_rsc=abc12`))).toBe(true);
    expect(isPrefetchRequest(new Request(url, { headers: { "Sec-Purpose": "prefetch" } }))).toBe(true);
  });

  it("lets a real download through", () => {
    expect(isPrefetchRequest(new Request(url))).toBe(false);
    expect(isPrefetchRequest(new Request(`${url}?from=2026-01-01`, { headers: { Accept: "application/pdf" } }))).toBe(false);
  });
});
