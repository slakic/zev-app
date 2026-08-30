import "server-only";
import { redirect } from "next/navigation";
import { getAuthContext } from "@/server/auth/session";
import type { Actor } from "@/server/auth/guards";
import type { Role } from "@/generated/prisma/client";

/** Resolve the Actor for server components / actions; redirects to /login when absent. */
export async function requireActor(...roles: Role[]): Promise<Actor & { displayName: string; email: string }> {
  const ctx = await getAuthContext();
  if (!ctx) redirect("/login");
  const actor = {
    userId: ctx.userId,
    roles: ctx.roles,
    partyId: ctx.partyId,
    displayName: ctx.displayName,
    email: ctx.email,
  };
  if (roles.length > 0 && !ctx.roles.some((r) => roles.includes(r))) {
    redirect("/?err=forbidden");
  }
  return actor;
}

export async function maybeActor(): Promise<(Actor & { displayName: string }) | null> {
  const ctx = await getAuthContext();
  if (!ctx) return null;
  return { userId: ctx.userId, roles: ctx.roles, partyId: ctx.partyId, displayName: ctx.displayName };
}

export function isManagement(actor: Actor): boolean {
  return actor.roles.includes("PRESIDENT") || actor.roles.includes("ACCOUNTANT");
}
