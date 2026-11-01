// Token endpoint OAuth-a za MCP (Plans/mcp-platforma-plan.md §5): razmjena koda za tokene, rotacija refresh
// tokena i opoziv (RFC 7009). Tokeni su neprozirni slučajni nizovi; u bazi stoji samo sha256. Nijedan token,
// kod, verifier ni hash NE ulazi u audit, log ni odgovor greške.
import { timingSafeEqual } from "node:crypto";
import { prisma } from "@/lib/prisma";
import type { Prisma } from "@/generated/prisma/client";
import { audit } from "@/server/audit";
import { generateToken, sha256 } from "@/server/auth/tokens";
import { displayNameFor } from "@/server/auth/displayName";
import { getEnv } from "@/lib/env";
import { parseScopes } from "@/lib/mcp/scopes";
import {
  CODE_VERIFIER,
  OAUTH_ACCESS_PREFIX,
  OAUTH_ACCESS_TTL_MS,
  OAUTH_REFRESH_PREFIX,
  OAUTH_REFRESH_REPLAY_GRACE_MS,
  OAUTH_SCOPE,
  canonicalResource,
  clientFromRedirect,
  pkceS256,
  resourceMatches,
} from "@/lib/mcp/oauth";
import { findStoredClient, touchClient } from "@/server/mcp/oauth/clients";

type Tx = Prisma.TransactionClient;
const DAY_MS = 24 * 60 * 60 * 1000;

export type TokenResponse = {
  access_token: string;
  token_type: "Bearer";
  expires_in: number;
  refresh_token: string;
  scope: string;
};
export type TokenResult = { ok: true; body: TokenResponse } | { ok: false; status: number; error: string; description?: string };

const fail = (error: string, description?: string, status = 400): TokenResult => ({ ok: false, status, error, description });
const invalidGrant = () => fail("invalid_grant", "Kod ili token nije važeći.");

/** Poređenje dva niza istog tipa u konstantnom vremenu (različite dužine su odmah različite). */
function safeEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  return ba.length === bb.length && timingSafeEqual(ba, bb);
}

/** Izdaje par access + refresh za vezu. Access ne traje duže od veze; refresh ističe tačno kad i veza (bez produžavanja). */
async function issueTokenPair(
  tx: Tx,
  conn: { id: string; expiresAt: Date },
  clientDbId: string,
  resource: string
): Promise<TokenResponse> {
  const now = Date.now();
  const accessExpires = new Date(Math.min(now + OAUTH_ACCESS_TTL_MS, conn.expiresAt.getTime()));
  const access = OAUTH_ACCESS_PREFIX + generateToken(32);
  const refresh = OAUTH_REFRESH_PREFIX + generateToken(32);
  const common = { connectionId: conn.id, clientId: clientDbId, resource };
  await tx.mcpOAuthToken.create({ data: { ...common, tokenHash: sha256(access), kind: "ACCESS", expiresAt: accessExpires } });
  await tx.mcpOAuthToken.create({ data: { ...common, tokenHash: sha256(refresh), kind: "REFRESH", expiresAt: conn.expiresAt } });
  return {
    access_token: access,
    token_type: "Bearer",
    expires_in: Math.max(1, Math.floor((accessExpires.getTime() - now) / 1000)),
    refresh_token: refresh,
    scope: OAUTH_SCOPE,
  };
}

/** Prekida vezu i sve njene tokene (otkrivena ponovna upotreba). Vraća da li je veza stvarno prekinuta ovim pozivom. */
async function revokeConnectionAndTokens(tx: Tx, connectionId: string): Promise<boolean> {
  const now = new Date();
  const res = await tx.mcpConnection.updateMany({ where: { id: connectionId, revokedAt: null }, data: { revokedAt: now } });
  await tx.mcpOAuthToken.updateMany({ where: { connectionId, revokedAt: null }, data: { revokedAt: now } });
  return res.count > 0;
}

async function auditReuse(tx: Tx, connectionId: string, userId: string, reason: "code_replay" | "refresh_replay") {
  await audit(
    { userId, label: await displayNameFor(userId) },
    { action: "mcp.oauth.token_reuse", targetType: "McpConnection", targetId: connectionId, after: { reason } },
    tx
  );
}

// ---- authorization_code --------------------------------------------------------------------------------

export async function exchangeAuthorizationCode(input: {
  code: string;
  clientId: string;
  redirectUri: string;
  codeVerifier: string;
  resource?: string;
}): Promise<TokenResult> {
  const client = await findStoredClient(input.clientId);
  if (!client) return fail("invalid_client", "Nepoznat klijent.", 401);
  if (!CODE_VERIFIER.test(input.codeVerifier)) return fail("invalid_request", "code_verifier nije ispravan.");
  const appUrl = getEnv().APP_URL;
  if (input.resource !== undefined && !resourceMatches(input.resource, appUrl)) return fail("invalid_target", "Nepoznat resource.");

  const now = new Date();
  const row = await prisma.mcpOAuthCode.findUnique({ where: { codeHash: sha256(input.code) } });
  // Kod drugog klijenta se ne troši i ne otkriva: za ovog klijenta on ne postoji.
  if (!row || row.clientId !== client.id) return invalidGrant();

  if (row.usedAt) {
    // Ponovna upotreba koda: sve što je nastalo od njega se prekida (OAuth 2.1 §4.1.3).
    if (row.connectionId) {
      const connectionId = row.connectionId;
      await prisma.$transaction(async (tx) => {
        if (await revokeConnectionAndTokens(tx, connectionId)) await auditReuse(tx, connectionId, row.userId, "code_replay");
      });
    }
    return invalidGrant();
  }
  if (row.expiresAt <= now) return invalidGrant();
  // Tačno ista adresa kao u zahtjevu autorizacije (RFC 6749 §4.1.3), pa i port na lokalnom računaru.
  if (!safeEqual(row.redirectUri, input.redirectUri)) return invalidGrant();
  if (!safeEqual(pkceS256(input.codeVerifier), row.codeChallenge)) return invalidGrant();
  if (input.resource !== undefined && !safeEqual(canonicalResource(appUrl), row.resource)) return fail("invalid_target", "Nepoznat resource.");

  const user = await prisma.user.findUnique({ where: { id: row.userId }, select: { active: true } });
  if (!user?.active) return invalidGrant();
  const label = await displayNameFor(row.userId);

  const body = await prisma.$transaction(async (tx): Promise<TokenResponse | null> => {
    // Atomski: tačno jedan zahtjev troši kod, ostali dobijaju 0 pogođenih redova.
    const claimed = await tx.mcpOAuthCode.updateMany({ where: { id: row.id, usedAt: null, expiresAt: { gt: now } }, data: { usedAt: now } });
    if (claimed.count === 0) return null;
    const expiresAt = new Date(now.getTime() + row.days * DAY_MS);
    const scopes = parseScopes(row.scopes);
    const conn = await tx.mcpConnection.create({
      data: {
        userId: row.userId,
        name: row.connectionName,
        client: clientFromRedirect(row.redirectUri),
        kind: "OAUTH",
        scopes,
        expiresAt,
        oauthClientId: client.id,
      },
      select: { id: true, expiresAt: true },
    });
    const tokens = await issueTokenPair(tx, conn, client.id, row.resource);
    await tx.mcpOAuthCode.update({ where: { id: row.id }, data: { connectionId: conn.id } });
    await audit(
      { userId: row.userId, label },
      {
        action: "mcp.connection.create",
        targetType: "McpConnection",
        targetId: conn.id,
        after: {
          kind: "OAUTH",
          name: row.connectionName,
          client: clientFromRedirect(row.redirectUri),
          clientName: client.clientName,
          scopes,
          expiresAt: expiresAt.toISOString(),
        },
      },
      tx
    );
    return tokens;
  });
  if (!body) return invalidGrant();
  touchClient(client.id);
  return { ok: true, body };
}

// ---- refresh_token -------------------------------------------------------------------------------------

export async function refreshAccessToken(input: { refreshToken: string; clientId: string; resource?: string }): Promise<TokenResult> {
  const client = await findStoredClient(input.clientId);
  if (!client) return fail("invalid_client", "Nepoznat klijent.", 401);
  const appUrl = getEnv().APP_URL;
  if (input.resource !== undefined && !resourceMatches(input.resource, appUrl)) return fail("invalid_target", "Nepoznat resource.");

  const now = new Date();
  const row = await prisma.mcpOAuthToken.findUnique({
    where: { tokenHash: sha256(input.refreshToken) },
    include: { connection: { select: { id: true, userId: true, kind: true, expiresAt: true, revokedAt: true, user: { select: { active: true } } } } },
  });
  if (!row || row.kind !== "REFRESH" || row.clientId !== client.id) return invalidGrant();

  if (row.rotatedAt) {
    // Stari refresh token. Odmah poslije rotacije to je najčešće ponovljen zahtjev (mreža), pa samo odbijamo;
    // kasnije znači da su ga imala dva učesnika, pa se cijela veza prekida.
    if (now.getTime() - row.rotatedAt.getTime() > OAUTH_REFRESH_REPLAY_GRACE_MS) {
      await prisma.$transaction(async (tx) => {
        if (await revokeConnectionAndTokens(tx, row.connection.id)) await auditReuse(tx, row.connection.id, row.connection.userId, "refresh_replay");
      });
    }
    return invalidGrant();
  }
  const conn = row.connection;
  if (row.revokedAt || row.expiresAt <= now) return invalidGrant();
  if (conn.kind !== "OAUTH" || conn.revokedAt || conn.expiresAt <= now || !conn.user.active) return invalidGrant();
  if (input.resource !== undefined && !safeEqual(canonicalResource(appUrl), row.resource)) return fail("invalid_target", "Nepoznat resource.");

  const body = await prisma.$transaction(async (tx): Promise<TokenResponse | null> => {
    // Atomski: samo jedan zahtjev rotira token. Gubitnik utrke je običan ponovljen zahtjev (invalid_grant).
    const rotated = await tx.mcpOAuthToken.updateMany({ where: { id: row.id, rotatedAt: null, revokedAt: null }, data: { rotatedAt: now } });
    if (rotated.count === 0) return null;
    return issueTokenPair(tx, conn, client.id, row.resource);
  });
  if (!body) return invalidGrant();
  touchClient(client.id);
  return { ok: true, body };
}

// ---- revoke (RFC 7009) ---------------------------------------------------------------------------------

/**
 * Opoziv tokena koji pripada ovom klijentu. Refresh token prekida cijelu vezu (klijent odjavljuje korisnika),
 * access token samo sebe. Tuđ ili nepoznat token se ignoriše bez razlike u ponašanju (RFC 7009: uvijek 200).
 */
export async function revokeOAuthToken(input: { token: string; clientId: string }): Promise<void> {
  if (!input.token.startsWith(OAUTH_ACCESS_PREFIX) && !input.token.startsWith(OAUTH_REFRESH_PREFIX)) return;
  const client = await findStoredClient(input.clientId);
  if (!client) return;
  const row = await prisma.mcpOAuthToken.findUnique({
    where: { tokenHash: sha256(input.token) },
    select: { id: true, kind: true, clientId: true, connection: { select: { id: true, userId: true, name: true } } },
  });
  if (!row || row.clientId !== client.id) return;
  if (row.kind === "ACCESS") {
    await prisma.mcpOAuthToken.updateMany({ where: { id: row.id, revokedAt: null }, data: { revokedAt: new Date() } });
    return;
  }
  const label = await displayNameFor(row.connection.userId);
  await prisma.$transaction(async (tx) => {
    if (await revokeConnectionAndTokens(tx, row.connection.id)) {
      await audit(
        { userId: row.connection.userId, label },
        { action: "mcp.connection.revoke", targetType: "McpConnection", targetId: row.connection.id, before: { name: row.connection.name }, after: { via: "oauth_revoke" } },
        tx
      );
    }
  });
}
