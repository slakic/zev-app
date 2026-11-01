// RFC 7591 — dinamička registracija klijenta (DCR). Anonimna je pa je strogo ograničena: spisak dozvoljenih
// povratnih adresa, najviše 8 KB tijela, 60 zahtjeva na sat po IP adresi i dnevni plafon neiskorišćenih klijenata.
// Nikad se ne izdaje tajna (token_endpoint_auth_method je uvijek "none"). Iza MCP_OAUTH_ENABLED (inače 404).
import { MAX_REGISTRATION_BYTES } from "@/lib/mcp/oauth";
import { registerDcrClient } from "@/server/mcp/oauth/clients";
import { maybeCleanupOAuth } from "@/server/mcp/oauth/cleanup";
import { corsPreflight, ipHashOf, oauthError, oauthNoStore, readLimitedText, requireOAuthEnabled } from "@/server/mcp/oauth/http";
import { consumeOAuthRegister } from "@/server/mcp/rateLimit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request): Promise<Response> {
  const off = requireOAuthEnabled();
  if (off) return off;
  const ipHash = ipHashOf(req);
  if (!consumeOAuthRegister(ipHash ?? "unknown")) return oauthError(429, "temporarily_unavailable", "Previše zahtjeva.", { "retry-after": "3600" });
  maybeCleanupOAuth();

  if (!(req.headers.get("content-type") ?? "").toLowerCase().includes("application/json")) {
    return oauthError(400, "invalid_client_metadata", "Tijelo mora biti application/json.");
  }
  const text = await readLimitedText(req, MAX_REGISTRATION_BYTES);
  if (text === null) return oauthError(400, "invalid_client_metadata", "Tijelo je preveliko.");
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    return oauthError(400, "invalid_client_metadata", "Tijelo nije ispravan JSON.");
  }
  const result = await registerDcrClient(body, ipHash);
  if (!result.ok) return oauthError(result.status, result.error, result.description, result.status === 503 ? { "retry-after": "3600" } : {});
  return oauthNoStore(201, result.response);
}

export async function OPTIONS(req: Request): Promise<Response> {
  return requireOAuthEnabled() ?? corsPreflight(req, "POST, OPTIONS");
}
