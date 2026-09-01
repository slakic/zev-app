import { prisma } from "@/lib/prisma";
import { hashPassword, verifyPassword } from "@/server/auth/password";
import { generateToken, sha256 } from "@/server/auth/tokens";
import { queueNotification } from "@/server/notifications/service";
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

// ---- Forgotten-password self-service reset ----
// A public, unauthenticated flow (no Actor) — mirrors the ApprovalToken pattern used for
// voting links: a single-use, hashed, expiring token stored server-side. Requesting a new
// link overwrites any pending one, so an old link a person forwarded or lost stops working
// the moment a fresh one is issued. Never reveals whether an e-mail address has an account —
// requestPasswordReset() always behaves (and returns) the same way either way.

const RESET_TOKEN_TTL_MS = 60 * 60 * 1000; // 1h
const MAX_RESET_WINDOW_MS = 15 * 60 * 1000;
const MAX_RESET_REQUESTS = 5;
const resetRequests = new Map<string, { count: number; first: number }>();

function rateLimitReset(key: string): boolean {
  const now = Date.now();
  const entry = resetRequests.get(key);
  if (!entry || now - entry.first > MAX_RESET_WINDOW_MS) return true;
  return entry.count < MAX_RESET_REQUESTS;
}

function recordResetRequest(key: string) {
  const now = Date.now();
  const entry = resetRequests.get(key);
  if (!entry || now - entry.first > MAX_RESET_WINDOW_MS) {
    resetRequests.set(key, { count: 1, first: now });
  } else {
    entry.count += 1;
  }
}

export async function requestPasswordReset(email: string, appUrl: string, ipHash?: string | null): Promise<void> {
  const key = email.trim().toLowerCase();
  if (!key || !rateLimitReset(key)) {
    if (key) await audit(null, { action: "password_reset.rate_limited", targetType: "User", reason: "too many requests", ipHash });
    return;
  }
  recordResetRequest(key);
  const user = await prisma.user.findUnique({ where: { email: key } });
  if (!user || !user.active) {
    // Deliberately silent: same outcome whether the address exists or not.
    await audit(null, { action: "password_reset.requested_unknown", targetType: "User", ipHash });
    return;
  }
  const token = generateToken();
  await prisma.user.update({
    where: { id: user.id },
    data: { passwordResetTokenHash: sha256(token), passwordResetExpiresAt: new Date(Date.now() + RESET_TOKEN_TTL_MS) },
  });
  await audit({ userId: user.id }, { action: "password_reset.requested", targetType: "User", targetId: user.id, ipHash });
  await queueNotification({
    channel: "EMAIL",
    recipientId: user.partyId,
    toAddress: user.email,
    template: "password-reset",
    subject: "Resetovanje lozinke",
    body:
      `Poštovani,\n\n` +
      `Zatraženo je resetovanje lozinke za nalog ${user.email}.\n\n` +
      `Link za postavljanje nove lozinke (važi 1 sat): ${appUrl}/reset-lozinka/${token}\n\n` +
      `Ako niste vi zatražili resetovanje, slobodno zanemarite ovu poruku — vaša lozinka ostaje nepromijenjena.\n`,
    relatedType: "User",
    relatedId: user.id,
  });
}

export async function inspectPasswordResetToken(token: string): Promise<{ ok: true } | { ok: false; error: "invalid" | "expired" }> {
  const user = await prisma.user.findFirst({ where: { passwordResetTokenHash: sha256(token) } });
  if (!user) return { ok: false, error: "invalid" };
  if (!user.passwordResetExpiresAt || user.passwordResetExpiresAt < new Date()) return { ok: false, error: "expired" };
  return { ok: true };
}

export type ResetPasswordResult = { ok: true } | { ok: false; error: "invalid" | "expired" | "weak" };

export async function resetPassword(token: string, newPassword: string): Promise<ResetPasswordResult> {
  if (newPassword.length < 8) return { ok: false, error: "weak" };
  const user = await prisma.user.findFirst({ where: { passwordResetTokenHash: sha256(token) } });
  if (!user) return { ok: false, error: "invalid" };
  if (!user.passwordResetExpiresAt || user.passwordResetExpiresAt < new Date()) return { ok: false, error: "expired" };
  const newHash = await hashPassword(newPassword);
  await prisma.$transaction(async (tx) => {
    await tx.user.update({
      where: { id: user.id },
      data: { passwordHash: newHash, passwordResetTokenHash: null, passwordResetExpiresAt: null },
    });
    // Force re-login everywhere — a stolen/old session should not survive a password reset.
    await tx.session.updateMany({ where: { userId: user.id }, data: { revokedAt: new Date() } });
  });
  await audit({ userId: user.id }, { action: "password_reset.completed", targetType: "User", targetId: user.id });
  return { ok: true };
}

// A President account is what lets anyone administer the ZEV at all — locking every
// one of them out (by deactivating the last one, or stripping its last PRESIDENT role)
// would be an unrecoverable dead end with no admin left to undo it. Guard both paths.
async function assertNotLastActivePresident(userId: string, action: string) {
  const others = await prisma.user.count({
    where: { id: { not: userId }, active: true, roles: { has: "PRESIDENT" } },
  });
  if (others === 0) {
    throw new Error(`Ne može se ${action} — ovo je jedini aktivni nalog sa rolom Predsjednik.`);
  }
}

export async function deactivateUser(actor: Actor, userId: string, reason: string) {
  requireRole(actor, "PRESIDENT");
  const before = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
  if (before.roles.includes("PRESIDENT")) {
    await assertNotLastActivePresident(userId, "deaktivirati ovaj nalog");
  }
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

export async function activateUser(actor: Actor, userId: string, reason: string) {
  requireRole(actor, "PRESIDENT");
  const before = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
  const user = await prisma.user.update({
    where: { id: userId },
    data: { active: true, deactivatedAt: null },
  });
  await audit(actor, {
    action: "user.activate",
    targetType: "User",
    targetId: userId,
    before: { active: before.active },
    after: { active: true },
    reason,
  });
  return user;
}

export async function updateUserRoles(actor: Actor, userId: string, roles: Role[]) {
  requireRole(actor, "PRESIDENT");
  if (roles.length === 0) throw new Error("Nalog mora imati bar jednu rolu.");
  const before = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
  if (before.roles.includes("PRESIDENT") && !roles.includes("PRESIDENT")) {
    await assertNotLastActivePresident(userId, "ukloniti rolu Predsjednik sa ovog naloga");
  }
  const user = await prisma.user.update({ where: { id: userId }, data: { roles } });
  await audit(actor, {
    action: "user.update_roles",
    targetType: "User",
    targetId: userId,
    before: { roles: before.roles },
    after: { roles },
  });
  return user;
}
