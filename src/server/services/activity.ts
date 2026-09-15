// Curated activity feed (Plans/user-activity-log-plan.md §5, §8 Faza 2) — a read-model over
// the append-only AuditEvent trail, following the same shape as getEVoteConsentHistory
// (src/server/services/evoteConsent.ts): filter/narrow AuditEvent, return a domain-shaped
// result, never a raw passthrough of `after`. AuditEvent itself stays the only write path.
import { prisma } from "@/lib/prisma";
import { requireRole, requireZev, requireSuperAdmin, type Actor } from "@/server/auth/guards";
import { partyDisplayName } from "@/server/services/ownership";
import { ACTIVITY_CATEGORIES, DEFAULT_ACTIVITY_CATEGORIES, actionsForCategories, type ActivityCategory } from "@/lib/activity/catalog";

const PAGE_SIZE = 50;

function normalizeCategories(categories: ActivityCategory[] | undefined, fallback: ActivityCategory[]): ActivityCategory[] {
  const valid = (categories ?? []).filter((c) => (ACTIVITY_CATEGORIES as readonly string[]).includes(c));
  return valid.length > 0 ? valid : fallback;
}

export type ListActivityInput = {
  from?: Date;
  to?: Date; // caller passes an already end-of-day'd Date (see src/lib/i18n's endOfDay) for an inclusive upper bound
  categories?: ActivityCategory[];
  actorUserId?: string;
  page?: number;
};

/**
 * PRESIDENT-only (plan §6, user decision P4) — narrower than the existing forensic
 * /podesavanja/audit page, which stays PRESIDENT+ACCOUNTANT and unchanged.
 */
export async function listActivity(actor: Actor, input: ListActivityInput = {}) {
  requireRole(actor, "PRESIDENT");
  const zevId = requireZev(actor);
  const categories = normalizeCategories(input.categories, DEFAULT_ACTIVITY_CATEGORIES);
  const page = Math.max(1, Math.floor(input.page ?? 1));
  const where = {
    zevId,
    action: { in: actionsForCategories(categories) },
    ...(input.from || input.to
      ? { createdAt: { ...(input.from ? { gte: input.from } : {}), ...(input.to ? { lte: input.to } : {}) } }
      : {}),
    ...(input.actorUserId ? { actorId: input.actorUserId } : {}),
  };
  const [rows, total] = await Promise.all([
    prisma.auditEvent.findMany({ where, orderBy: { createdAt: "desc" }, skip: (page - 1) * PAGE_SIZE, take: PAGE_SIZE }),
    prisma.auditEvent.count({ where }),
  ]);
  return { rows, total, page, pageCount: Math.max(1, Math.ceil(total / PAGE_SIZE)) };
}

/** Members of the actor's own tenant, for the `akter` filter select on /aktivnosti. */
export async function listActivityActors(actor: Actor) {
  requireRole(actor, "PRESIDENT");
  const zevId = requireZev(actor);
  const memberships = await prisma.membership.findMany({
    where: { zevId },
    distinct: ["userId"],
    include: { user: { include: { party: true } } },
    orderBy: { createdAt: "asc" },
  });
  return memberships.map((m) => ({
    id: m.user.id,
    label: (m.user.party ? partyDisplayName(m.user.party) : "") || m.user.email,
  }));
}

export type ListAllActivityInput = {
  from?: Date;
  to?: Date; // caller passes an already end-of-day'd Date, same convention as listActivity above
  categories?: ActivityCategory[];
  /** Optional platform-wide filter — omit for "svi ZEV nalozi" (plan §9). */
  zevId?: string;
  actorUserId?: string;
  page?: number;
};

/**
 * Super-admin, cross-tenant view (plan §9, §8 Faza 3) — shares listActivity's catalog/i18n/
 * renderer layer entirely, but gated by requireSuperAdmin (not requireZev/requireRole):
 * zevId here is an OPTIONAL filter, never a mandatory scope, and defaults to ALL FOUR
 * categories (unlike /aktivnosti's OWNER+GOVERNANCE default) — admin.tenant.* and auth.*
 * (SYSTEM) are exactly what a platform operator wants visible here. Deliberately a separate function
 * from listActivity rather than a "see all tenants" branch on it: keeping requireZev's
 * tenant-scoping unconditional on the one function every other (app) page relies on is the
 * whole point of that guard (docs/multitenancy-plan.md §4.4/§6) — see plan §9 for the full
 * rationale against merging the two.
 */
export async function listAllActivity(actor: Actor, input: ListAllActivityInput = {}) {
  requireSuperAdmin(actor);
  const categories = normalizeCategories(input.categories, [...ACTIVITY_CATEGORIES]);
  const page = Math.max(1, Math.floor(input.page ?? 1));
  const where = {
    ...(input.zevId ? { zevId: input.zevId } : {}),
    action: { in: actionsForCategories(categories) },
    ...(input.from || input.to
      ? { createdAt: { ...(input.from ? { gte: input.from } : {}), ...(input.to ? { lte: input.to } : {}) } }
      : {}),
    ...(input.actorUserId ? { actorId: input.actorUserId } : {}),
  };
  const [rows, total] = await Promise.all([
    prisma.auditEvent.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
      include: { zev: { select: { legalName: true, shortName: true } } },
    }),
    prisma.auditEvent.count({ where }),
  ]);
  return { rows, total, page, pageCount: Math.max(1, Math.ceil(total / PAGE_SIZE)) };
}

/**
 * Members of a SPECIFIC tenant, for the `akter` select on /admin/aktivnosti once a concrete
 * ZEV is chosen (plan §9: "akter aktivan tek kad je izabran konkretan ZEV" — a cross-tenant
 * user list with no tenant context wouldn't be useful). Scoped by the given zevId parameter
 * rather than actor.zevId, since a super admin acting here has no zevId of their own.
 */
export async function listActivityActorsForZev(actor: Actor, zevId: string) {
  requireSuperAdmin(actor);
  const memberships = await prisma.membership.findMany({
    where: { zevId },
    distinct: ["userId"],
    include: { user: { include: { party: true } } },
    orderBy: { createdAt: "asc" },
  });
  return memberships.map((m) => ({
    id: m.user.id,
    label: (m.user.party ? partyDisplayName(m.user.party) : "") || m.user.email,
  }));
}
