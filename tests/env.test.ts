// src/lib/env.ts validation contract (Plans/deployment-portability-plan.md §2, §9):
// missing/invalid required variables fail with a readable error, defaults match
// today's behavior, and a good config is passed through unchanged. getEnv() caches
// its result at module scope, so each case here re-imports the module fresh via
// vi.resetModules() rather than relying on a shared import.
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

describe("env.ts", () => {
  const savedAppUrl = process.env.APP_URL;
  const savedNodeEnv = process.env.NODE_ENV;

  beforeEach(() => {
    vi.resetModules();
  });

  afterEach(() => {
    process.env.APP_URL = savedAppUrl;
    process.env.NODE_ENV = savedNodeEnv;
    vi.resetModules();
  });

  it("passes through an explicit, valid APP_URL unchanged", async () => {
    process.env.APP_URL = "https://zev.example.com";
    const { getEnv } = await import("@/lib/env");
    expect(getEnv().APP_URL).toBe("https://zev.example.com");
  });

  it("defaults APP_URL to localhost outside production when unset", async () => {
    delete process.env.APP_URL;
    process.env.NODE_ENV = "development";
    const { getEnv } = await import("@/lib/env");
    expect(getEnv().APP_URL).toBe("http://localhost:3000");
  });

  it("throws a readable error when APP_URL is unset in production", async () => {
    delete process.env.APP_URL;
    process.env.NODE_ENV = "production";
    const { getEnv } = await import("@/lib/env");
    expect(() => getEnv()).toThrow(/APP_URL/);
  });

  it("throws a readable error when APP_URL is set but not a valid URL", async () => {
    process.env.APP_URL = "not-a-url";
    const { getEnv } = await import("@/lib/env");
    expect(() => getEnv()).toThrow(/APP_URL/);
  });

  it("memoizes: a later process.env change is not picked up without re-importing", async () => {
    process.env.APP_URL = "https://first.example.com";
    const { getEnv } = await import("@/lib/env");
    expect(getEnv().APP_URL).toBe("https://first.example.com");
    process.env.APP_URL = "https://second.example.com";
    expect(getEnv().APP_URL).toBe("https://first.example.com");
  });
});
