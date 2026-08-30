// Server-side authorization. Every service function takes an Actor and calls
// one of these guards — hiding a button in the UI is never the enforcement point.
import type { Role } from "@/generated/prisma/client";

/**
 * Actor is deliberately decoupled from the HTTP session so the service layer
 * can be exercised directly in tests. In the web app an Actor is derived from
 * the session cookie (see requireActor in actions.ts).
 */
export type Actor = {
  userId: string;
  roles: Role[];
  partyId: string | null;
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
