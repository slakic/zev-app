// OAuth token endpoint (Plans/mcp-platforma-plan.md §5): authorization_code + refresh_token, javni klijenti
// (bez tajne), samo application/x-www-form-urlencoded. Nikad ne čita kolačiće. Iza MCP_OAUTH_ENABLED (inače 404).
import { OAUTH_SCOPE } from "@/lib/mcp/oauth";
import { maybeCleanupOAuth } from "@/server/mcp/oauth/cleanup";
import { corsPreflight, ipHashOf, oauthError, oauthNoStore, parseForm, requireOAuthEnabled } from "@/server/mcp/oauth/http";
import { exchangeAuthorizationCode, refreshAccessToken } from "@/server/mcp/oauth/token";
import { consumeOAuthToken } from "@/server/mcp/rateLimit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_FORM_BYTES = 8 * 1024;

/** Vrijednost jednog polja forme; ponovljeno polje je greška klijenta. */
function field(form: URLSearchParams, name: string): string | undefined | null {
  const all = form.getAll(name);
  if (all.length > 1) return null;
  return all[0];
}

export async function POST(req: Request): Promise<Response> {
  const off = requireOAuthEnabled();
  if (off) return off;
  if (!consumeOAuthToken(ipHashOf(req) ?? "unknown")) return oauthError(429, "temporarily_unavailable", "Previše zahtjeva.", { "retry-after": "60" });
  maybeCleanupOAuth();

  const form = await parseForm(req, MAX_FORM_BYTES);
  if (!form) return oauthError(400, "invalid_request", "Zahtjev mora biti application/x-www-form-urlencoded.");
  const get = (name: string) => field(form, name);
  const grantType = get("grant_type");
  const clientId = get("client_id");
  const resource = get("resource");
  if (grantType === null || clientId === null || resource === null || !clientId) return oauthError(400, "invalid_request", "Nedostaje client_id.");

  if (grantType === "authorization_code") {
    const code = get("code");
    const redirectUri = get("redirect_uri");
    const verifier = get("code_verifier");
    if (!code || !redirectUri || !verifier) return oauthError(400, "invalid_request", "Nedostaje code, redirect_uri ili code_verifier.");
    const r = await exchangeAuthorizationCode({ code, clientId, redirectUri, codeVerifier: verifier, resource });
    return r.ok ? oauthNoStore(200, r.body) : oauthError(r.status, r.error, r.description);
  }
  if (grantType === "refresh_token") {
    const refreshToken = get("refresh_token");
    if (!refreshToken) return oauthError(400, "invalid_request", "Nedostaje refresh_token.");
    const scope = get("scope");
    if (scope && scope.split(" ").some((s) => s !== OAUTH_SCOPE && s !== "offline_access")) return oauthError(400, "invalid_scope", "Nepodržan scope.");
    const r = await refreshAccessToken({ refreshToken, clientId, resource });
    return r.ok ? oauthNoStore(200, r.body) : oauthError(r.status, r.error, r.description);
  }
  return oauthError(400, "unsupported_grant_type", "Podržani su authorization_code i refresh_token.");
}

export async function OPTIONS(req: Request): Promise<Response> {
  return requireOAuthEnabled() ?? corsPreflight(req, "POST, OPTIONS");
}
