import "server-only";
import { cookies, headers } from "next/headers";
import { SignJWT, jwtVerify } from "jose";
import { prisma } from "@/lib/prisma";
import { sha256 } from "./tokens";
import type { Role, User, Party } from "@/generated/prisma/client";

const COOKIE_NAME = "zev_session";
const SESSION_TTL_HOURS = 12;

function secret(): Uint8Array {
  const s = process.env.SESSION_SECRET;
  if (!s || s.length < 16) throw new Error("SESSION_SECRET is not configured");
  return new TextEncoder().encode(s);
}

export type SessionUser = User & { party: Party | null };

export type AuthContext = {
  userId: string;
  /** Scoped to zevId below (from Membership), not User.roles — see requireActor. */
  roles: Role[];
  partyId: string | null;
  email: string;
  displayName: string;
  sessionId: string;
  /** Active tenant for this session; null if unresolved (no Membership at all) or the
   * user is a super admin who hasn't chosen one. See resolveActiveZev() below. */
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
      ip: ip ? sha256(ip) : null,
      userAgent: userAgent?.slice(0, 255) ?? null,
    },
  });
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
      data: { revokedAt: new Date() },
    }).catch(() => {});
  }
  const cookieStore = await cookies();
  cookieStore.delete(COOKIE_NAME);
}

/**
 * Which ZEV a session acts within, and that ZEV's current roles for the user — sourced
 * from Membership, never from the (soon superseded) User.roles column. See
 * docs/multitenancy-plan.md §5. Auto-picks the user's sole Membership on first read
 * after login (or after this migration, for a pre-existing session) and persists that
 * choice on the session row; a user with more than one Membership also defaults to the
 * first (by createdAt) — see setSessionActiveZev() below for how a user with several
 * memberships then switches to a different one on purpose (the account-menu switcher in
 * nav-shell.tsx, or "Uđi u ovaj ZEV" from /admin).
 */
async function resolveActiveZev(
  sessionId: string,
  currentActiveZevId: string | null,
  memberships: { zevId: string; role: Role; createdAt: Date }[]
): Promise<{ zevId: string | null; roles: Role[] }> {
  let zevId = currentActiveZevId;
  if (!zevId || !memberships.some((m) => m.zevId === zevId)) {
    const sorted = [...memberships].sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
    zevId = sorted[0]?.zevId ?? null;
    if (zevId !== currentActiveZevId) {
      await prisma.session.update({ where: { id: sessionId }, data: { activeZevId: zevId } }).catch(() => {});
    }
  }
  const roles = zevId ? memberships.filter((m) => m.zevId === zevId).map((m) => m.role) : [];
  return { zevId, roles };
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
      user: { include: { party: true, memberships: true } },
      activeZev: { select: { active: true } },
    },
  });
  if (!session || session.revokedAt || session.expiresAt < new Date()) return null;
  if (!session.user.active) return null;
  const u = session.user;
  const displayName = u.party
    ? u.party.kind === "PERSON"
      ? `${u.party.firstName ?? ""} ${u.party.lastName ?? ""}`.trim()
      : u.party.orgName ?? u.email
    : u.email;
  const { zevId, roles } = await resolveActiveZev(session.id, session.activeZevId, u.memberships);
  // activeZev was included using the session's *previous* activeZevId — if resolveActiveZev
  // just picked a different one (first login, or a stale/removed membership), re-check that
  // new Zev's active flag instead of trusting the (now stale) include.
  const zevSuspended =
    zevId === null ? null : zevId === session.activeZevId ? session.activeZev?.active === false : await zevIsSuspended(zevId);
  return {
    userId: u.id,
    roles,
    partyId: u.partyId,
    email: u.email,
    displayName,
    sessionId: session.id,
    zevId,
    zevSuspended,
    isSuperAdmin: u.isSuperAdmin,
  };
}

/**
 * Change which ZEV a session acts within — the only place besides resolveActiveZev's own
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
