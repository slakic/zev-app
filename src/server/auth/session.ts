import "server-only";
import { cookies, headers } from "next/headers";
import { SignJWT, jwtVerify } from "jose";
import { prisma } from "@/lib/prisma";
import { sha256 } from "./tokens";
import type { Role } from "@/generated/prisma/client";

const COOKIE_NAME = "zev_session";
const SESSION_TTL_HOURS = 12;
/** Faza 2 (Plans/live-sessions-admin-plan.md §O2) — how often getAuthContext() is allowed to
 *  write Session.lastSeenAt, and how recent it must be for /admin/sesije to call a session
 *  "aktivan sada". Two separate constants on purpose: the write throttle only needs to be
 *  "frequent enough that lastSeenAt stays roughly current", while the activity threshold is a
 *  product decision about what counts as "still here" — they don't have to move together. */
const LAST_SEEN_THROTTLE_MS = 5 * 60 * 1000;
export const ACTIVE_SESSION_THRESHOLD_MS = 15 * 60 * 1000;

function secret(): Uint8Array {
  const s = process.env.SESSION_SECRET;
  if (!s || s.length < 16) throw new Error("SESSION_SECRET is not configured");
  return new TextEncoder().encode(s);
}

export type AuthContext = {
  userId: string;
  /** Scoped to zevId below (from Membership), not User.roles — see requireActor. */
  roles: Role[];
  /** The user's Party in this session's active ZEV, if any (Plans/party-per-tenant-plan.md
   *  §4) — not "the user's one global Party" (that no longer exists as a concept: one login
   *  can have a different Party in each tenant it holds a Membership in, or none at all). */
  partyId: string | null;
  email: string;
  displayName: string;
  sessionId: string;
  /** Active tenant for this session; null if unresolved (no Membership at all) or the
   * user is a super admin who hasn't chosen one. See resolveActiveContext() below. */
  zevId: string | null;
  /** True if the active ZEV (zevId above) is currently suspended (Zev.active = false).
   * Null when zevId is null (nothing to be suspended). requireActor() acts on this. */
  zevSuspended: boolean | null;
  isSuperAdmin: boolean;
};

export async function createSession(userId: string, ip?: string | null, userAgent?: string | null) {
  const expiresAt = new Date(Date.now() + SESSION_TTL_HOURS * 3600 * 1000);
  const session = await prisma.session.create({
    data: {
      userId,
      expiresAt,
      ipHash: ip ? sha256(ip) : null,
      ipAddress: ip ?? null,
      userAgent: userAgent?.slice(0, 255) ?? null,
    },
  });
  // Best-effort, fire-and-forget (same pattern as resolveActiveContext's own writes below) —
  // every login is a natural opportunity to sweep ipAddress off sessions that have since
  // expired or been revoked (Plans/live-sessions-admin-plan.md §O1) without needing a cron.
  clearStaleSessionIps().catch(() => {});
  const jwt = await new SignJWT({ sid: session.id })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(Math.floor(expiresAt.getTime() / 1000))
    .sign(secret());
  const cookieStore = await cookies();
  cookieStore.set(COOKIE_NAME, jwt, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    expires: expiresAt,
  });
  return session;
}

export async function destroySession(): Promise<void> {
  const ctx = await getAuthContext();
  if (ctx) {
    await prisma.session.update({
      where: { id: ctx.sessionId },
      data: { revokedAt: new Date(), ipAddress: null },
    }).catch(() => {});
  }
  const cookieStore = await cookies();
  cookieStore.delete(COOKIE_NAME);
}

/**
 * Sweeps Session.ipAddress off any session that's already expired or revoked — the raw IP
 * (Plans/live-sessions-admin-plan.md §O1) is only ever meant to live as long as the session
 * itself is actually current. Called lazily (fire-and-forget, best-effort) from createSession
 * rather than a cron, since every login is itself a natural, frequent trigger for this.
 */
export async function clearStaleSessionIps(): Promise<void> {
  await prisma.session.updateMany({
    where: { ipAddress: { not: null }, OR: [{ expiresAt: { lt: new Date() } }, { revokedAt: { not: null } }] },
    data: { ipAddress: null },
  });
}

/**
 * Whether getAuthContext() should bother writing Session.lastSeenAt right now — pulled out as
 * a pure function (mirrors resolveActiveContext below) so the 5-minute throttle itself can be
 * tested directly without a live request scope. `now` is a parameter rather than `new Date()`
 * inside, purely for deterministic tests.
 */
export function shouldUpdateLastSeen(lastSeenAt: Date | null, now: Date): boolean {
  return !lastSeenAt || now.getTime() - lastSeenAt.getTime() > LAST_SEEN_THROTTLE_MS;
}

/**
 * Which ZEV a session acts within, that ZEV's current roles for the user, and that
 * user's Party in that same ZEV — all three sourced from collections already scoped per
 * tenant (Membership for roles, Party for partyId — see Plans/party-per-tenant-plan.md
 * §4), never from a global column. See docs/multitenancy-plan.md §5 for the roles side.
 * Auto-picks the user's sole Membership on first read after login (or after this
 * migration, for a pre-existing session) and persists that choice on the session row; a
 * user with more than one Membership also defaults to the first (by createdAt) — see
 * setSessionActiveZev() below for how a user with several memberships then switches to a
 * different one on purpose (the account-menu switcher in nav-shell.tsx, or "Uđi u ovaj
 * ZEV" from /admin).
 *
 * Exported (unlike the rest of this file's session/cookie plumbing) so it can be tested
 * directly against real Session/Membership/Party rows without needing next/headers or a
 * signed cookie — see tests/tenant-isolation.test.ts.
 */
export async function resolveActiveContext(
  sessionId: string,
  currentActiveZevId: string | null,
  memberships: { zevId: string; role: Role; createdAt: Date }[],
  parties: { id: string; zevId: string }[]
): Promise<{ zevId: string | null; roles: Role[]; partyId: string | null }> {
  let zevId = currentActiveZevId;
  if (!zevId || !memberships.some((m) => m.zevId === zevId)) {
    const sorted = [...memberships].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
    zevId = sorted[0]?.zevId ?? null;
    if (zevId !== currentActiveZevId) {
      await prisma.session.update({ where: { id: sessionId }, data: { activeZevId: zevId } }).catch(() => {});
    }
  }
  const roles = zevId ? memberships.filter((m) => m.zevId === zevId).map((m) => m.role) : [];
  // @@unique([userId, zevId]) on Party guarantees at most one row can match here — never a
  // "which one do I pick" ambiguity.
  const partyId = zevId ? (parties.find((p) => p.zevId === zevId)?.id ?? null) : null;
  return { zevId, roles, partyId };
}

/** Resolve the authenticated user from the session cookie. Returns null when not logged in. */
export async function getAuthContext(): Promise<AuthContext | null> {
  const cookieStore = await cookies();
  const jwt = cookieStore.get(COOKIE_NAME)?.value;
  if (!jwt) return null;
  let sid: string;
  try {
    const { payload } = await jwtVerify(jwt, secret());
    sid = payload.sid as string;
    if (!sid) return null;
  } catch {
    return null;
  }
  const session = await prisma.session.findUnique({
    where: { id: sid },
    include: {
      user: {
        include: {
          memberships: true,
          // select narrowed to what's actually used below (id/zevId to pick the active
          // one, the rest only for displayName) — not the full Party row with every
          // financial/legal field.
          parties: { select: { id: true, zevId: true, kind: true, firstName: true, lastName: true, orgName: true, createdAt: true } },
        },
      },
      activeZev: { select: { active: true } },
    },
  });
  const now = new Date();
  if (!session || session.revokedAt || session.expiresAt < now) return null;
  if (!session.user.active) return null;
  // Fire-and-forget, throttled (Plans/live-sessions-admin-plan.md §O2) — getAuthContext runs
  // on every request and is called multiple times per request in places, so this must never
  // block the response, and the `where` repeats shouldUpdateLastSeen's own condition so
  // concurrent calls in the same 5-minute window don't race into extra writes.
  if (shouldUpdateLastSeen(session.lastSeenAt, now)) {
    prisma.session
      .updateMany({
        where: { id: session.id, OR: [{ lastSeenAt: null }, { lastSeenAt: { lt: new Date(now.getTime() - LAST_SEEN_THROTTLE_MS) } }] },
        data: { lastSeenAt: now },
      })
      .catch(() => {});
  }
  const u = session.user;
  const { zevId, roles, partyId } = await resolveActiveContext(session.id, session.activeZevId, u.memberships, u.parties);
  // displayName: the Party in the active ZEV, if any; otherwise the oldest Party this
  // login has anywhere (a platform admin with Memberships in several tenants but a Party
  // in only one still gets a real name, not just an e-mail); otherwise the e-mail. Never a
  // cross-tenant data leak — displayName is shown only to the signed-in user themselves
  // (nav-shell.tsx, via requireActor), never rendered for anyone else.
  const activeParty = partyId ? u.parties.find((p) => p.id === partyId) : undefined;
  const fallbackParty = activeParty ?? [...u.parties].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())[0];
  const displayName = fallbackParty
    ? fallbackParty.kind === "PERSON"
      ? `${fallbackParty.firstName ?? ""} ${fallbackParty.lastName ?? ""}`.trim()
      : fallbackParty.orgName ?? u.email
    : u.email;
  // activeZev was included using the session's *previous* activeZevId — if
  // resolveActiveContext just picked a different one (first login, or a stale/removed
  // membership), re-check that new Zev's active flag instead of trusting the (now stale)
  // include.
  const zevSuspended =
    zevId === null ? null : zevId === session.activeZevId ? session.activeZev?.active === false : await zevIsSuspended(zevId);
  return {
    userId: u.id,
    roles,
    partyId,
    email: u.email,
    displayName,
    sessionId: session.id,
    zevId,
    zevSuspended,
    isSuperAdmin: u.isSuperAdmin,
  };
}

/**
 * Change which ZEV a session acts within — the only place besides resolveActiveContext's own
 * auto-pick (line ~93 above) that writes Session.activeZevId. Deliberately unauthorized —
 * the caller (switchActiveZev in src/server/services/memberships.ts) is responsible for
 * confirming the session's own user actually holds a Membership in zevId, and that zevId's
 * Zev is active, before ever calling this. `zevId: null` clears it — used by
 * setTenantActive() (src/server/services/admin.ts, Korak 3) when a super admin suspends
 * the tenant they're currently active in, so the next request lands them back on /admin
 * instead of being logged out by requireActor()'s zevSuspended check.
 */
export async function setSessionActiveZev(sessionId: string, zevId: string | null): Promise<void> {
  await prisma.session.update({ where: { id: sessionId }, data: { activeZevId: zevId } });
}

async function zevIsSuspended(zevId: string): Promise<boolean> {
  const zev = await prisma.zev.findUnique({ where: { id: zevId }, select: { active: true } });
  return zev?.active === false;
}

export async function clientIp(): Promise<string | null> {
  const h = await headers();
  return h.get("x-forwarded-for")?.split(",")[0]?.trim() ?? h.get("x-real-ip") ?? null;
}
