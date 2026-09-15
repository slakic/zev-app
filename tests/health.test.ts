// GET /api/health contract (Plans/deployment-portability-plan.md §8.2): reachable DB
// returns 200 + the app version; nothing about the connection itself is exposed.
import { describe, it, expect } from "vitest";
import { GET } from "@/app/api/health/route";
import pkg from "../package.json";

describe("GET /api/health", () => {
  it("returns 200 with status ok and the app version when the database is reachable", async () => {
    const res = await GET();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ status: "ok", version: pkg.version });
  });
});
