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
  return listZevMembersWithPartyLabel(zevId);
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
  return listZevMembersWithPartyLabel(zevId);
}

/**
 * Resolve display names for the (actorId, zevId) pairs actually present on a page of
 * cross-tenant results, for /admin/aktivnosti's Akter column. Deliberately independent of
 * whether a `zev` filter is active: listActivityActorsForZev's membership list only exists
 * to populate the FILTER's dropdown options (plan §9's "akter aktivan tek kad je izabran
 * konkretan ZEV" governs that select, not whether already-fetched rows can show a name) — with
 * "Svi ZEV nalozi" selected that list is legitimately empty, but every row here already
 * carries its own zevId, so each actorId can still be resolved correctly without it. Queries
 * Party directly (party-per-tenant: at most one Party per (userId, zevId),
 * Plans/party-per-tenant-plan.md §4) rather than walking Membership, since the exact
 * (userId, zevId) pairs are already known and a full member list isn't needed. Falls back to
 * User.email when a user has no Party in that specific zev (e.g. a super admin with no
 * Membership there, or a legacy row).
 */
export async function resolveActorLabels(actor: Actor, pairs: { userId: string | null; zevId: string | null }[]) {
  requireSuperAdmin(actor);
  const known = pairs.filter((p): p is { userId: string; zevId: string } => p.userId != null && p.zevId != null);
  const result = new Map<string, string>();
  if (known.length === 0) return result;
  const userIds = [...new Set(known.map((p) => p.userId))];
  const zevIds = [...new Set(known.map((p) => p.zevId))];
  const [parties, users] = await Promise.all([
    prisma.party.findMany({
      where: { userId: { in: userIds }, zevId: { in: zevIds } },
      select: { userId: true, zevId: true, kind: true, firstName: true, lastName: true, orgName: true },
    }),
    prisma.user.findMany({ where: { id: { in: userIds } }, select: { id: true, email: true } }),
  ]);
  const partyByKey = new Map(parties.map((p) => [`${p.userId}:${p.zevId}`, partyDisplayName(p)]));
  const emailById = new Map(users.map((u) => [u.id, u.email]));
  for (const { userId, zevId } of known) {
    const key = `${userId}:${zevId}`;
    result.set(key, partyByKey.get(key) || emailById.get(userId) || "");
  }
  return result;
}

/**
 * Shared by listActivityActors/listActivityActorsForZev above — each member's Party is now
 * looked up scoped to THIS zevId (Plans/party-per-tenant-plan.md §4), not the old global
 * user.party, so a platform admin with Memberships (and Parties) in several tenants shows
 * the right name for each tenant's actor list instead of whichever Party they happened to
 * get first.
 */
async function listZevMembersWithPartyLabel(zevId: string) {
  const memberships = await prisma.membership.findMany({
    where: { zevId },
    distinct: ["userId"],
    include: { user: { include: { parties: { where: { zevId }, take: 1 } } } },
    orderBy: { createdAt: "asc" },
  });
  return memberships.map((m) => ({
    id: m.user.id,
    label: (m.user.parties[0] ? partyDisplayName(m.user.parties[0]) : "") || m.user.email,
  }));
}
