// Server-side authorization. Every service function takes an Actor and calls
// one of these guards — hiding a button in the UI is never the enforcement point.
import type { Role } from "@/generated/prisma/client";

/**
 * Actor is deliberately decoupled from the HTTP session so the service layer
 * can be exercised directly in tests. In the web app an Actor is derived from
 * the session cookie (see requireActor in actor.ts).
 */
export type Actor = {
  userId: string;
  /** Scoped to the actor's active ZEV (see zevId below), not global — sourced from
   * Membership, not User.roles (see docs/multitenancy-plan.md §5). */
  roles: Role[];
  partyId: string | null;
  /**
   * The ZEV (tenant) this actor is currently acting within; null for a super admin
   * with no chosen tenant yet, or a user with no Membership at all. Read by every
   * tenant-scoped service function via requireZev() below (see
   * docs/multitenancy-plan.md §6, Faza 0 korak 5) — optional only so old test
   * fixtures/mocks that predate multitenancy still type-check.
   */
  zevId?: string | null;
  /** Platform-level super admin — unrelated to any single ZEV. Not yet used by any
   * guard below (the /admin area is Faza 1); carried on Actor so it's available once
   * that lands without another Actor shape change. */
  isSuperAdmin?: boolean;
};

export class AuthError extends Error {
  status = 401;
  constructor(message = "Prijava je obavezna.") {
    super(message);
    this.name = "AuthError";
  }
}

export class ForbiddenError extends Error {
  status = 403;
  constructor(message = "Nemate ovlašćenje za ovu radnju.") {
    super(message);
    this.name = "ForbiddenError";
  }
}

export function hasRole(actor: Actor, ...roles: Role[]): boolean {
  return actor.roles.some((r) => roles.includes(r));
}

export function requireRole(actor: Actor | null | undefined, ...roles: Role[]): Actor {
  if (!actor) throw new AuthError();
  if (!hasRole(actor, ...roles)) throw new ForbiddenError();
  return actor;
}

export function requireAnyUser(actor: Actor | null | undefined): Actor {
  if (!actor) throw new AuthError();
  return actor;
}

/**
 * Every service-layer read/write against a tenant-scoped model (see
 * docs/multitenancy-plan.md §4.4) must be filtered/stamped with the actor's
 * own zevId — never trust a zevId supplied by the caller's input. This guard
 * is the single place that turns "actor has no active tenant" into a clear
 * error instead of a silent, unscoped query.
 */
export function requireZev(actor: Actor | null | undefined): string {
  if (!actor) throw new AuthError();
  if (!actor.zevId) throw new ForbiddenError("Nalog nema aktivan ZEV.");
  return actor.zevId;
}

/**
 * Owner-scope guard: management roles may access any party's records;
 * an OWNER may only access records belonging to their own party.
 */
export function requireSelfOrRole(
  actor: Actor | null | undefined,
  ownerPartyId: string,
  ...roles: Role[]
): Actor {
  if (!actor) throw new AuthError();
  if (hasRole(actor, ...roles)) return actor;
  if (actor.partyId && actor.partyId === ownerPartyId) return actor;
  throw new ForbiddenError();
}
