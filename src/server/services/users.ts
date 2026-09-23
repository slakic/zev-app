import { prisma } from "@/lib/prisma";
import { hashPassword, verifyPassword, assertPasswordStrong } from "@/server/auth/password";
import { generateToken, sha256 } from "@/server/auth/tokens";
import { queueNotification } from "@/server/notifications/service";
import { audit } from "@/server/audit";
import { requireRole, requireZev, type Actor } from "@/server/auth/guards";
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
  const zevId = requireZev(actor);
  assertPasswordStrong(input.password);
  // The Party->User link is now set on the Party side (Party.userId — one Party can have
  // a login in each ZEV it's real in, Plans/party-per-tenant-plan.md §5.4), which means a
  // Party that already has a login must be rejected explicitly here — previously that was
  // enforced for free by User.partyId's @unique constraint.
  const user = await prisma.$transaction(async (tx) => {
    // Confirmed invariant (docs/multitenancy-plan.md §8.3): a Party always belongs to
    // exactly one ZEV. Party.zevId has been a required, backfilled column since Korak 3
    // (no longer the soft/nullable field this check used to worry about) — scoping the
    // lookup itself is enough; a mismatched or foreign party now surfaces as "not found"
    // rather than a separate ForbiddenError branch.
    const party = await tx.party.findUniqueOrThrow({ where: { id: input.partyId, zevId } });
    if (party.userId) throw new Error("Ovo lice je već povezano sa korisničkim nalogom.");
    const user = await tx.user.create({
      data: {
        email: input.email.toLowerCase(),
        passwordHash: await hashPassword(input.password),
        roles: input.roles,
      },
    });
    await tx.party.update({ where: { id: input.partyId, zevId }, data: { userId: user.id } });
    // LEGACY double-write, Korak 1 only — dropped in the follow-up migration once
    // Party.userId is confirmed live (Plans/party-per-tenant-plan.md §3.4, §5.4). Captured
    // back into `user` since the returned object is read by callers (e.g. audit() below,
    // tests asserting user.partyId) — the bare tx.user.create() result above predates this.
    const updatedUser = await tx.user.update({ where: { id: user.id }, data: { partyId: input.partyId } });
    if (input.roles.length > 0) {
      await tx.membership.createMany({
        data: input.roles.map((role) => ({ userId: user.id, zevId, role })),
        skipDuplicates: true,
      });
    }
    return updatedUser;
  });
  await audit(actor, {
    action: "user.create",
    targetType: "User",
    targetId: user.id,
    after: { email: user.email, roles: user.roles, partyId: input.partyId },
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
  // No zevId here on purpose: a password reset is account-level, not tied to any one
  // ZEV, and this user may hold memberships in several (or none) — see queueNotification's
  // own doc comment and docs/multitenancy-plan.md §6.4 Modul 6 for the open question this
  // leaves (the row falls back to the temporary default_zev_id() DB default).
  //
  // recipientId is always null now, deliberately (Plans/party-per-tenant-plan.md §5.5):
  // there's no longer "the user's one Party" to attribute this to — they may have none, or
  // one per tenant — and picking one arbitrarily would misfile this notification under
  // whichever tenant happened to come first. toAddress already carries everything this
  // needs. This closes half of the docs/multitenancy-plan.md §6.4 Modul 6 gap instead of
  // widening it.
  await queueNotification({
    channel: "EMAIL",
    recipientId: null,
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
  try {
    assertPasswordStrong(newPassword);
  } catch {
    return { ok: false, error: "weak" };
  }
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

// User is deliberately NOT tenant-scoped (docs/multitenancy-plan.md §4.3/§5) — one
// account can hold Memberships in several ZEVs, or none, so there's no zevId column
// on User itself to filter by. Every function below that acts on a specific userId
// must instead confirm that user is a real Party in the *acting* president's own
// tenant (docs/multitenancy-plan.md §8.3: a Party always belongs to exactly one ZEV)
// before touching anything.
//
// Deliberately Party-based, not Membership-based, even though Membership is "the actual
// source of authorization" for everything else (roles, requireRole). A super admin who
// grants themselves a Membership in a tenant (admin.ts's grantMembership) gets no Party
// there on purpose (Plans/tenant-switching-admin-accounts-plan.md §4.2) — specifically so
// that tenant's own president CANNOT reach that platform-admin account through
// deactivateUser/updateUserRoles here. Porting this to Membership (or to
// `user.parties[0]?.zevId`, whose array order is not guaranteed) would silently remove
// that protection — see Plans/party-per-tenant-plan.md §5.5 and the regression test in
// tests/tenant-isolation.test.ts that locks this down.
async function assertUserInZev(zevId: string, userId: string) {
  const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
  const party = await prisma.party.findFirst({ where: { userId, zevId }, select: { id: true } });
  if (!party) {
    throw new Error("Korisnik nije pronađen u ovom ZEV-u.");
  }
  return user;
}

// A President account is what lets anyone administer the ZEV at all — locking every
// one of them out (by deactivating the last one, or stripping its last PRESIDENT role)
// would be an unrecoverable dead end with no admin left to undo it. Counted via
// Membership (not the legacy User.roles) and scoped to zevId — the previous, global
// (cross-tenant) count would have let ZEV B's roster of presidents mask ZEV A losing
// its only one, an actual bug this Korak-5 pass fixes, not just a filter added for
// consistency.
//
// Exported (Plans/tenant-switching-admin-accounts-plan.md §7, Korak 3) so
// admin.ts's revokeMembership() can reuse the exact same count instead of writing a
// second, drift-prone copy of this query — a PRESIDENT Membership is a PRESIDENT
// Membership whether it's being removed by the tenant's own president or by a
// platform admin from /admin.
export async function assertNotLastActivePresident(zevId: string, userId: string, action: string) {
  const others = await prisma.membership.count({
    where: { zevId, role: "PRESIDENT", userId: { not: userId }, user: { active: true } },
  });
  if (others === 0) {
    throw new Error(`Ne može se ${action} — ovo je jedini aktivni nalog sa rolom Predsjednik.`);
  }
}

// NOTE (known limitation, flagged not fixed by Korak 5 — see docs/multitenancy-plan.md
// §6.4 Modul 6): deactivateUser/activateUser toggle User.active, a GLOBAL flag. For a
// user whose account holds Memberships in more than one ZEV, a PRESIDENT of ZEV A
// deactivating them here also locks them out of ZEV B. Closing that gap means deciding
// what "deactivate" should mean for a multi-ZEV account (per-membership vs. per-account)
// — a product decision, not a query-scoping fix, so it's surfaced here rather than
// resolved unilaterally.

export async function deactivateUser(actor: Actor, userId: string, reason: string) {
  requireRole(actor, "PRESIDENT");
  const zevId = requireZev(actor);
  const before = await assertUserInZev(zevId, userId);
  if (before.roles.includes("PRESIDENT")) {
    await assertNotLastActivePresident(zevId, userId, "deaktivirati ovaj nalog");
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
  const zevId = requireZev(actor);
  const before = await assertUserInZev(zevId, userId);
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
  const zevId = requireZev(actor);
  const before = await assertUserInZev(zevId, userId);
  if (before.roles.includes("PRESIDENT") && !roles.includes("PRESIDENT")) {
    await assertNotLastActivePresident(zevId, userId, "ukloniti rolu Predsjednik sa ovog naloga");
  }
  // Keep User.roles (still read directly by a couple of display spots, e.g. the role
  // checkboxes on the owner detail page) and Membership (the actual source auth reads,
  // see session.ts) in lockstep — reconcile Membership to exactly this role set for the
  // actor's ZEV rather than assuming this is the user's only tenant.
  const [user] = await prisma.$transaction([
    prisma.user.update({ where: { id: userId }, data: { roles } }),
    prisma.membership.deleteMany({ where: { userId, zevId, role: { notIn: roles } } }),
    ...roles.map((role) =>
      prisma.membership.upsert({
        where: { userId_zevId_role: { userId, zevId, role } },
        create: { userId, zevId, role },
        update: {},
      })
    ),
  ]);
  await audit(actor, {
    action: "user.update_roles",
    targetType: "User",
    targetId: userId,
    before: { roles: before.roles },
    after: { roles },
  });
  return user;
}
