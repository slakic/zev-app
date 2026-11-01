// HTTP sloj OAuth-a za MCP (Faza P-B): metapodaci, zastavice, CORS, 401 sa resource_metadata, DCR/token/revoke rute i
// cijeli tok do poziva alata `whoami`. Obrazac tests/mcp-route.test.ts: zastavice u env + resetModules + dinamički uvoz
// (getEnv() kešira).
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { prisma } from "@/lib/prisma";
import { generateToken } from "@/server/auth/tokens";
import { pkceS256 } from "@/lib/mcp/oauth";
import { createSuperAdminActor } from "./helpers";

const saved = { mcp: process.env.MCP_ENABLED, oauth: process.env.MCP_OAUTH_ENABLED };
const APP = "http://localhost:3000";
const LOOPBACK = "http://127.0.0.1:9999/callback";

async function load(mcp: "true" | "false", oauth: "true" | "false") {
  process.env.MCP_ENABLED = mcp;
  process.env.MCP_OAUTH_ENABLED = oauth;
  vi.resetModules();
  return {
    prm: await import("@/app/.well-known/oauth-protected-resource/route"),
    prmApi: await import("@/app/.well-known/oauth-protected-resource/api/mcp/route"),
    as: await import("@/app/.well-known/oauth-authorization-server/route"),
    register: await import("@/app/oauth/register/route"),
    token: await import("@/app/oauth/token/route"),
    revoke: await import("@/app/oauth/revoke/route"),
    mcp: await import("@/app/api/mcp/route"),
    approve: await import("@/server/mcp/oauth/authorize"),
    limits: await import("@/server/mcp/rateLimit"),
  };
}

afterEach(() => {
  for (const [k, v] of [["MCP_ENABLED", saved.mcp], ["MCP_OAUTH_ENABLED", saved.oauth]] as const) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  vi.resetModules();
});

const form = (body: Record<string, string>, extra: Record<string, string> = {}) =>
  new Request(`${APP}/oauth/token`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded", ...extra },
    body: new URLSearchParams(body).toString(),
  });
const jsonReq = (url: string, body: unknown, extra: Record<string, string> = {}) =>
  new Request(url, { method: "POST", headers: { "content-type": "application/json", ...extra }, body: JSON.stringify(body) });

const INIT = {
  jsonrpc: "2.0", id: 1, method: "initialize",
  params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "test", version: "1.0.0" } },
};
const rpc = (body: unknown, token?: string) =>
  new Request(`${APP}/api/mcp`, {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json, text/event-stream", ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(body),
  });

describe("metadata endpoints", () => {
  beforeEach(() => vi.resetModules());

  it("serves PRM (both URLs) and AS metadata built only from APP_URL", async () => {
    const r = await load("true", "true");
    for (const route of [r.prm, r.prmApi]) {
      const res = await route.GET();
      expect(res.status).toBe(200);
      expect(res.headers.get("access-control-allow-origin")).toBe("*");
      expect(res.headers.get("cache-control")).toBe("public, max-age=300");
      expect(await res.json()).toEqual({
        resource: `${APP}/api/mcp`,
        authorization_servers: [APP],
        bearer_methods_supported: ["header"],
        scopes_supported: ["mcp"],
        resource_name: "ZEV upravnik",
      });
    }
    const as = await (await r.as.GET()).json();
    expect(as).toMatchObject({
      issuer: APP,
      authorization_endpoint: `${APP}/oauth/authorize`,
      token_endpoint: `${APP}/oauth/token`,
      registration_endpoint: `${APP}/oauth/register`,
      revocation_endpoint: `${APP}/oauth/revoke`,
      code_challenge_methods_supported: ["S256"],
      token_endpoint_auth_methods_supported: ["none"],
      authorization_response_iss_parameter_supported: true,
    });
    expect(as.client_id_metadata_document_supported).toBeUndefined();
    expect(as.scopes_supported).toContain("offline_access");
  });

  it("answers CORS preflight with 204 and echoes requested headers", async () => {
    const r = await load("true", "true");
    const res = await r.token.OPTIONS(new Request(`${APP}/oauth/token`, { method: "OPTIONS", headers: { "access-control-request-headers": "content-type, x-foo" } }));
    expect(res.status).toBe(204);
    expect(res.headers.get("access-control-allow-origin")).toBe("*");
    expect(res.headers.get("access-control-allow-headers")).toBe("content-type, x-foo");
    expect(res.headers.get("access-control-allow-methods")).toContain("POST");
  });

  it("returns 404 on every OAuth route when the flag is off (and when MCP itself is off)", async () => {
    for (const [mcp, oauth] of [["true", "false"], ["false", "true"]] as const) {
      const r = await load(mcp, oauth);
      expect((await r.prm.GET()).status).toBe(404);
      expect((await r.prmApi.GET()).status).toBe(404);
      expect((await r.as.GET()).status).toBe(404);
      expect((await r.register.POST(jsonReq(`${APP}/oauth/register`, { redirect_uris: [LOOPBACK] }))).status).toBe(404);
      expect((await r.token.POST(form({ grant_type: "refresh_token" }))).status).toBe(404);
      expect((await r.revoke.POST(form({ token: "x", client_id: "y" }))).status).toBe(404);
      expect((await r.token.OPTIONS(new Request(`${APP}/oauth/token`, { method: "OPTIONS" }))).status).toBe(404);
    }
  });
});

describe("/api/mcp 401", () => {
  it("points to the PRM with scope when OAuth is on, adds invalid_token only for a presented token", async () => {
    const r = await load("true", "true");
    const none = await r.mcp.POST(rpc(INIT));
    expect(none.status).toBe(401);
    expect(none.headers.get("www-authenticate")).toBe(`Bearer resource_metadata="${APP}/.well-known/oauth-protected-resource/api/mcp", scope="mcp"`);
    expect(await none.json()).toEqual({ error: "invalid_token" });
    const bad = await r.mcp.POST(rpc(INIT, "zev_mcp_at_" + "B".repeat(43)));
    expect(bad.status).toBe(401);
    expect(bad.headers.get("www-authenticate")).toContain('error="invalid_token"');
    expect(bad.headers.get("www-authenticate")).toContain("resource_metadata=");
  });

  it("keeps the Phase P-A challenge (no resource_metadata) when OAuth is off", async () => {
    const r = await load("true", "false");
    const res = await r.mcp.POST(rpc(INIT));
    expect(res.status).toBe(401);
    expect(res.headers.get("www-authenticate")).toBe('Bearer realm="zev-upravnik"');
    expect(await res.json()).toEqual({ error: "unauthorized" });
  });

  it("does not count header-less discovery requests toward the per-IP failure limit", async () => {
    const r = await load("true", "true");
    r.limits.resetMcpRateLimits();
    const ip = { "x-forwarded-for": "203.0.113.7" };
    const mk = (token?: string) => {
      const req = rpc(INIT, token);
      for (const [k, v] of Object.entries(ip)) req.headers.set(k, v);
      return req;
    };
    for (let i = 0; i < 30; i++) expect((await r.mcp.POST(mk())).status).toBe(401);
    // Pogrešni tokeni se broje: 20 neuspjeha, pa 429.
    let last = 0;
    for (let i = 0; i < 21; i++) last = (await r.mcp.POST(mk("zev_mcp_at_" + "C".repeat(43)))).status;
    expect(last).toBe(429);
  });
});

describe("/oauth/register", () => {
  it("registers a DCR client (201), is CORS-enabled and never caches", async () => {
    const r = await load("true", "true");
    const res = await r.register.POST(jsonReq(`${APP}/oauth/register`, { redirect_uris: [LOOPBACK], client_name: "Ruta", token_endpoint_auth_method: "none" }));
    expect(res.status).toBe(201);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(res.headers.get("access-control-allow-origin")).toBe("*");
    expect(await res.json()).toMatchObject({ client_name: "Ruta", redirect_uris: [LOOPBACK], token_endpoint_auth_method: "none", grant_types: ["authorization_code", "refresh_token"], response_types: ["code"] });
  });

  it("rejects bad input with RFC 7591 errors", async () => {
    const r = await load("true", "true");
    const bad = await r.register.POST(jsonReq(`${APP}/oauth/register`, { redirect_uris: ["https://evil.example/cb"] }));
    expect(bad.status).toBe(400);
    expect(await bad.json()).toMatchObject({ error: "invalid_redirect_uri" });
    const notJson = await r.register.POST(new Request(`${APP}/oauth/register`, { method: "POST", headers: { "content-type": "text/plain" }, body: "x" }));
    expect(notJson.status).toBe(400);
    const big = await r.register.POST(jsonReq(`${APP}/oauth/register`, { redirect_uris: [LOOPBACK], client_name: "x".repeat(9000) }));
    expect(big.status).toBe(400);
    expect(await big.json()).toMatchObject({ error: "invalid_client_metadata" });
    const broken = await r.register.POST(new Request(`${APP}/oauth/register`, { method: "POST", headers: { "content-type": "application/json" }, body: "{" }));
    expect(broken.status).toBe(400);
  });

  it("rate-limits registration per IP after 60 requests an hour", async () => {
    const r = await load("true", "true");
    r.limits.resetMcpRateLimits();
    let last = 0;
    for (let i = 0; i < 61; i++) last = (await r.register.POST(jsonReq(`${APP}/oauth/register`, { redirect_uris: ["https://evil.example"] }, { "x-forwarded-for": "198.51.100.9" }))).status;
    expect(last).toBe(429);
  });
});

describe("/oauth/token, /oauth/revoke and the full flow", () => {
  it("rejects JSON bodies and unknown grant types, accepts forms", async () => {
    const r = await load("true", "true");
    r.limits.resetMcpRateLimits();
    const json = await r.token.POST(new Request(`${APP}/oauth/token`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ grant_type: "refresh_token" }) }));
    expect(json.status).toBe(400);
    expect(await json.json()).toMatchObject({ error: "invalid_request" });
    const grant = await r.token.POST(form({ grant_type: "password", client_id: "x" }));
    expect(await grant.json()).toMatchObject({ error: "unsupported_grant_type" });
    const unknown = await r.token.POST(form({ grant_type: "refresh_token", client_id: "zev_cl_nepoznat", refresh_token: "x" }));
    expect(unknown.status).toBe(401);
    expect(await unknown.json()).toMatchObject({ error: "invalid_client" });
    expect(unknown.headers.get("cache-control")).toBe("no-store");
  });

  it("runs register → authorize → token → whoami → refresh → revoke → 401", async () => {
    const r = await load("true", "true");
    r.limits.resetMcpRateLimits();
    const user = await createSuperAdminActor("oauth-flow");

    const reg = await (await r.register.POST(jsonReq(`${APP}/oauth/register`, { redirect_uris: [LOOPBACK], client_name: "Tok test" }))).json();
    const verifier = generateToken(32);
    const url = await r.approve.approveAuthorization(
      user,
      { client_id: reg.client_id, redirect_uri: LOOPBACK, response_type: "code", code_challenge: pkceS256(verifier), code_challenge_method: "S256", state: "s" },
      { name: "Tok veza", scopeKey: "none", days: 7 }
    );
    const code = new URL(url).searchParams.get("code")!;

    const tokRes = await r.token.POST(form({ grant_type: "authorization_code", code, client_id: reg.client_id, redirect_uri: LOOPBACK, code_verifier: verifier, resource: `${APP}/api/mcp` }));
    expect(tokRes.status).toBe(200);
    expect(tokRes.headers.get("cache-control")).toBe("no-store");
    const tokens = await tokRes.json();
    expect(tokens).toMatchObject({ token_type: "Bearer", scope: "mcp" });

    const call = await r.mcp.POST(rpc({ jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "whoami", arguments: {} } }, tokens.access_token));
    expect(call.status).toBe(200);
    const text = await call.text();
    expect(text).toContain("Tok veza");
    expect(text).not.toContain(tokens.access_token);

    const ref = await r.token.POST(form({ grant_type: "refresh_token", refresh_token: tokens.refresh_token, client_id: reg.client_id }));
    expect(ref.status).toBe(200);
    const next = await ref.json();
    expect((await r.mcp.POST(rpc(INIT, next.access_token))).status).toBe(200);

    const rev = await r.revoke.POST(form({ token: next.refresh_token, client_id: reg.client_id }));
    expect(rev.status).toBe(200);
    expect((await r.mcp.POST(rpc(INIT, next.access_token))).status).toBe(401);
    expect((await r.mcp.POST(rpc(INIT, tokens.access_token))).status).toBe(401);
    // Opoziv nepoznatog tokena je i dalje 200.
    expect((await r.revoke.POST(form({ token: "zev_mcp_rt_" + "z".repeat(43), client_id: reg.client_id }))).status).toBe(200);
    expect(await prisma.mcpConnection.count({ where: { userId: user.userId, revokedAt: { not: null } } })).toBe(1);
  });

  it("rate-limits the token endpoint per IP after 120 requests", async () => {
    const r = await load("true", "true");
    r.limits.resetMcpRateLimits();
    let last = 0;
    for (let i = 0; i < 121; i++) last = (await r.token.POST(form({ grant_type: "password", client_id: "x" }, { "x-forwarded-for": "192.0.2.55" }))).status;
    expect(last).toBe(429);
  });
});
