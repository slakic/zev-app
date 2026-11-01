// OAuth 2.1 za MCP (Faza P-B, Plans/mcp-platforma-plan.md §5): čista pravila (oauth.ts), registracija klijenata,
// autorizacija, razmjena koda, rotacija refresh tokena, opoziv i CIMD. Pravi test baza; HTTP sloj je u
// mcp-oauth-routes.test.ts. Zastavice se postavljaju prije prvog getEnv() (keš).
process.env.MCP_ENABLED = "true";
process.env.MCP_OAUTH_ENABLED = "true";

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { prisma } from "@/lib/prisma";
import { generateToken, sha256 } from "@/server/auth/tokens";
import {
  CIMD_ADVERTISED,
  OAUTH_ACCESS_PREFIX,
  OAUTH_REFRESH_PREFIX,
  buildAsMetadata,
  buildPrm,
  canonicalResource,
  clientFromRedirect,
  isAllowedRedirectUri,
  isCimdClientId,
  isSafeOAuthNext,
  pkceS256,
  redirectUriMatches,
  resourceMatches,
} from "@/lib/mcp/oauth";
import { DCR_DAILY_UNUSED_CAP, registerDcrClient, resolveClient } from "@/server/mcp/oauth/clients";
import { approveAuthorization, denyAuthorization, validateAuthorizeRequest } from "@/server/mcp/oauth/authorize";
import { exchangeAuthorizationCode, refreshAccessToken, revokeOAuthToken } from "@/server/mcp/oauth/token";
import { runOAuthCleanup } from "@/server/mcp/oauth/cleanup";
import { verifyMcpToken } from "@/server/mcp/auth";
import { listMyMcpConnections, revokeMcpConnection } from "@/server/services/mcpConnections";
import { resetMcpRateLimits } from "@/server/mcp/rateLimit";
import type { Actor } from "@/server/auth/guards";
import { createSuperAdminActor } from "./helpers";

const APP = "http://localhost:3000";
const RESOURCE = `${APP}/api/mcp`;
const LOOPBACK = "http://127.0.0.1:9999/callback";

beforeEach(() => resetMcpRateLimits());

// ---------------------------------------------------------------------------------------------------------
describe("oauth.ts (čista pravila)", () => {
  it("allows only the fixed assistant callbacks and loopback; rejects everything else", () => {
    for (const ok of [
      "https://claude.ai/api/mcp/auth_callback",
      "https://claude.com/api/mcp/auth_callback",
      "https://chatgpt.com/connector_platform_oauth_redirect",
      "https://chatgpt.com/connector/oauth/abc_DEF-123",
      "http://localhost:8080/cb",
      "http://127.0.0.1/callback",
      "http://[::1]:5555/x?y=1",
    ]) expect(isAllowedRedirectUri(ok), ok).toBe(true);
    for (const bad of [
      "https://evil.example/cb",
      "http://claude.ai/api/mcp/auth_callback",
      "https://claude.ai/api/mcp/auth_callback#frag",
      "https://claude.ai/api/mcp/auth_callback/",
      "https://claude.ai.evil.example/api/mcp/auth_callback",
      "https://chatgpt.com/connector/oauth/",
      "https://chatgpt.com/connector/oauth/a/b",
      "http://example.com/cb",
      "http://localhost.evil.example/cb",
      "http://user:pw@localhost/cb",
      "http://localhost/cb#x",
      "javascript:alert(1)",
      "claude://cb",
      "",
      42,
    ]) expect(isAllowedRedirectUri(bad), String(bad)).toBe(false);
  });

  it("ignores the loopback port but nothing else when matching redirect URIs", () => {
    expect(redirectUriMatches("http://127.0.0.1/callback", "http://127.0.0.1:51234/callback")).toBe(true);
    expect(redirectUriMatches("http://127.0.0.1:9999/callback", "http://127.0.0.1:1111/callback")).toBe(true);
    expect(redirectUriMatches("http://127.0.0.1/callback", "http://127.0.0.1:51234/other")).toBe(false);
    expect(redirectUriMatches("http://127.0.0.1/callback", "http://localhost:51234/callback")).toBe(false);
    expect(redirectUriMatches("https://claude.ai/api/mcp/auth_callback", "https://claude.ai/api/mcp/auth_callback?x=1")).toBe(false);
  });

  it("maps callbacks to assistant kinds", () => {
    expect(clientFromRedirect("https://claude.ai/api/mcp/auth_callback")).toBe("CLAUDE");
    expect(clientFromRedirect("https://chatgpt.com/connector_platform_oauth_redirect")).toBe("OPENAI");
    expect(clientFromRedirect(LOOPBACK)).toBe("OTHER");
  });

  it("canonicalizes the resource and ignores one trailing slash and case of scheme/host", () => {
    expect(canonicalResource("https://zev.example.com/")).toBe("https://zev.example.com/api/mcp");
    expect(resourceMatches("https://ZEV.example.com/api/mcp/", "https://zev.example.com")).toBe(true);
    expect(resourceMatches("https://zev.example.com/api/mcp", "https://zev.example.com")).toBe(true);
    expect(resourceMatches("https://zev.example.com/api/mcp?x=1", "https://zev.example.com")).toBe(false);
    expect(resourceMatches("https://zev.example.com/api", "https://zev.example.com")).toBe(false);
    expect(resourceMatches("https://other.example.com/api/mcp", "https://zev.example.com")).toBe(false);
  });

  it("computes S256 PKCE (RFC 7636 appendix B vector)", () => {
    expect(pkceS256("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk")).toBe("E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM");
  });

  it("accepts only /oauth/authorize of this app as login `next`", () => {
    for (const bad of ["//evil.example", "/\\evil.example", "https://evil.example/oauth/authorize", "/oauth/authorizeX", "/nalog", "/", "", "oauth/authorize", "/oauth/authorize/../x", null, 5]) {
      expect(isSafeOAuthNext(bad, APP), String(bad)).toBe(false);
    }
    expect(isSafeOAuthNext("/oauth/authorize?client_id=a&redirect_uri=http%3A%2F%2F127.0.0.1%3A1%2Fcb", APP)).toBe(true);
    expect(isSafeOAuthNext("/oauth/authorize", APP)).toBe(true);
  });

  it("builds metadata: S256 only, public clients, iss support, CIMD unadvertised", () => {
    const as = buildAsMetadata("https://zev.example.com/");
    expect(as.issuer).toBe("https://zev.example.com");
    expect(as.code_challenge_methods_supported).toEqual(["S256"]);
    expect(as.token_endpoint_auth_methods_supported).toEqual(["none"]);
    expect(as.authorization_response_iss_parameter_supported).toBe(true);
    expect("client_id_metadata_document_supported" in as).toBe(CIMD_ADVERTISED);
    expect(CIMD_ADVERTISED).toBe(false);
    expect(buildPrm("https://zev.example.com")).toMatchObject({
      resource: "https://zev.example.com/api/mcp",
      authorization_servers: ["https://zev.example.com"],
    });
  });

  it("recognizes CIMD client ids only on allowlisted https hosts with a path", () => {
    expect(isCimdClientId("https://claude.ai/oauth/mcp-oauth-client-metadata")).toBe(true);
    expect(isCimdClientId("https://claude.ai/")).toBe(false);
    expect(isCimdClientId("https://evil.example/client.json")).toBe(false);
    expect(isCimdClientId("http://claude.ai/client.json")).toBe(false);
    expect(isCimdClientId("https://claude.ai.evil.example/client.json")).toBe(false);
    expect(isCimdClientId("https://claude.ai/a/../b")).toBe(false);
    expect(isCimdClientId("zev_cl_abc")).toBe(false);
  });
});

// ---------------------------------------------------------------------------------------------------------
async function register(redirect = LOOPBACK, name = "Test klijent") {
  const r = await registerDcrClient({ redirect_uris: [redirect], client_name: name }, "iphash");
  if (!r.ok) throw new Error(`registracija nije uspjela: ${r.error}`);
  return r.response;
}

function pkce() {
  const verifier = generateToken(32);
  return { verifier, challenge: pkceS256(verifier) };
}

function authParams(clientId: string, challenge: string, redirect = LOOPBACK, extra: Record<string, string | undefined> = {}) {
  return {
    client_id: clientId,
    redirect_uri: redirect,
    response_type: "code",
    code_challenge: challenge,
    code_challenge_method: "S256",
    state: "st-1",
    ...extra,
  };
}

async function newActor(tag: string): Promise<Actor> {
  return createSuperAdminActor(tag);
}

/** Cijeli tok do razmjene koda; vraća sve što testovi trebaju. */
async function connect(tag: string, opts: { redirect?: string; days?: number } = {}) {
  const actor = await newActor(tag);
  const redirect = opts.redirect ?? LOOPBACK;
  const client = await register(redirect);
  const { verifier, challenge } = pkce();
  const url = await approveAuthorization(actor, authParams(client.client_id, challenge, redirect), { name: "Moj Claude", scopeKey: "none", days: opts.days ?? 30 });
  const code = new URL(url).searchParams.get("code")!;
  const res = await exchangeAuthorizationCode({ code, clientId: client.client_id, redirectUri: redirect, codeVerifier: verifier });
  if (!res.ok) throw new Error(`razmjena nije uspjela: ${res.error}`);
  const conn = await prisma.mcpConnection.findFirstOrThrow({ where: { userId: actor.userId, kind: "OAUTH" } });
  return { actor, client, verifier, challenge, code, redirect, tokens: res.body, conn };
}

describe("registerDcrClient", () => {
  it("accepts claude.ai, ChatGPT and loopback callbacks and never issues a secret", async () => {
    for (const uri of ["https://claude.ai/api/mcp/auth_callback", "https://chatgpt.com/connector/oauth/abc123", LOOPBACK]) {
      const r = await registerDcrClient({ redirect_uris: [uri], client_name: "X", token_endpoint_auth_method: "client_secret_basic" }, null);
      expect(r.ok).toBe(true);
      if (r.ok) {
        expect(r.response.token_endpoint_auth_method).toBe("none");
        expect(r.response.client_id.startsWith("zev_cl_")).toBe(true);
        expect(JSON.stringify(r.response)).not.toMatch(/secret/);
      }
    }
  });

  it("rejects bad redirects, too many, wrong shape and unsupported grants", async () => {
    const bad = (body: unknown) => registerDcrClient(body, null);
    expect(await bad({ redirect_uris: ["https://evil.example/cb"] })).toMatchObject({ ok: false, error: "invalid_redirect_uri" });
    expect(await bad({ redirect_uris: ["http://example.com/cb"] })).toMatchObject({ ok: false, error: "invalid_redirect_uri" });
    expect(await bad({ redirect_uris: ["https://claude.ai/api/mcp/auth_callback#x"] })).toMatchObject({ ok: false, error: "invalid_redirect_uri" });
    expect(await bad({ redirect_uris: [] })).toMatchObject({ ok: false, error: "invalid_redirect_uri" });
    expect(await bad({ redirect_uris: Array.from({ length: 6 }, (_, i) => `http://127.0.0.1:${9000 + i}/cb`) })).toMatchObject({ ok: false, error: "invalid_redirect_uri" });
    expect(await bad({ redirect_uris: [LOOPBACK], grant_types: ["client_credentials"] })).toMatchObject({ ok: false, error: "invalid_client_metadata" });
    expect(await bad({ redirect_uris: [LOOPBACK], response_types: ["token"] })).toMatchObject({ ok: false, error: "invalid_client_metadata" });
    expect(await bad("nije objekat")).toMatchObject({ ok: false, error: "invalid_client_metadata" });
  });

  it("strips control characters and truncates the self-asserted name", async () => {
    const r = await registerDcrClient({ redirect_uris: [LOOPBACK], client_name: "Evil\u0000\n\tname " + "x".repeat(300) }, null);
    expect(r.ok && r.response.client_name).toBeTruthy();
    if (r.ok) {
      expect(r.response.client_name).not.toMatch(/[\u0000-\u001f]/);
      expect(r.response.client_name.length).toBeLessThanOrEqual(100);
    }
  });

  it("audits the registration without an actor, tokens or raw IP", async () => {
    const r = await register("https://claude.ai/api/mcp/auth_callback", "Audit klijent");
    const ev = await prisma.auditEvent.findFirstOrThrow({ where: { action: "mcp.oauth.client_register", after: { path: ["clientName"], equals: "Audit klijent" } } });
    expect(ev.actorId).toBeNull();
    expect(ev.ipHash).toBe("iphash");
    expect(JSON.stringify(ev.after)).toContain("claude.ai");
    expect(JSON.stringify(ev)).not.toContain(r.client_id);
  });

  it("returns 503 once too many unused clients were registered in 24h", async () => {
    const existing = await prisma.mcpOAuthClient.count({ where: { kind: "DCR", connections: { none: {} }, createdAt: { gt: new Date(Date.now() - 86_400_000) } } });
    const need = DCR_DAILY_UNUSED_CAP - existing;
    await prisma.mcpOAuthClient.createMany({
      data: Array.from({ length: Math.max(need, 0) }, (_, i) => ({ clientId: `zev_cl_cap_${i}_${generateToken(6)}`, kind: "DCR" as const, clientName: "cap", redirectUris: [LOOPBACK], registeredIpHash: "cap-test" })),
    });
    try {
      expect(await registerDcrClient({ redirect_uris: [LOOPBACK] }, null)).toMatchObject({ ok: false, status: 503, error: "temporarily_unavailable" });
    } finally {
      await prisma.mcpOAuthClient.deleteMany({ where: { registeredIpHash: "cap-test" } });
    }
  });
});

describe("validateAuthorizeRequest", () => {
  it("renders (never redirects) for an unknown client or a non-matching redirect_uri", async () => {
    const { challenge } = pkce();
    expect(await validateAuthorizeRequest(authParams("zev_cl_nepoznat", challenge))).toMatchObject({ ok: false, mode: "render", reason: "invalid_client" });
    expect(await validateAuthorizeRequest({ ...authParams("", challenge), client_id: undefined })).toMatchObject({ ok: false, mode: "render" });
    const c = await register("https://claude.ai/api/mcp/auth_callback");
    expect(await validateAuthorizeRequest(authParams(c.client_id, challenge, "https://evil.example/cb"))).toMatchObject({ ok: false, mode: "render", reason: "invalid_redirect_uri" });
    expect(await validateAuthorizeRequest({ ...authParams(c.client_id, challenge), redirect_uri: undefined })).toMatchObject({ ok: false, mode: "render", reason: "invalid_redirect_uri" });
    expect(await validateAuthorizeRequest({ ...authParams(c.client_id, challenge, "https://claude.ai/api/mcp/auth_callback"), redirect_uri: ["https://claude.ai/api/mcp/auth_callback", "https://evil.example"] })).toMatchObject({ ok: false, mode: "render" });
  });

  it("redirects request errors to the client with state and iss", async () => {
    const c = await register();
    const { challenge } = pkce();
    const err = async (p: Record<string, string | undefined>) => {
      const v = await validateAuthorizeRequest(p);
      expect(v.ok).toBe(false);
      if (v.ok || v.mode !== "redirect") throw new Error("očekivano preusmjerenje");
      const u = new URL(v.url);
      expect(u.origin + u.pathname).toBe("http://127.0.0.1:9999/callback");
      expect(u.searchParams.get("state")).toBe("st-1");
      expect(u.searchParams.get("iss")).toBe(APP);
      return u.searchParams.get("error");
    };
    expect(await err(authParams(c.client_id, challenge, LOOPBACK, { response_type: "token" }))).toBe("unsupported_response_type");
    expect(await err(authParams(c.client_id, challenge, LOOPBACK, { code_challenge: undefined }))).toBe("invalid_request");
    expect(await err(authParams(c.client_id, challenge, LOOPBACK, { code_challenge_method: "plain" }))).toBe("invalid_request");
    expect(await err(authParams(c.client_id, challenge, LOOPBACK, { code_challenge_method: undefined }))).toBe("invalid_request");
    expect(await err(authParams(c.client_id, challenge, LOOPBACK, { resource: "https://other.example/api/mcp" }))).toBe("invalid_target");
  });

  it("accepts a different loopback port and the canonical resource, rejects a different loopback path", async () => {
    const c = await register("http://127.0.0.1/callback");
    const { challenge } = pkce();
    const ok = await validateAuthorizeRequest(authParams(c.client_id, challenge, "http://127.0.0.1:61234/callback", { resource: `${RESOURCE}/` }));
    expect(ok.ok).toBe(true);
    if (ok.ok) expect(ok.req.resource).toBe(RESOURCE);
    expect(await validateAuthorizeRequest(authParams(c.client_id, challenge, "http://127.0.0.1:61234/elsewhere"))).toMatchObject({ ok: false, mode: "render" });
  });
});

describe("approveAuthorization / denyAuthorization", () => {
  it("stores only the hash of the code and keeps the existing query of the redirect", async () => {
    const actor = await newActor("oauth-approve");
    const c = await register("http://127.0.0.1:9999/callback?keep=1");
    const { challenge } = pkce();
    const url = new URL(await approveAuthorization(actor, authParams(c.client_id, challenge, "http://127.0.0.1:9999/callback?keep=1"), { name: "Veza", scopeKey: "none", days: 7 }));
    expect(url.searchParams.get("keep")).toBe("1");
    expect(url.searchParams.get("state")).toBe("st-1");
    expect(url.searchParams.get("iss")).toBe(APP);
    const code = url.searchParams.get("code")!;
    const row = await prisma.mcpOAuthCode.findUniqueOrThrow({ where: { codeHash: sha256(code) } });
    expect(JSON.stringify(row)).not.toContain(code);
    expect(row.codeChallenge).toBe(challenge);
    expect(row.resource).toBe(RESOURCE);
    expect(row.expiresAt.getTime()).toBeGreaterThan(Date.now());
    expect(row.expiresAt.getTime()).toBeLessThanOrEqual(Date.now() + 5 * 60_000);
    // Veza ne nastaje pri saglasnosti, nego pri razmjeni koda.
    expect(await prisma.mcpConnection.count({ where: { userId: actor.userId } })).toBe(0);
  });

  it("refuses a scope that is not offered to the user and invalid names/days", async () => {
    const actor = await newActor("oauth-scope");
    const c = await register();
    const { challenge } = pkce();
    const p = authParams(c.client_id, challenge);
    await expect(approveAuthorization(actor, p, { name: "V", scopeKey: "draft:tudj-nacrt", days: 30 })).rejects.toThrow();
    await expect(approveAuthorization(actor, p, { name: "  ", scopeKey: "none", days: 30 })).rejects.toThrow();
    await expect(approveAuthorization(actor, p, { name: "V", scopeKey: "none", days: 13 })).rejects.toThrow();
    expect(await prisma.mcpOAuthCode.count({ where: { userId: actor.userId } })).toBe(0);
  });

  it("re-validates hidden fields: a tampered redirect throws instead of redirecting", async () => {
    const actor = await newActor("oauth-tamper");
    const c = await register("https://claude.ai/api/mcp/auth_callback");
    const { challenge } = pkce();
    await expect(approveAuthorization(actor, authParams(c.client_id, challenge, "https://evil.example/cb"), { name: "V", scopeKey: "none", days: 30 })).rejects.toThrow();
    await expect(denyAuthorization(authParams(c.client_id, challenge, "https://evil.example/cb"))).rejects.toThrow();
  });

  it("deny redirects with access_denied, state and iss", async () => {
    const c = await register();
    const { challenge } = pkce();
    const u = new URL(await denyAuthorization(authParams(c.client_id, challenge)));
    expect(u.searchParams.get("error")).toBe("access_denied");
    expect(u.searchParams.get("state")).toBe("st-1");
    expect(u.searchParams.get("iss")).toBe(APP);
    expect(u.searchParams.get("code")).toBeNull();
  });
});

describe("exchangeAuthorizationCode", () => {
  it("creates an OAUTH connection with the right client kind, expiry and a token pair", async () => {
    const { conn, tokens, actor } = await connect("oauth-exchange", { redirect: "https://claude.ai/api/mcp/auth_callback", days: 7 });
    expect(conn.kind).toBe("OAUTH");
    expect(conn.client).toBe("CLAUDE");
    expect(conn.tokenHash).toBeNull();
    expect(conn.oauthClientId).not.toBeNull();
    expect(conn.name).toBe("Moj Claude");
    expect(Math.abs(conn.expiresAt.getTime() - (Date.now() + 7 * 86_400_000))).toBeLessThan(60_000);
    expect(tokens.token_type).toBe("Bearer");
    expect(tokens.access_token.startsWith(OAUTH_ACCESS_PREFIX)).toBe(true);
    expect(tokens.refresh_token.startsWith(OAUTH_REFRESH_PREFIX)).toBe(true);
    expect(tokens.expires_in).toBeLessThanOrEqual(3600);
    expect(tokens.expires_in).toBeGreaterThan(3500);
    const rows = await prisma.mcpOAuthToken.findMany({ where: { connectionId: conn.id } });
    expect(rows.map((r) => r.kind).sort()).toEqual(["ACCESS", "REFRESH"]);
    expect(JSON.stringify(rows)).not.toContain(tokens.access_token);
    expect(JSON.stringify(rows)).not.toContain(tokens.refresh_token);
    const refresh = rows.find((r) => r.kind === "REFRESH")!;
    expect(refresh.expiresAt.getTime()).toBe(conn.expiresAt.getTime());

    // Audit: bez tajni.
    const ev = await prisma.auditEvent.findFirstOrThrow({ where: { action: "mcp.connection.create", targetId: conn.id } });
    expect(ev.actorId).toBe(actor.userId);
    expect(JSON.stringify(ev)).not.toContain(tokens.access_token);
    expect(ev.after).toMatchObject({ kind: "OAUTH", client: "CLAUDE", clientName: "Test klijent" });
    expect(clientFromRedirect("https://chatgpt.com/connector_platform_oauth_redirect")).toBe("OPENAI");
  });

  it("returns invalid_grant for a wrong verifier, redirect, client or an expired code", async () => {
    const actor = await newActor("oauth-grant");
    const client = await register();
    const other = await register();
    const mk = async () => {
      const { verifier, challenge } = pkce();
      const url = await approveAuthorization(actor, authParams(client.client_id, challenge), { name: "V", scopeKey: "none", days: 30 });
      return { verifier, code: new URL(url).searchParams.get("code")! };
    };
    const base = { clientId: client.client_id, redirectUri: LOOPBACK };

    // Pogrešan verifier ne troši kod: pravi klijent ga i dalje može iskoristiti.
    const { verifier, code: code2 } = await mk();
    expect(await exchangeAuthorizationCode({ ...base, code: code2, codeVerifier: generateToken(32) })).toMatchObject({ ok: false, error: "invalid_grant" });
    expect(await exchangeAuthorizationCode({ ...base, code: code2, codeVerifier: verifier })).toMatchObject({ ok: true });

    const m3 = await mk();
    expect(await exchangeAuthorizationCode({ ...base, redirectUri: "http://127.0.0.1:9998/callback", code: m3.code, codeVerifier: m3.verifier })).toMatchObject({ ok: false, error: "invalid_grant" });
    expect(await exchangeAuthorizationCode({ ...base, clientId: other.client_id, code: m3.code, codeVerifier: m3.verifier })).toMatchObject({ ok: false, error: "invalid_grant" });
    expect(await exchangeAuthorizationCode({ ...base, clientId: "zev_cl_nepoznat", code: m3.code, codeVerifier: m3.verifier })).toMatchObject({ ok: false, status: 401, error: "invalid_client" });
    expect(await exchangeAuthorizationCode({ ...base, code: m3.code, codeVerifier: "kratak" })).toMatchObject({ ok: false, error: "invalid_request" });
    expect(await exchangeAuthorizationCode({ ...base, code: m3.code, codeVerifier: m3.verifier, resource: "https://other.example/api/mcp" })).toMatchObject({ ok: false, error: "invalid_target" });

    await prisma.mcpOAuthCode.update({ where: { codeHash: sha256(m3.code) }, data: { expiresAt: new Date(Date.now() - 1000) } });
    expect(await exchangeAuthorizationCode({ ...base, code: m3.code, codeVerifier: m3.verifier })).toMatchObject({ ok: false, error: "invalid_grant" });
  });

  it("revokes the created connection when the same code is used twice", async () => {
    const { client, code, verifier, redirect, tokens, conn, actor } = await connect("oauth-replay");
    const again = await exchangeAuthorizationCode({ code, clientId: client.client_id, redirectUri: redirect, codeVerifier: verifier });
    expect(again).toMatchObject({ ok: false, error: "invalid_grant" });
    const after = await prisma.mcpConnection.findUniqueOrThrow({ where: { id: conn.id } });
    expect(after.revokedAt).not.toBeNull();
    expect(await verifyMcpToken(`Bearer ${tokens.access_token}`)).toBeNull();
    const ev = await prisma.auditEvent.findFirstOrThrow({ where: { action: "mcp.oauth.token_reuse", targetId: conn.id } });
    expect(ev.after).toEqual({ reason: "code_replay" });
    expect(ev.actorId).toBe(actor.userId);
  });

  it("rejects a code of a deactivated user", async () => {
    const actor = await newActor("oauth-inactive");
    const client = await register();
    const { verifier, challenge } = pkce();
    const url = await approveAuthorization(actor, authParams(client.client_id, challenge), { name: "V", scopeKey: "none", days: 30 });
    await prisma.user.update({ where: { id: actor.userId }, data: { active: false } });
    const r = await exchangeAuthorizationCode({ code: new URL(url).searchParams.get("code")!, clientId: client.client_id, redirectUri: LOOPBACK, codeVerifier: verifier });
    expect(r).toMatchObject({ ok: false, error: "invalid_grant" });
  });
});

describe("refreshAccessToken", () => {
  it("rotates: new pair works, the old refresh token is dead", async () => {
    const c = await connect("oauth-refresh");
    const r = await refreshAccessToken({ refreshToken: c.tokens.refresh_token, clientId: c.client.client_id });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.body.refresh_token).not.toBe(c.tokens.refresh_token);
    expect(await verifyMcpToken(`Bearer ${r.body.access_token}`)).toMatchObject({ connectionId: c.conn.id, kind: "OAUTH" });
    expect(await refreshAccessToken({ refreshToken: c.tokens.refresh_token, clientId: c.client.client_id })).toMatchObject({ ok: false, error: "invalid_grant" });
    // Novi refresh i dalje radi.
    expect(await refreshAccessToken({ refreshToken: r.body.refresh_token, clientId: c.client.client_id })).toMatchObject({ ok: true });
  });

  it("treats a replay within 60s as a plain invalid_grant (connection stays alive)", async () => {
    const c = await connect("oauth-grace");
    const r = await refreshAccessToken({ refreshToken: c.tokens.refresh_token, clientId: c.client.client_id });
    expect(r.ok).toBe(true);
    expect(await refreshAccessToken({ refreshToken: c.tokens.refresh_token, clientId: c.client.client_id })).toMatchObject({ ok: false, error: "invalid_grant" });
    expect((await prisma.mcpConnection.findUniqueOrThrow({ where: { id: c.conn.id } })).revokedAt).toBeNull();
    expect(await prisma.auditEvent.count({ where: { action: "mcp.oauth.token_reuse", targetId: c.conn.id } })).toBe(0);
    if (r.ok) expect(await verifyMcpToken(`Bearer ${r.body.access_token}`)).not.toBeNull();
  });

  it("revokes the whole connection, all tokens and audits when an old refresh token is replayed after 60s", async () => {
    const c = await connect("oauth-theft");
    const r = await refreshAccessToken({ refreshToken: c.tokens.refresh_token, clientId: c.client.client_id });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    await prisma.mcpOAuthToken.update({ where: { tokenHash: sha256(c.tokens.refresh_token) }, data: { rotatedAt: new Date(Date.now() - 61_000) } });
    expect(await refreshAccessToken({ refreshToken: c.tokens.refresh_token, clientId: c.client.client_id })).toMatchObject({ ok: false, error: "invalid_grant" });
    expect((await prisma.mcpConnection.findUniqueOrThrow({ where: { id: c.conn.id } })).revokedAt).not.toBeNull();
    expect(await prisma.mcpOAuthToken.count({ where: { connectionId: c.conn.id, revokedAt: null } })).toBe(0);
    expect(await verifyMcpToken(`Bearer ${r.body.access_token}`)).toBeNull();
    expect(await refreshAccessToken({ refreshToken: r.body.refresh_token, clientId: c.client.client_id })).toMatchObject({ ok: false, error: "invalid_grant" });
    const ev = await prisma.auditEvent.findFirstOrThrow({ where: { action: "mcp.oauth.token_reuse", targetId: c.conn.id } });
    expect(ev.after).toEqual({ reason: "refresh_replay" });
    expect(JSON.stringify(ev)).not.toContain(c.tokens.refresh_token);
  });

  it("never outlives the connection: access is capped, refresh expires exactly with it", async () => {
    const c = await connect("oauth-cap");
    const soon = new Date(Date.now() + 10 * 60_000);
    await prisma.mcpConnection.update({ where: { id: c.conn.id }, data: { expiresAt: soon } });
    const r = await refreshAccessToken({ refreshToken: c.tokens.refresh_token, clientId: c.client.client_id });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.body.expires_in).toBeLessThanOrEqual(600);
    const rows = await prisma.mcpOAuthToken.findMany({ where: { tokenHash: { in: [sha256(r.body.access_token), sha256(r.body.refresh_token)] } } });
    for (const row of rows) expect(row.expiresAt.getTime()).toBeLessThanOrEqual(soon.getTime());
    expect(rows.find((x) => x.kind === "REFRESH")!.expiresAt.getTime()).toBe(soon.getTime());
    // Veza istekla: refresh više ne radi.
    await prisma.mcpConnection.update({ where: { id: c.conn.id }, data: { expiresAt: new Date(Date.now() - 1000) } });
    expect(await refreshAccessToken({ refreshToken: r.body.refresh_token, clientId: c.client.client_id })).toMatchObject({ ok: false, error: "invalid_grant" });
  });

  it("rejects another client, an access token, an unknown client and a wrong resource", async () => {
    const c = await connect("oauth-refresh-bad");
    const other = await register();
    expect(await refreshAccessToken({ refreshToken: c.tokens.refresh_token, clientId: other.client_id })).toMatchObject({ ok: false, error: "invalid_grant" });
    expect(await refreshAccessToken({ refreshToken: c.tokens.access_token, clientId: c.client.client_id })).toMatchObject({ ok: false, error: "invalid_grant" });
    expect(await refreshAccessToken({ refreshToken: c.tokens.refresh_token, clientId: "zev_cl_nepoznat" })).toMatchObject({ ok: false, status: 401, error: "invalid_client" });
    expect(await refreshAccessToken({ refreshToken: c.tokens.refresh_token, clientId: c.client.client_id, resource: "https://other.example/api/mcp" })).toMatchObject({ ok: false, error: "invalid_target" });
    // Ništa od ovoga nije trošilo token.
    expect(await refreshAccessToken({ refreshToken: c.tokens.refresh_token, clientId: c.client.client_id, resource: RESOURCE })).toMatchObject({ ok: true });
  });
});

describe("verifyMcpToken (OAuth access token)", () => {
  it("accepts a live access token and rejects refresh-as-bearer, expired, wrong resource, inactive user and disabled flag", async () => {
    const c = await connect("oauth-verify");
    const bearer = (t: string) => `Bearer ${t}`;
    const ctx = await verifyMcpToken(bearer(c.tokens.access_token));
    expect(ctx).toMatchObject({ userId: c.actor.userId, connectionId: c.conn.id, kind: "OAUTH", scopes: [] });
    expect(JSON.stringify(ctx)).not.toContain(c.tokens.access_token);
    expect(await verifyMcpToken(bearer(c.tokens.refresh_token))).toBeNull();
    expect(await verifyMcpToken(bearer(OAUTH_ACCESS_PREFIX + "A".repeat(43)))).toBeNull();
    expect(await verifyMcpToken(null)).toBeNull();

    const row = await prisma.mcpOAuthToken.findUniqueOrThrow({ where: { tokenHash: sha256(c.tokens.access_token) } });
    await prisma.mcpOAuthToken.update({ where: { id: row.id }, data: { resource: "https://other.example/api/mcp" } });
    expect(await verifyMcpToken(bearer(c.tokens.access_token))).toBeNull();
    await prisma.mcpOAuthToken.update({ where: { id: row.id }, data: { resource: RESOURCE, expiresAt: new Date(Date.now() - 1000) } });
    expect(await verifyMcpToken(bearer(c.tokens.access_token))).toBeNull();
    await prisma.mcpOAuthToken.update({ where: { id: row.id }, data: { expiresAt: new Date(Date.now() + 60_000) } });
    expect(await verifyMcpToken(bearer(c.tokens.access_token))).not.toBeNull();
    await prisma.user.update({ where: { id: c.actor.userId }, data: { active: false } });
    expect(await verifyMcpToken(bearer(c.tokens.access_token))).toBeNull();
    await prisma.user.update({ where: { id: c.actor.userId }, data: { active: true } });

    process.env.MCP_OAUTH_ENABLED = "false";
    vi.resetModules();
    try {
      const fresh = await import("@/server/mcp/auth");
      expect(await fresh.verifyMcpToken(bearer(c.tokens.access_token))).toBeNull();
    } finally {
      process.env.MCP_OAUTH_ENABLED = "true";
      vi.resetModules();
    }
  });

  it("lists the OAuth connection with its kind and the client's self-asserted name", async () => {
    const c = await connect("oauth-list");
    const rows = await listMyMcpConnections(c.actor);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ id: c.conn.id, kind: "OAUTH", oauthClientName: "Test klijent" });
    expect(JSON.stringify(rows)).not.toContain(c.tokens.access_token);
  });

  it("stops working when the user revokes the connection (and the refresh token with it)", async () => {
    const c = await connect("oauth-revoke-conn");
    expect(await verifyMcpToken(`Bearer ${c.tokens.access_token}`)).not.toBeNull();
    await revokeMcpConnection(c.actor, c.conn.id);
    expect(await verifyMcpToken(`Bearer ${c.tokens.access_token}`)).toBeNull();
    expect(await refreshAccessToken({ refreshToken: c.tokens.refresh_token, clientId: c.client.client_id })).toMatchObject({ ok: false, error: "invalid_grant" });
    expect(await prisma.mcpOAuthToken.count({ where: { connectionId: c.conn.id, revokedAt: null } })).toBe(0);
  });
});

describe("revokeOAuthToken (RFC 7009)", () => {
  it("revoking a refresh token ends the connection; an access token only itself; a foreign client does nothing", async () => {
    const c = await connect("oauth-rfc7009");
    const other = await register();
    await revokeOAuthToken({ token: c.tokens.access_token, clientId: other.client_id });
    expect(await verifyMcpToken(`Bearer ${c.tokens.access_token}`)).not.toBeNull();
    await revokeOAuthToken({ token: "zev_mcp_at_" + "x".repeat(43), clientId: c.client.client_id });
    await revokeOAuthToken({ token: "nije-token", clientId: c.client.client_id });

    await revokeOAuthToken({ token: c.tokens.access_token, clientId: c.client.client_id });
    expect(await verifyMcpToken(`Bearer ${c.tokens.access_token}`)).toBeNull();
    expect((await prisma.mcpConnection.findUniqueOrThrow({ where: { id: c.conn.id } })).revokedAt).toBeNull();

    await revokeOAuthToken({ token: c.tokens.refresh_token, clientId: c.client.client_id });
    expect((await prisma.mcpConnection.findUniqueOrThrow({ where: { id: c.conn.id } })).revokedAt).not.toBeNull();
    expect(await refreshAccessToken({ refreshToken: c.tokens.refresh_token, clientId: c.client.client_id })).toMatchObject({ ok: false, error: "invalid_grant" });
  });
});

describe("runOAuthCleanup", () => {
  it("deletes old codes/tokens and unused DCR clients but keeps live ones", async () => {
    const c = await connect("oauth-cleanup");
    const old = new Date(Date.now() - 2 * 86_400_000);
    // Neiskorišćen DCR klijent star 2 dana.
    const stale = await register();
    await prisma.mcpOAuthClient.update({ where: { clientId: stale.client_id }, data: { createdAt: old } });
    // Stari kod i istekao token.
    await prisma.mcpOAuthCode.updateMany({ where: { connectionId: c.conn.id }, data: { expiresAt: old } });
    await prisma.mcpOAuthToken.updateMany({ where: { tokenHash: sha256(c.tokens.access_token) }, data: { expiresAt: old } });

    const res = await runOAuthCleanup();
    expect(res.codes).toBeGreaterThanOrEqual(1);
    expect(res.tokens).toBeGreaterThanOrEqual(1);
    expect(res.clients).toBeGreaterThanOrEqual(1);
    expect(await prisma.mcpOAuthClient.findUnique({ where: { clientId: stale.client_id } })).toBeNull();
    // Klijent sa vezom i refresh token žive ostaju.
    expect(await prisma.mcpOAuthClient.findUnique({ where: { clientId: c.client.client_id } })).not.toBeNull();
    expect(await prisma.mcpOAuthToken.count({ where: { tokenHash: sha256(c.tokens.refresh_token) } })).toBe(1);
  });
});

describe("CIMD (stubovani fetch)", () => {
  const url = (n: string) => `https://claude.ai/oauth/test-${n}-${generateToken(4)}`;
  const doc = (id: string, over: Record<string, unknown> = {}) => ({ client_id: id, client_name: "CIMD klijent", redirect_uris: ["https://claude.ai/api/mcp/auth_callback"], ...over });
  const json = (body: unknown, headers: Record<string, string> = {}) =>
    new Response(typeof body === "string" ? body : JSON.stringify(body), { status: 200, headers: { "content-type": "application/json", ...headers } });

  afterEach(() => vi.unstubAllGlobals());

  it("fetches, validates, caches and reuses the document", async () => {
    const id = url("ok");
    const f = vi.fn(async () => json(doc(id), { "cache-control": "max-age=600" }));
    vi.stubGlobal("fetch", f);
    const first = await resolveClient(id);
    expect(first).toMatchObject({ kind: "CIMD", clientName: "CIMD klijent", redirectUris: ["https://claude.ai/api/mcp/auth_callback"] });
    const second = await resolveClient(id);
    expect(second?.id).toBe(first?.id);
    expect(f).toHaveBeenCalledTimes(1);
    const init = f.mock.calls[0] as unknown as [string, RequestInit];
    expect(init[1].redirect).toBe("error");
    // Istekao keš → ponovni dohvat.
    await prisma.mcpOAuthClient.update({ where: { clientId: id }, data: { metadataExpiresAt: new Date(Date.now() - 1000) } });
    await resolveClient(id);
    expect(f).toHaveBeenCalledTimes(2);
  });

  it("rejects a mismatching client_id, a bad redirect, a foreign auth method, a non-JSON type and an oversized body", async () => {
    const cases: [string, (id: string) => Response][] = [
      ["mismatch", () => json(doc("https://claude.ai/oauth/drugi"))],
      ["badredirect", (id) => json(doc(id, { redirect_uris: ["https://evil.example/cb"] }))],
      ["secret", (id) => json(doc(id, { token_endpoint_auth_method: "client_secret_basic" }))],
      ["html", (id) => new Response(JSON.stringify(doc(id)), { status: 200, headers: { "content-type": "text/html" } })],
      ["huge", (id) => json(doc(id, { padding: "a".repeat(6000) }))],
      ["notjson", () => json("nije json")],
    ];
    for (const [n, make] of cases) {
      const id = url(n);
      vi.stubGlobal("fetch", vi.fn(async () => make(id)));
      expect(await resolveClient(id), n).toBeNull();
      expect(await prisma.mcpOAuthClient.findUnique({ where: { clientId: id } }), n).toBeNull();
    }
  });

  it("never fetches for a host outside the allowlist", async () => {
    const f = vi.fn();
    vi.stubGlobal("fetch", f);
    expect(await resolveClient("https://evil.example/client.json")).toBeNull();
    expect(await resolveClient("http://claude.ai/client.json")).toBeNull();
    expect(f).not.toHaveBeenCalled();
  });

  it("returns null when the fetch fails", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("mreža"); }));
    expect(await resolveClient(url("fail"))).toBeNull();
  });
});
