import "server-only";
import { redirect } from "next/navigation";
import { getAuthContext, destroySession } from "@/server/auth/session";
import type { Actor } from "@/server/auth/guards";
import type { Role } from "@/generated/prisma/client";

/** Resolve the Actor for server components / actions; redirects to /login when absent. */
export async function requireActor(...roles: Role[]): Promise<Actor & { displayName: string; email: string }> {
  const ctx = await getAuthContext();
  if (!ctx) redirect("/login");
  // A suspended tenant should read as clearly blocked, not silently forbidden. Sign the
  // session out and land on /login (not "/?err=..." — that page calls requireActor()
  // itself and would redirect right back here in a loop for a still-active session).
  if (ctx.zevSuspended) {
    await destroySession();
    redirect("/login?err=zev_suspended");
  }
  const actor = {
    userId: ctx.userId,
    roles: ctx.roles,
    partyId: ctx.partyId,
    zevId: ctx.zevId,
    isSuperAdmin: ctx.isSuperAdmin,
    sessionId: ctx.sessionId,
    displayName: ctx.displayName,
    email: ctx.email,
  };
  if (roles.length > 0 && !ctx.roles.some((r) => roles.includes(r))) {
    redirect("/?err=forbidden");
  }
  return actor;
}

/**
 * Resolve the Actor for /admin server components / actions. Redirects to /login when
 * not signed in, and to / (not /login) when signed in but not a super admin — this
 * mirrors requireActor()'s "?err=forbidden" pattern rather than treating a regular
 * user visiting /admin as unauthenticated. Deliberately skips the zevSuspended check:
 * /admin operates at the platform level, not within any one tenant.
 */
export async function requireSuperAdminActor(): Promise<Actor & { displayName: string; email: string }> {
  const ctx = await getAuthContext();
  if (!ctx) redirect("/login");
  if (!ctx.isSuperAdmin) redirect("/?err=forbidden");
  return {
    userId: ctx.userId,
    roles: ctx.roles,
    partyId: ctx.partyId,
    zevId: ctx.zevId,
    isSuperAdmin: ctx.isSuperAdmin,
    sessionId: ctx.sessionId,
    displayName: ctx.displayName,
    email: ctx.email,
  };
}

export async function maybeActor(): Promise<(Actor & { displayName: string }) | null> {
  const ctx = await getAuthContext();
  if (!ctx) return null;
  return {
    userId: ctx.userId,
    roles: ctx.roles,
    partyId: ctx.partyId,
    zevId: ctx.zevId,
    isSuperAdmin: ctx.isSuperAdmin,
    sessionId: ctx.sessionId,
    displayName: ctx.displayName,
  };
}

export function isManagement(actor: Actor): boolean {
  return actor.roles.includes("PRESIDENT") || actor.roles.includes("ACCOUNTANT");
}
