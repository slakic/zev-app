// MCP server aplikacije (Plans/mcp-platforma-plan.md §3): Streamable HTTP preko web-standardnog
// `createMcpHandler` (@modelcontextprotocol/server). Ovaj fajl radi sve prije alata — veličinu zahtjeva,
// ograničenja, provjeru tokena — pa tek onda prosljeđuje zahtjev SDK-u sa podacima o vezi.
//
// Nema provjere zaglavlja Origin: pristup je samo kroz Authorization: Bearer, bez kolačića, pa preglednik
// sa tuđe stranice ne može da pošalje vjerodajnice ove veze (nema CSRF površine).
import { createMcpHandler, McpServer } from "@modelcontextprotocol/server";
import { getEnv } from "@/lib/env";
import { verifyMcpToken, unauthorizedResponse, type McpRequestContext } from "@/server/mcp/auth";
import { consumeMcpCall, mcpAuthFailuresAllowed, recordMcpAuthFailure } from "@/server/mcp/rateLimit";
import { toolsFor } from "@/server/mcp/tools/registry";
import pkg from "../../../package.json";

function json(status: number, body: Record<string, unknown>): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

/**
 * Najveće tijelo zahtjeva. Dokaz o vlasništvu stiže kao base64 (add_owner_stake): sam fajl smije imati MAX_UPLOAD_MB, pa
 * tijelo smije biti za base64 (4/3) i JSON omotač veće. Veličinu samog fajla i dalje provjerava assertUploadable.
 */
function maxBodyBytes(): number {
  return Math.ceil((getEnv().MAX_UPLOAD_MB * 1024 * 1024 * 4) / 3) + 64 * 1024;
}

// Server se pravi po zahtjevu i registruje samo alate koje opseg veze dozvoljava.
const handler = createMcpHandler(
  ({ authInfo }) => {
    const ctx = authInfo?.extra?.mcp as McpRequestContext | undefined;
    if (!ctx) throw new Error("MCP zahtjev bez provjerene veze.");
    const server = new McpServer({ name: "zev-upravnik", version: pkg.version });
    for (const tool of toolsFor(ctx)) tool.register(server, ctx);
    return server;
  },
  // Bez SSE tokova: alati su kratki upiti, a serverless platforme ne vole otvorene veze. SDK inače odbija tijelo veće od 4 MB.
  { responseMode: "json", maxRequestBodySize: maxBodyBytes() }
);

export async function handleMcpRequest(req: Request, ipHash: string | null): Promise<Response> {
  const ipKey = ipHash ?? "unknown";
  if (!mcpAuthFailuresAllowed(ipKey)) return json(429, { error: "rate_limited" });

  if (Number(req.headers.get("content-length") ?? 0) > maxBodyBytes()) return json(413, { error: "too_large" });

  const authorization = req.headers.get("authorization");
  const ctx = await verifyMcpToken(authorization);
  if (!ctx) {
    // Zahtjev bez Authorization zaglavlja je samo početak OAuth otkrivanja (klijent još nema token), ne pogrešan
    // pokušaj: ne računa se u ograničenje po IP adresi, inače bi zajednički izlazni IP Claudea brzo ostao zaključan.
    if (authorization) recordMcpAuthFailure(ipKey);
    return unauthorizedResponse({ tokenPresented: !!authorization });
  }
  if (!consumeMcpCall(ctx.connectionId)) return json(429, { error: "rate_limited" });

  return handler.fetch(req, {
    authInfo: {
      // Sirovi token se ne prosljeđuje dalje od provjere.
      token: "",
      clientId: ctx.connectionId,
      scopes: ctx.scopes.map((s) => `${s.kind}:${s.draftId}`),
      expiresAt: Math.floor(ctx.expiresAt.getTime() / 1000),
      extra: { mcp: ctx },
    },
  });
}
