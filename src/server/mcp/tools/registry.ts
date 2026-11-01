// Registar MCP alata (Plans/mcp-platforma-plan.md §3). Svaki alat navodi koji opseg veze traži
// (`requires`; null = svaka važeća veza). MCP server se pravi po zahtjevu i dobija SAMO alate koje opseg
// veze dozvoljava — alat koji veza ne smije ne postoji u `tools/list`, a opseg se ipak provjerava i u
// samom alatu (access.ts) jer stanje nacrta može da se promijeni između dva poziva.
//
// PRAVILO ZA SVE ALATE: nijedan alat nema nepovratnu posljedicu (objava, potvrda registra, slanje
// poruka, otvaranje naloga, lozinke), a odgovor alata nikad ne sadrži tajne.
import type { McpServer } from "@modelcontextprotocol/server";
import type { McpScope } from "@/lib/mcp/scopes";
import type { McpRequestContext } from "@/server/mcp/auth";
import { whoamiTool } from "@/server/mcp/tools/whoami";

export type McpToolDef = {
  name: string;
  requires: McpScope["kind"] | null;
  register: (server: McpServer, ctx: McpRequestContext) => void;
};

export const MCP_TOOLS: McpToolDef[] = [whoamiTool];

export function toolsFor(ctx: McpRequestContext): McpToolDef[] {
  return MCP_TOOLS.filter((tool) => tool.requires === null || ctx.scopes.some((s) => s.kind === tool.requires));
}
