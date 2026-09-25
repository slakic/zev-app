// Live super-admin view of currently logged-in sessions (Plans/live-sessions-admin-plan.md,
// Faza 1 + Faza 2 + Faza 3). Deliberately its own service file rather than growing admin.ts
// or activity.ts (matches the existing one-domain-per-file split).
import { prisma } from "@/lib/prisma";
import { requireSuperAdmin, type Actor } from "@/server/auth/guards";
import { clearStaleSessionIps, ACTIVE_SESSION_THRESHOLD_MS } from "@/server/auth/session";
import { partyDisplayName } from "@/server/services/ownership";
import { audit } from "@/server/audit";

const MAX_ROWS = 200;

export type ActiveSessionRow = {
  id: string;
  userId: string;
  email: string;
  displayName: string;
  ipAddress: string | null;
  userAgent: string | null;
  createdAt: Date;
  lastSeenAt: Date | null;
  /** < ACTIVE_SESSION_THRESHOLD_MS since lastSeenAt (Plans/live-sessions-admin-plan.md §O2) —
   *  null lastSeenAt (pre-Faza-2 session, or the throttle hasn't fired yet) reads as false,
   *  not "unknown", since the page has nothing better to show than "not recently seen". */
  isActiveNow: boolean;
  expiresAt: Date;
  zevId: string | null;
  zevLabel: string | null;
  zevSuspended: boolean;
  roles: string[];
};

export type ListActiveSessionsInput = {
  /** "Samo aktivni sada" filter (plan §UI) — applied at the query level so MAX_ROWS/summary
   *  counts reflect the filtered set, not a client-side slice of the unfiltered one. */
  activeOnly?: boolean;
};

/**
 * "Currently logged in" (plan §O4): not revoked, not expired, and the account itself still
 * active — a deactivated user's lingering session row shouldn't appear as "live". Sessions
 * whose active ZEV is suspended, or who have no active ZEV at all, are still included (with
 * zevSuspended/zevId reflecting that) rather than filtered out — the point of this page is
 * to show who's actually got a live cookie right now, not to pre-judge which of those are
 * "interesting".
 */
export async function listActiveSessions(actor: Actor, input: ListActiveSessionsInput = {}): Promise<ActiveSessionRow[]> {
  requireSuperAdmin(actor);
  // Best-effort lazy cleanup on page load too, not just at login (session.ts's own call) —
  // an admin loading this page is exactly when a stale raw IP should least likely still be
  // sitting around to view.
  await clearStaleSessionIps().catch(() => {});
  const now = new Date();
  const activeSince = new Date(now.getTime() - ACTIVE_SESSION_THRESHOLD_MS);
  const sessions = await prisma.session.findMany({
    where: {
      revokedAt: null,
      expiresAt: { gt: now },
      user: { active: true },
      ...(input.activeOnly ? { lastSeenAt: { gte: activeSince } } : {}),
    },
    // Faza 1 sorted by createdAt; Faza 2 switches to "most recently seen first", nulls (never
    // throttle-written yet) sorting last rather than first — plan §UI "Sortiranje".
    orderBy: [{ lastSeenAt: { sort: "desc", nulls: "last" } }, { createdAt: "desc" }],
    take: MAX_ROWS,
    include: {
      user: { select: { id: true, email: true } },
      activeZev: { select: { id: true, legalName: true, shortName: true, active: true } },
    },
  });
  const userIds = [...new Set(sessions.map((s) => s.userId))];
  const zevIds = [...new Set(sessions.map((s) => s.activeZevId).filter((z): z is string => z != null))];
  const [memberships, parties] = await Promise.all([
    prisma.membership.findMany({ where: { userId: { in: userIds } }, select: { userId: true, zevId: true, role: true } }),
    zevIds.length > 0
      ? prisma.party.findMany({
          where: { userId: { in: userIds }, zevId: { in: zevIds } },
          select: { userId: true, zevId: true, kind: true, firstName: true, lastName: true, orgName: true },
        })
      : Promise.resolve([]),
  ]);
  const partyByKey = new Map(parties.map((p) => [`${p.userId}:${p.zevId}`, partyDisplayName(p)]));
  return sessions.map((s) => {
    const zevId = s.activeZevId;
    const roles = zevId ? memberships.filter((m) => m.userId === s.userId && m.zevId === zevId).map((m) => m.role) : [];
    const displayName = (zevId ? partyByKey.get(`${s.userId}:${zevId}`) : undefined) || s.user.email;
    return {
      id: s.id,
      userId: s.userId,
      email: s.user.email,
      displayName,
      ipAddress: s.ipAddress,
      userAgent: s.userAgent,
      createdAt: s.createdAt,
      lastSeenAt: s.lastSeenAt,
      isActiveNow: s.lastSeenAt != null && now.getTime() - s.lastSeenAt.getTime() < ACTIVE_SESSION_THRESHOLD_MS,
      expiresAt: s.expiresAt,
      zevId,
      zevLabel: s.activeZev ? s.activeZev.shortName || s.activeZev.legalName : null,
      zevSuspended: s.activeZev?.active === false,
      roles,
    };
  });
}

/**
 * Faza 3 (Plans/live-sessions-admin-plan.md §O3, approved) — ends one specific session
 * immediately: sets revokedAt and clears ipAddress (same as every other revoke path —
 * destroySession, resetPassword, deactivateUser). Deliberately refuses to revoke the caller's
 * own current session (actor.sessionId) — "Odjava" already exists for that, and a super admin
 * accidentally locking themselves out mid-review is exactly the mistake this guards against.
 * Does NOT prevent the user from logging back in (only deactivateUser does that) — the caller
 * (the confirm dialog in /admin/sesije) must say so, per the plan.
 */
export async function revokeSession(actor: Actor, sessionId: string): Promise<void> {
  requireSuperAdmin(actor);
  if (actor.sessionId === sessionId) {
    throw new Error("Ne možete opozvati sopstvenu trenutnu sesiju — za to koristite Odjavu.");
  }
  const session = await prisma.session.findUniqueOrThrow({ where: { id: sessionId }, select: { userId: true, activeZevId: true } });
  await prisma.session.update({ where: { id: sessionId }, data: { revokedAt: new Date(), ipAddress: null } });
  // zevId is explicitly overridden to the TARGET session's own tenant — same pattern as
  // admin.account.create/admin.tenant.activate (admin.ts) — rather than left to audit()'s
  // default of `actor.zevId`, which is the acting super admin's own incidentally-active
  // tenant and has nothing to do with whose session this actually is (a super admin who is
  // also a president somewhere would otherwise misattribute this event to their own ZEV).
  // No ipAddress in `after` — the target session's own raw IP was never meant to survive
  // into the append-only audit trail (plan §O1/§O7).
  await audit(
    { ...actor, zevId: session.activeZevId },
    {
      action: "admin.session.revoke",
      targetType: "Session",
      targetId: sessionId,
      after: { userId: session.userId, sessionId },
    }
  );
}

/**
 * Coarse device/browser label from the raw User-Agent string, e.g. "Chrome na Windows" — not
 * a full UA parser (no library dependency for this), just enough for an admin to recognize
 * "is this me" at a glance. Falls back to "Nepoznat uređaj" when userAgent is null/unrecognized.
 */
export function describeUserAgent(userAgent: string | null): string {
  if (!userAgent) return "Nepoznat uređaj";
  const browser = /Edg\//.test(userAgent)
    ? "Edge"
    : /OPR\//.test(userAgent)
      ? "Opera"
      : /Chrome\//.test(userAgent)
        ? "Chrome"
        : /Firefox\//.test(userAgent)
          ? "Firefox"
          : /Safari\//.test(userAgent)
            ? "Safari"
            : null;
  const os = /Windows/.test(userAgent)
    ? "Windows"
    : /Android/.test(userAgent)
      ? "Android"
      : /iPhone|iPad|iOS/.test(userAgent)
        ? "iOS"
        : /Mac OS X/.test(userAgent)
          ? "macOS"
          : /Linux/.test(userAgent)
            ? "Linux"
            : null;
  if (browser && os) return `${browser} na ${os}`;
  if (browser) return browser;
  if (os) return os;
  return "Nepoznat uređaj";
}
