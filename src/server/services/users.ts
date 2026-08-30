import { prisma } from "@/lib/prisma";
import { hashPassword, verifyPassword } from "@/server/auth/password";
import { audit } from "@/server/audit";
import { requireRole, type Actor } from "@/server/auth/guards";
import type { Role } from "@/generated/prisma/client";

const MAX_FAILED_WINDOW_MS = 15 * 60 * 1000;
const MAX_FAILED_ATTEMPTS = 10;
const failedLogins = new Map<string, { count: number; first: number }>();

function rateLimitLogin(key: string): boolean {
  const now = Date.now();
  const entry = failedLogins.get(key);
  if (!entry || now - entry.first > MAX_FAILED_WINDOW_MS) {
    return true;
  }
  return entry.count < MAX_FAILED_ATTEMPTS;
}

function recordFailedLogin(key: string) {
  const now = Date.now();
  const entry = failedLogins.get(key);
  if (!entry || now - entry.first > MAX_FAILED_WINDOW_MS) {
    failedLogins.set(key, { count: 1, first: now });
  } else {
    entry.count += 1;
  }
}

export async function authenticate(email: string, password: string, ipHash?: string | null) {
  const key = `${email.toLowerCase()}`;
  if (!rateLimitLogin(key)) {
    await audit(null, { action: "auth.login.rate_limited", targetType: "User", reason: "too many attempts", ipHash });
    return { ok: false as const, error: "rate_limited" as const };
  }
  const user = await prisma.user.findUnique({ where: { email: email.toLowerCase() } });
  if (!user || !(await verifyPassword(password, user.passwordHash))) {
    recordFailedLogin(key);
    await audit(null, {
      action: "auth.login.failed",
      targetType: "User",
      targetId: user?.id ?? null,
      ipHash,
    });
    return { ok: false as const, error: "invalid" as const };
  }
  if (!user.active) {
    await audit(null, { action: "auth.login.deactivated", targetType: "User", targetId: user.id, ipHash });
    return { ok: false as const, error: "deactivated" as const };
  }
  failedLogins.delete(key);
  await audit({ userId: user.id }, { action: "auth.login", targetType: "User", targetId: user.id, ipHash });
  return { ok: true as const, user };
}

export async function createUserForParty(
  actor: Actor,
  input: { partyId: string; email: string; password: string; roles: Role[] }
) {
  requireRole(actor, "PRESIDENT");
  const user = await prisma.user.create({
    data: {
      email: input.email.toLowerCase(),
      passwordHash: await hashPassword(input.password),
      roles: input.roles,
      partyId: input.partyId,
    },
  });
  await audit(actor, {
    action: "user.create",
    targetType: "User",
    targetId: user.id,
    after: { email: user.email, roles: user.roles, partyId: user.partyId },
  });
  return user;
}

export async function deactivateUser(actor: Actor, userId: string, reason: string) {
  requireRole(actor, "PRESIDENT");
  const before = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
  const user = await prisma.user.update({
    where: { id: userId },
    data: { active: false, deactivatedAt: new Date() },
  });
  await prisma.session.updateMany({ where: { userId }, data: { revokedAt: new Date() } });
  await audit(actor, {
    action: "user.deactivate",
    targetType: "User",
    targetId: userId,
    before: { active: before.active },
    after: { active: false },
    reason,
  });
  return user;
}
