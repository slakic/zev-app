// Provjera tokena veze asistenta na /api/mcp (Plans/mcp-platforma-plan.md §3). Poziva ga samo MCP ruta:
// pozivalac je asistent sa Authorization zaglavljem, ne preglednik, pa se sesija ni kolačići ovdje ne
// čitaju. Svaka greška izgleda isto (401) da se ne otkriva šta je pogrešno.
import { prisma } from "@/lib/prisma";
import { sha256 } from "@/server/auth/tokens";
import { MCP_TOKEN_PREFIX, parseScopes, type McpScope } from "@/lib/mcp/scopes";
import type { McpClient } from "@/generated/prisma/client";

/** Podaci o provjerenoj vezi koji prate jedan MCP poziv. Nikad ne sadrže token ni hash. */
export type McpRequestContext = {
  userId: string;
  connectionId: string;
  connectionName: string;
  client: McpClient;
  expiresAt: Date;
  scopes: McpScope[];
};

// generateToken(32) = 43 znaka base64url.
const BEARER = new RegExp(`^Bearer (${MCP_TOKEN_PREFIX}[A-Za-z0-9_-]{43})$`);

/** Koliko često se smije upisati lastUsedAt (isti obrazac kao Session.lastSeenAt u session.ts). */
const LAST_USED_THROTTLE_MS = 5 * 60 * 1000;

export async function verifyMcpToken(authorization: string | null): Promise<McpRequestContext | null> {
  const m = BEARER.exec(authorization ?? "");
  if (!m) return null;
  const conn = await prisma.mcpConnection.findUnique({
    where: { tokenHash: sha256(m[1]) },
    include: { user: { select: { active: true } } },
  });
  const now = new Date();
  if (!conn || conn.kind !== "TOKEN" || conn.revokedAt || conn.expiresAt <= now || !conn.user.active) return null;
  // Fire-and-forget: poziv alata ne čeka upis, a `where` ponavlja uslov da paralelni pozivi u istom
  // prozoru ne naprave višak upisa.
  if (!conn.lastUsedAt || now.getTime() - conn.lastUsedAt.getTime() > LAST_USED_THROTTLE_MS) {
    prisma.mcpConnection
      .updateMany({
        where: { id: conn.id, OR: [{ lastUsedAt: null }, { lastUsedAt: { lt: new Date(now.getTime() - LAST_USED_THROTTLE_MS) } }] },
        data: { lastUsedAt: now },
      })
      .catch(() => {});
  }
  return {
    userId: conn.userId,
    connectionId: conn.id,
    connectionName: conn.name,
    client: conn.client,
    expiresAt: conn.expiresAt,
    scopes: parseScopes(conn.scopes),
  };
}

/** Jedinstven odgovor za svaki neuspjeh provjere. Bez `resource_metadata`: OAuth otkrivanje stiže u P-B. */
export function unauthorizedResponse(): Response {
  return new Response(JSON.stringify({ error: "unauthorized" }), {
    status: 401,
    headers: { "content-type": "application/json", "www-authenticate": 'Bearer realm="zev-upravnik"' },
  });
}
