// RFC 7009 — opoziv tokena. Uvijek 200 (i za nepoznat ili tuđ token), da se ne otkriva šta postoji.
// Refresh token prekida cijelu vezu. Iza MCP_OAUTH_ENABLED (inače 404).
import { corsPreflight, ipHashOf, oauthError, oauthNoStore, parseForm, requireOAuthEnabled } from "@/server/mcp/oauth/http";
import { revokeOAuthToken } from "@/server/mcp/oauth/token";
import { consumeOAuthToken } from "@/server/mcp/rateLimit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request): Promise<Response> {
  const off = requireOAuthEnabled();
  if (off) return off;
  if (!consumeOAuthToken(ipHashOf(req) ?? "unknown")) return oauthError(429, "temporarily_unavailable", "Previše zahtjeva.", { "retry-after": "60" });
  const form = await parseForm(req, 8 * 1024);
  if (!form) return oauthError(400, "invalid_request", "Zahtjev mora biti application/x-www-form-urlencoded.");
  const token = form.get("token");
  const clientId = form.get("client_id");
  if (!token || !clientId) return oauthError(400, "invalid_request", "Nedostaje token ili client_id.");
  await revokeOAuthToken({ token, clientId });
  return oauthNoStore(200, {});
}

export async function OPTIONS(req: Request): Promise<Response> {
  return requireOAuthEnabled() ?? corsPreflight(req, "POST, OPTIONS");
}
