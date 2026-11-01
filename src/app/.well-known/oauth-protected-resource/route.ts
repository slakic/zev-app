// RFC 9728 — metapodaci zaštićenog resursa (korijenski oblik; klijenti probaju i ovaj). Iza MCP_OAUTH_ENABLED (inače 404).
// Izdavač i resurs se grade samo iz APP_URL, nikad iz Host zaglavlja.
import { getEnv } from "@/lib/env";
import { buildPrm } from "@/lib/mcp/oauth";
import { corsPreflight, metadataResponse, requireOAuthEnabled } from "@/server/mcp/oauth/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  return requireOAuthEnabled() ?? metadataResponse(buildPrm(getEnv().APP_URL));
}

export async function OPTIONS(req: Request): Promise<Response> {
  return requireOAuthEnabled() ?? corsPreflight(req, "GET, OPTIONS");
}
