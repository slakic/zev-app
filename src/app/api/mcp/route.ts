// /api/mcp — MCP server za asistente (Claude, ChatGPT...) — Plans/mcp-platforma-plan.md. Javni URL je
// `${APP_URL}/api/mcp`. Poziva ga asistent, ne preglednik: autentikacija je isključivo token veze u
// `Authorization: Bearer`, provjeren u handleMcpRequest().
//
// PRAVILA ZA OVAJ FAJL: nikad ne čitaj kolačiće ni getAuthContext() (nema korisničke sesije), i nikad
// ne uzimaj korisnika ni tenant ni odakle osim iz provjerene veze. Dok MCP_ENABLED nije "true", ruta ne postoji (404).
import { getEnv } from "@/lib/env";
import { sha256 } from "@/server/auth/tokens";
import { handleMcpRequest } from "@/server/mcp/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function handle(req: Request): Promise<Response> {
  if (getEnv().MCP_ENABLED !== "true") return new Response("Not found", { status: 404 });
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? req.headers.get("x-real-ip") ?? null;
  return handleMcpRequest(req, ip ? sha256(ip) : null);
}

export { handle as GET, handle as POST, handle as DELETE };
