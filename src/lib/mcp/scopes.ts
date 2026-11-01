// Opsezi veze asistenta (Plans/mcp-platforma-plan.md §2): šta jedna veza smije. Čista logika bez
// servera i baze, pa je dijele servis, MCP sloj i testovi. Opseg se čuva uz vezu (McpConnection.scopes),
// a provjerava se na SVAKOM pozivu alata (src/server/mcp/access.ts) — nikad samo pri pravljenju veze.
import { z } from "zod";

export const McpScopeSchema = z.discriminatedUnion("kind", [
  // Nacrt novog ZEV-a koji korisnik popunjava u čarobnjaku. Uz O-A dobija i čitanje/upis nacrta.
  z.object({ kind: z.literal("ONBOARDING_DRAFT"), draftId: z.string().min(1) }),
  // ZEV_READ — kasnije faze.
]);
export type McpScope = z.infer<typeof McpScopeSchema>;

export const McpScopesSchema = z.array(McpScopeSchema).max(10);

/** Opsezi iz JSON kolone; nevažeći sadržaj daje prazan niz (veza bez opsega ne smije ništa), nikad izuzetak. */
export function parseScopes(json: unknown): McpScope[] {
  const parsed = McpScopesSchema.safeParse(json);
  return parsed.success ? parsed.data : [];
}

/** Rokovi važenja koje korisnik može izabrati (dani). */
export const MCP_EXPIRY_DAYS = [7, 30, 90] as const;

/** Prefiks tokena veze — prepoznatljiv u logovima i alatima za otkrivanje procurelih tajni. */
export const MCP_TOKEN_PREFIX = "zev_mcp_";
