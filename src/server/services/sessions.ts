// Live super-admin view of currently logged-in sessions (Plans/live-sessions-admin-plan.md,
// Faza 1) — read-only for now; Faza 2 adds lastSeenAt, Faza 3 adds revoke. Deliberately its
// own service file rather than growing admin.ts or activity.ts (matches the existing
// one-domain-per-file split).
import { prisma } from "@/lib/prisma";
import { requireSuperAdmin, type Actor } from "@/server/auth/guards";
import { clearStaleSessionIps } from "@/server/auth/session";
import { partyDisplayName } from "@/server/services/ownership";

const MAX_ROWS = 200;

export type ActiveSessionRow = {
  id: string;
  userId: string;
  email: string;
  displayName: string;
  ipAddress: string | null;
  userAgent: string | null;
  createdAt: Date;
  expiresAt: Date;
  zevId: string | null;
  zevLabel: string | null;
  zevSuspended: boolean;
  roles: string[];
};

/**
 * "Currently logged in" (plan §O4): not revoked, not expired, and the account itself still
 * active — a deactivated user's lingering session row shouldn't appear as "live". Sessions
 * whose active ZEV is suspended, or who have no active ZEV at all, are still included (with
 * zevSuspended/zevId reflecting that) rather than filtered out — the point of this page is
 * to show who's actually got a live cookie right now, not to pre-judge which of those are
 * "interesting".
 */
export async function listActiveSessions(actor: Actor): Promise<ActiveSessionRow[]> {
  requireSuperAdmin(actor);
  // Best-effort lazy cleanup on page load too, not just at login (session.ts's own call) —
  // an admin loading this page is exactly when a stale raw IP should least likely still be
  // sitting around to view.
  await clearStaleSessionIps().catch(() => {});
  const now = new Date();
  const sessions = await prisma.session.findMany({
    where: { revokedAt: null, expiresAt: { gt: now }, user: { active: true } },
    orderBy: { createdAt: "desc" },
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
      expiresAt: s.expiresAt,
      zevId,
      zevLabel: s.activeZev ? s.activeZev.shortName || s.activeZev.legalName : null,
      zevSuspended: s.activeZev?.active === false,
      roles,
    };
  });
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
