// Lazno čišćenje OAuth tabela (bez cron-a; isti obrazac kao clearStaleSessionIps): poziva se uz /oauth/token i
// /oauth/register, najviše jednom u 10 minuta po instanci. Brišu se samo redovi koji ne mogu više ništa da otključaju.
import { prisma } from "@/lib/prisma";

const DAY_MS = 24 * 60 * 60 * 1000;
const EVERY_MS = 10 * 60 * 1000;
let lastRun = 0;

export type OAuthCleanupResult = { codes: number; tokens: number; clients: number };

/** Briše sve što je isteklo prije više od dana; vraća broj obrisanih redova. Koristi se i u testovima. */
export async function runOAuthCleanup(now = new Date()): Promise<OAuthCleanupResult> {
  const dayAgo = new Date(now.getTime() - DAY_MS);
  const codes = await prisma.mcpOAuthCode.deleteMany({ where: { expiresAt: { lt: dayAgo } } });
  const tokens = await prisma.mcpOAuthToken.deleteMany({
    where: { OR: [{ expiresAt: { lt: dayAgo } }, { connection: { revokedAt: { lt: dayAgo } } }] },
  });
  // DCR klijenti koje niko nije iskoristio: registracija je anonimna pa bi se inače gomilali.
  const clients = await prisma.mcpOAuthClient.deleteMany({
    where: { kind: "DCR", createdAt: { lt: dayAgo }, connections: { none: {} }, codes: { none: {} } },
  });
  return { codes: codes.count, tokens: tokens.count, clients: clients.count };
}

/** Fire-and-forget; greška čišćenja nikad ne smije pokvariti zahtjev. */
export function maybeCleanupOAuth(): void {
  const now = Date.now();
  if (now - lastRun < EVERY_MS) return;
  lastRun = now;
  runOAuthCleanup().catch(() => {});
}

/** Samo za testove. */
export function resetOAuthCleanupThrottle() {
  lastRun = 0;
}
