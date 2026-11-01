// RFC 8414 — metapodaci servera autorizacije. Iza MCP_OAUTH_ENABLED (inače 404).
import { getEnv } from "@/lib/env";
import { buildAsMetadata } from "@/lib/mcp/oauth";
import { corsPreflight, metadataResponse, requireOAuthEnabled } from "@/server/mcp/oauth/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  return requireOAuthEnabled() ?? metadataResponse(buildAsMetadata(getEnv().APP_URL));
}

export async function OPTIONS(req: Request): Promise<Response> {
  return requireOAuthEnabled() ?? corsPreflight(req, "GET, OPTIONS");
}
