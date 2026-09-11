// Tenant switching for a session already signed in — see
// Plans/tenant-switching-admin-accounts-plan.md §2. Deliberately NOT in admin.ts:
// unlike everything there (guarded by requireSuperAdmin, cross-tenant by definition),
// switching is something any user with more than one Membership can do — a super
// admin entering a tenant is just one case of it, not a separate mechanism.
import { prisma } from "@/lib/prisma";
import { requireAnyUser, ForbiddenError, type Actor } from "@/server/auth/guards";
import { setSessionActiveZev } from "@/server/auth/session";
import { audit } from "@/server/audit";
import type { Role } from "@/generated/prisma/client";

export type MyTenant = {
  zevId: string;
  legalName: string;
  shortName: string | null;
  roles: Role[];
  active: boolean;
};

/** Every ZEV the caller holds at least one Membership in, roles grouped per ZEV. */
export async function listMyTenants(actor: Actor): Promise<MyTenant[]> {
  requireAnyUser(actor);
  const memberships = await prisma.membership.findMany({
    where: { userId: actor.userId },
    include: { zev: { select: { id: true, legalName: true, shortName: true, active: true } } },
    orderBy: { createdAt: "asc" },
  });
  const byZev = new Map<string, MyTenant>();
  for (const m of memberships) {
    const existing = byZev.get(m.zevId);
    if (existing) {
      existing.roles.push(m.role);
    } else {
      byZev.set(m.zevId, {
        zevId: m.zevId,
        legalName: m.zev.legalName,
        shortName: m.zev.shortName,
        roles: [m.role],
        active: m.zev.active,
      });
    }
  }
  return [...byZev.values()];
}

/**
 * Switch the caller's session to a different ZEV — validated purely against Membership,
 * with no exception for isSuperAdmin (see plan §2.1): without a Membership row, Actor.roles
 * for that tenant would resolve to an empty array and every requireRole() check would fail
 * anyway, so "switch" without membership is not a lesser form of access, it's none at all.
 */
export async function switchActiveZev(actor: Actor, targetZevId: string): Promise<void> {
  requireAnyUser(actor);
  if (!actor.sessionId) throw new Error("Nema aktivne sesije.");
  if (actor.zevId === targetZevId) return; // already there — no-op, no audit noise

  const membership = await prisma.membership.findFirst({ where: { userId: actor.userId, zevId: targetZevId } });
  if (!membership) throw new ForbiddenError("Nemate članstvo u ovom ZEV-u.");

  const target = await prisma.zev.findUniqueOrThrow({ where: { id: targetZevId } });
  if (!target.active) throw new Error("ZEV je suspendovan.");

  await setSessionActiveZev(actor.sessionId, targetZevId);

  // Two records on purpose (plan §2.2): one in the tenant being left (so its president can
  // see this actor departed), one in the tenant being entered (so its president can see who
  // just showed up) — audit() derives zevId from the actor object passed in, so the first
  // call uses the caller's own (pre-switch) zevId and the second overrides it explicitly.
  if (actor.zevId) {
    await audit(actor, { action: "session.switch_zev", targetType: "Zev", targetId: targetZevId, after: { zevId: targetZevId } });
  }
  await audit(
    { ...actor, zevId: targetZevId },
    { action: "session.switch_zev", targetType: "Zev", targetId: targetZevId, after: { zevId: targetZevId } }
  );
}
