// Provjera tokena veze asistenta na /api/mcp (Plans/mcp-platforma-plan.md §3). Poziva ga samo MCP ruta:
// pozivalac je asistent sa Authorization zaglavljem, ne preglednik, pa se sesija ni kolačići ovdje ne
// čitaju. Svaka greška izgleda isto (401) da se ne otkriva šta je pogrešno.
//
// Dvije vrste tokena (po prefiksu): ručni token veze `zev_mcp_<43>` (Faza P-A) i OAuth access token
// `zev_mcp_at_<43>` (Faza P-B). OAuth se prihvata samo uz MCP_OAUTH_ENABLED, za ovaj resurs, dok je veza živa.
import { prisma } from "@/lib/prisma";
import { getEnv } from "@/lib/env";
import { sha256 } from "@/server/auth/tokens";
import { MCP_TOKEN_PREFIX, parseScopes, type McpScope } from "@/lib/mcp/scopes";
import { OAUTH_ACCESS_PREFIX, canonicalResource, protectedResourceMetadataUrl, OAUTH_SCOPE } from "@/lib/mcp/oauth";
import { oauthEnabled } from "@/server/mcp/oauth/http";
import type { McpClient } from "@/generated/prisma/client";

/** Podaci o provjerenoj vezi koji prate jedan MCP poziv. Nikad ne sadrže token ni hash. */
export type McpRequestContext = {
  userId: string;
  /** Čita se iz baze na svakom pozivu (ne čuva se uz vezu): oduzet status super admina odmah gasi pristup tuđim nacrtima. */
  isSuperAdmin: boolean;
  connectionId: string;
  connectionName: string;
  client: McpClient;
  expiresAt: Date;
  scopes: McpScope[];
  kind: "TOKEN" | "OAUTH";
};

// generateToken(32) = 43 znaka base64url. Oba oblika su vezana za početak i kraj (^…$) i imaju različitu dužinu
// (51 naspram 54 znaka), pa OAuth token nikad ne prolazi kao stari i obrnuto; OAuth se ipak provjerava prvi.
const BEARER = new RegExp(`^Bearer (${MCP_TOKEN_PREFIX}[A-Za-z0-9_-]{43})$`);
const OAUTH_BEARER = new RegExp(`^Bearer (${OAUTH_ACCESS_PREFIX}[A-Za-z0-9_-]{43})$`);

/** Koliko često se smije upisati lastUsedAt (isti obrazac kao Session.lastSeenAt u session.ts). */
const LAST_USED_THROTTLE_MS = 5 * 60 * 1000;

/** Fire-and-forget: poziv alata ne čeka upis, a `where` ponavlja uslov da paralelni pozivi u istom prozoru ne naprave višak upisa. */
function touchConnection(conn: { id: string; lastUsedAt: Date | null }, now: Date) {
  if (conn.lastUsedAt && now.getTime() - conn.lastUsedAt.getTime() <= LAST_USED_THROTTLE_MS) return;
  prisma.mcpConnection
    .updateMany({
      where: { id: conn.id, OR: [{ lastUsedAt: null }, { lastUsedAt: { lt: new Date(now.getTime() - LAST_USED_THROTTLE_MS) } }] },
      data: { lastUsedAt: now },
    })
    .catch(() => {});
}

async function verifyOAuthAccessToken(token: string): Promise<McpRequestContext | null> {
  if (!oauthEnabled()) return null;
  const row = await prisma.mcpOAuthToken.findUnique({
    where: { tokenHash: sha256(token) },
    include: { connection: { include: { user: { select: { active: true, isSuperAdmin: true } } } } },
  });
  const now = new Date();
  if (!row || row.kind !== "ACCESS" || row.revokedAt || row.expiresAt <= now) return null;
  // Token važi samo za ovaj server (RFC 8707/9728); token izdat za drugi resurs se ne prihvata.
  if (row.resource !== canonicalResource(getEnv().APP_URL)) return null;
  const conn = row.connection;
  if (conn.kind !== "OAUTH" || conn.revokedAt || conn.expiresAt <= now || !conn.user.active) return null;
  touchConnection(conn, now);
  return {
    userId: conn.userId,
    isSuperAdmin: conn.user.isSuperAdmin,
    connectionId: conn.id,
    connectionName: conn.name,
    client: conn.client,
    expiresAt: conn.expiresAt,
    scopes: parseScopes(conn.scopes),
    kind: "OAUTH",
  };
}

export async function verifyMcpToken(authorization: string | null): Promise<McpRequestContext | null> {
  const oauth = OAUTH_BEARER.exec(authorization ?? "");
  if (oauth) return verifyOAuthAccessToken(oauth[1]);
  const m = BEARER.exec(authorization ?? "");
  if (!m) return null;
  const conn = await prisma.mcpConnection.findUnique({
    where: { tokenHash: sha256(m[1]) },
    include: { user: { select: { active: true, isSuperAdmin: true } } },
  });
  const now = new Date();
  if (!conn || conn.kind !== "TOKEN" || conn.revokedAt || conn.expiresAt <= now || !conn.user.active) return null;
  touchConnection(conn, now);
  return {
    userId: conn.userId,
    isSuperAdmin: conn.user.isSuperAdmin,
    connectionId: conn.id,
    connectionName: conn.name,
    client: conn.client,
    expiresAt: conn.expiresAt,
    scopes: parseScopes(conn.scopes),
    kind: "TOKEN",
  };
}

/**
 * Jedinstven odgovor za svaki neuspjeh provjere. Uz uključen OAuth zaglavlje upućuje klijenta na metapodatke
 * resursa (RFC 9728), što je jedini način da Claude uopšte krene sa prijavom; `error="invalid_token"` samo kad je
 * token stvarno poslat. Isključen OAuth: odgovor je isti kao u Fazi P-A.
 */
export function unauthorizedResponse(opts: { tokenPresented?: boolean } = {}): Response {
  if (!oauthEnabled()) {
    return new Response(JSON.stringify({ error: "unauthorized" }), {
      status: 401,
      headers: { "content-type": "application/json", "www-authenticate": 'Bearer realm="zev-upravnik"' },
    });
  }
  const challenge =
    `Bearer resource_metadata="${protectedResourceMetadataUrl(getEnv().APP_URL)}", scope="${OAUTH_SCOPE}"` +
    (opts.tokenPresented ? ', error="invalid_token"' : "");
  return new Response(JSON.stringify({ error: "invalid_token" }), {
    status: 401,
    headers: { "content-type": "application/json", "www-authenticate": challenge },
  });
}
