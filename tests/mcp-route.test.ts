// /api/mcp (Plans/mcp-platforma-plan.md, P-A): ruta iza MCP_ENABLED, token u Authorization zaglavlju, alati po
// opsegu veze. Precedent: tests/health.test.ts (poziva handler direktno). getEnv() kešira, pa se modul
// uvozi svjež poslije postavljanja MCP_ENABLED.
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createMcpConnection } from "@/server/services/mcpConnections";
import { createSuperAdminActor } from "./helpers";

const savedFlag = process.env.MCP_ENABLED;

async function loadRoute(flag: "true" | "false") {
  process.env.MCP_ENABLED = flag;
  vi.resetModules();
  return import("@/app/api/mcp/route");
}

function rpc(body: unknown, token?: string, extra: Record<string, string> = {}) {
  return new Request("http://localhost:3000/api/mcp", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...extra,
    },
    body: JSON.stringify(body),
  });
}

/** Tijelo odgovora: običan JSON ili jedan SSE događaj (stariji, „legacy" put SDK-a odgovara kao `event: message`). */
async function body(res: Response): Promise<any> { // eslint-disable-line @typescript-eslint/no-explicit-any
  const text = await res.text();
  const data = text.startsWith("event:") ? text.split("\n").find((l) => l.startsWith("data:"))!.slice(5).trim() : text;
  return JSON.parse(data);
}

const INIT = {
  jsonrpc: "2.0",
  id: 1,
  method: "initialize",
  params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "test", version: "1.0.0" } },
};

describe("/api/mcp", () => {
  beforeEach(() => {
    process.env.MCP_ENABLED = "true";
  });
  afterEach(() => {
    if (savedFlag === undefined) delete process.env.MCP_ENABLED;
    else process.env.MCP_ENABLED = savedFlag;
    vi.resetModules();
  });

  it("returns 404 while MCP_ENABLED is off", async () => {
    const { POST } = await loadRoute("false");
    const res = await POST(rpc(INIT, "zev_mcp_" + "A".repeat(43)));
    expect(res.status).toBe(404);
  });

  it("returns 401 with a Bearer challenge (and no resource metadata) for a missing or unknown token", async () => {
    const { POST } = await loadRoute("true");
    for (const token of [undefined, "zev_mcp_" + "B".repeat(43), "nije-token"]) {
      const res = await POST(rpc(INIT, token));
      expect(res.status).toBe(401);
      expect(res.headers.get("www-authenticate")).toBe('Bearer realm="zev-upravnik"');
      expect(await res.json()).toEqual({ error: "unauthorized" });
    }
  });

  it("serves initialize, tools/list (only whoami) and a whoami call that leaks no secrets", async () => {
    const admin = await createSuperAdminActor("mcp-route");
    const { token } = await createMcpConnection(admin, { name: "Rutni test", client: "OTHER", scopeKey: "none", days: 7 });
    const { POST } = await loadRoute("true");

    const init = await POST(rpc(INIT, token));
    expect(init.status).toBe(200);
    expect(JSON.stringify(await body(init))).toContain("zev-upravnik");

    const list = await POST(rpc({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} }, token));
    expect(list.status).toBe(200);
    const listed = await body(list);
    expect(listed.result.tools.map((t: { name: string }) => t.name)).toEqual(["whoami"]);

    const call = await POST(rpc({ jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "whoami", arguments: {} } }, token));
    expect(call.status).toBe(200);
    const result = await body(call);
    const raw = JSON.stringify(result);
    const payload = result.result.structuredContent;
    expect(payload).toMatchObject({
      user: { displayName: expect.any(String) },
      connection: { name: "Rutni test", client: "OTHER", expiresAt: expect.any(String) },
      scopes: [],
    });
    expect(raw).not.toContain(token);
    expect(raw).not.toContain(admin.userId);
    expect(raw).not.toMatch(/@platform\.test/);
  });

  it("rate-limits a single connection after 120 calls per minute", async () => {
    const admin = await createSuperAdminActor("mcp-route-rl");
    const { token } = await createMcpConnection(admin, { name: "Limit", client: "OTHER", scopeKey: "none", days: 7 });
    const { POST } = await loadRoute("true");
    const ping = { jsonrpc: "2.0", id: 9, method: "ping" };
    let last = 0;
    for (let i = 0; i < 121; i++) last = (await POST(rpc(ping, token))).status;
    expect(last).toBe(429);
  });
});
