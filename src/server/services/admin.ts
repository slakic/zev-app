// Platform-level tenant management for the /admin area (super admin only — see
// docs/multitenancy-plan.md §4.3/§8, Faza 1). Every export here is guarded by
// requireSuperAdmin(), not requireZev()/requireRole() like the rest of the service
// layer — these functions deliberately operate ACROSS tenants, which is exactly what
// the rest of the app's zevId-scoping (Faza 0) is built to prevent everywhere else.
import { prisma } from "@/lib/prisma";
import { requireSuperAdmin, type Actor } from "@/server/auth/guards";
import { hashPassword, assertPasswordStrong } from "@/server/auth/password";
import { setSessionActiveZev } from "@/server/auth/session";
import { queueNotification } from "@/server/notifications/service";
import { audit } from "@/server/audit";
import { seedDefaultSettings } from "@/server/services/settings";
import { assertNotLastActivePresident } from "@/server/services/users";
import type { Role, ZevTier } from "@/generated/prisma/client";

/** Roles a platform admin may assign from /admin — see
 * Plans/tenant-switching-admin-accounts-plan.md §5.2: OWNER is deliberately excluded
 * because ownership always requires proof of title (addOwnershipStake's mandatory
 * upload) — a super admin creating "owners" from the platform console would bypass
 * that requirement. To grant OWNER access, switch into the tenant (switchActiveZev)
 * and use /vlasnici, where the rule actually applies. */
const ASSIGNABLE_TENANT_ROLES: Role[] = ["PRESIDENT", "ACCOUNTANT"];

function assertAssignableRole(role: Role): void {
  if (!ASSIGNABLE_TENANT_ROLES.includes(role)) {
    throw new Error("Dozvoljene role su Predsjednik i Računovođa.");
  }
}

export async function listTenants(actor: Actor) {
  requireSuperAdmin(actor);
  // Two independent queries rather than a second filtered include on the same relation
  // (Prisma can't alias `memberships` twice under different `where`s in one call) — this
  // tells the list page whether to offer "Uđi" for each row, per
  // Plans/tenant-switching-admin-accounts-plan.md §2.3(c).
  const [zevs, myMemberships] = await Promise.all([
    prisma.zev.findMany({
      orderBy: { legalName: "asc" },
      include: {
        _count: { select: { buildings: true, units: true, parties: true } },
        memberships: {
          where: { role: "PRESIDENT" },
          include: { user: true },
          orderBy: { createdAt: "asc" },
          take: 1,
        },
      },
    }),
    prisma.membership.findMany({ where: { userId: actor.userId }, select: { zevId: true } }),
  ]);
  const myZevIds = new Set(myMemberships.map((m) => m.zevId));
  return zevs.map((z) => ({ ...z, hasMyMembership: myZevIds.has(z.id) }));
}

export async function getTenant(actor: Actor, zevId: string) {
  requireSuperAdmin(actor);
  return prisma.zev.findUniqueOrThrow({
    where: { id: zevId },
    include: {
      _count: { select: { buildings: true, units: true, parties: true } },
      memberships: { include: { user: true }, orderBy: { createdAt: "asc" } },
    },
  });
}

/**
 * Suspend or reactivate a tenant (Faza 1, item 4's precondition — see
 * docs/multitenancy-plan.md §"Faza 1" — and useful standalone for Faza 2's tier editing).
 * Suspension is already fully enforced elsewhere: requireActor() checks
 * getAuthContext().zevSuspended on every request and signs a still-active session out to
 * /login?err=zev_suspended (src/server/actor.ts, src/server/auth/session.ts) — this
 * function only has to flip Zev.active; no separate session-revocation step is needed,
 * the next request from anyone in that tenant is rejected on its own.
 *
 * Deliberately does NOT delete or touch any tenant data — this is the safe alternative
 * to a full wipeTenantData (see docs/multitenancy-plan.md addendum, 2026-09-09): archive
 * a tenant you're done with (e.g. seeded demo data in tenant #1) by suspending it here,
 * with its full audit trail intact, then create a fresh tenant for real data instead of
 * trying to selectively erase the old one.
 */
export async function setTenantActive(actor: Actor, zevId: string, active: boolean, reason: string) {
  requireSuperAdmin(actor);
  const trimmedReason = reason.trim();
  if (!trimmedReason) throw new Error("Razlog je obavezan.");

  const zev = await prisma.zev.findUniqueOrThrow({ where: { id: zevId } });
  if (zev.active === active) {
    throw new Error(active ? "ZEV je već aktivan." : "ZEV je već suspendovan.");
  }

  const updated = await prisma.zev.update({ where: { id: zevId }, data: { active } });

  // Suspending the tenant you're currently active in would otherwise log YOU out on the
  // very next request — requireActor() checks zevSuspended and calls destroySession()
  // (src/server/actor.ts) — instead of just leaving you on /admin where you started.
  // Clearing the session's own activeZevId here means the next request resolves it to
  // null (or another Membership, if you have one) and you land back on /admin cleanly.
  // See Plans/tenant-switching-admin-accounts-plan.md §5.4/§8 item 5.
  if (!active && actor.zevId === zevId && actor.sessionId) {
    await setSessionActiveZev(actor.sessionId, null);
  }

  await audit(
    { ...actor, zevId },
    {
      action: active ? "admin.tenant.activate" : "admin.tenant.suspend",
      targetType: "Zev",
      targetId: zevId,
      before: { active: zev.active },
      after: { active: updated.active },
      reason: trimmedReason,
    }
  );

  return updated;
}

export async function createTenant(
  actor: Actor,
  data: {
    legalName: string;
    shortName?: string | null;
    jib?: string | null;
    registeredAddress?: string | null;
    city?: string | null;
    municipality?: string | null;
    tier: ZevTier;
    presidentFirstName: string;
    presidentLastName: string;
    presidentEmail: string;
    presidentPhone?: string | null;
    presidentPassword: string;
  }
) {
  requireSuperAdmin(actor);

  const legalName = data.legalName.trim();
  if (!legalName) throw new Error("Naziv ZEV-a je obavezan.");
  const email = data.presidentEmail.trim().toLowerCase();
  if (!email) throw new Error("E-mail adresa predsjednika je obavezna.");
  const firstName = data.presidentFirstName.trim();
  const lastName = data.presidentLastName.trim();
  if (!firstName || !lastName) throw new Error("Ime i prezime predsjednika su obavezni.");
  assertPasswordStrong(data.presidentPassword);

  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) throw new Error(`Nalog sa e-mail adresom "${email}" već postoji.`);

  // Password is set directly by the super admin, not a random/never-communicated
  // placeholder behind a reset-link — see Plans/tenant-switching-admin-accounts-plan.md
  // §1.3/§6.1. The previous placeholder+reset-token flow left onboarding structurally
  // unfinishable: the president had no way to read the reset e-mail (mock provider,
  // no membership in the new tenant to view /podesavanja/poruke) and no way to log in.
  const passwordHash = await hashPassword(data.presidentPassword);

  const { zev, party } = await prisma.$transaction(async (tx) => {
    const zev = await tx.zev.create({
      data: {
        legalName,
        shortName: data.shortName?.trim() || null,
        jib: data.jib?.trim() || null,
        registeredAddress: data.registeredAddress?.trim() || null,
        city: data.city?.trim() || null,
        municipality: data.municipality?.trim() || null,
        tier: data.tier,
      },
    });
    const party = await tx.party.create({
      data: {
        zevId: zev.id,
        kind: "PERSON",
        firstName,
        lastName,
        email,
        phone: data.presidentPhone?.trim() || null,
      },
    });
    const user = await tx.user.create({
      data: {
        email,
        passwordHash,
        roles: ["PRESIDENT"], // legacy column — see User.roles comment in schema.prisma
        partyId: party.id,
      },
    });
    await tx.membership.create({ data: { userId: user.id, zevId: zev.id, role: "PRESIDENT" } });
    await seedDefaultSettings(tx, zev.id);
    return { zev, party };
  });

  await audit(
    { ...actor, zevId: zev.id },
    {
      action: "admin.tenant.create",
      targetType: "Zev",
      targetId: zev.id,
      after: { legalName: zev.legalName, tier: zev.tier, presidentEmail: email },
    }
  );

  await queueNotification({
    zevId: zev.id,
    channel: "EMAIL",
    recipientId: party.id,
    toAddress: email,
    template: "tenant-welcome",
    subject: "Nalog za upravljanje ZEV-om je kreiran",
    body:
      `Poštovani ${firstName} ${lastName},\n\n` +
      `Za vas je kreiran nalog predsjednika za "${zev.legalName}" u aplikaciji ZEV upravnik.\n\n` +
      `Početnu lozinku je postavio administrator platforme i saopštio vam je odvojenim putem. ` +
      `Prijavite se na uobičajenoj stranici za prijavu sa e-mail adresom "${email}", a lozinku ` +
      `možete promijeniti u svakom trenutku preko linka "Zaboravljena lozinka" na stranici za prijavu.\n`,
    relatedType: "Zev",
    relatedId: zev.id,
  });

  return zev;
}

// ---- Korak 3: cross-tenant account administration ----
// Plans/tenant-switching-admin-accounts-plan.md §5. New functions here, not extensions
// of createUserForParty (users.ts) — that function is deliberately gated with
// requireRole(actor, "PRESIDENT") + requireZev(actor), exactly the guard that stops a
// president of ZEV A from creating accounts in ZEV B. Cross-tenant account creation
// belongs here, behind requireSuperAdmin, where zevId is a plain argument the caller
// supplies rather than something read off the actor.

/**
 * Create a brand-new person/organization + User + Membership in an existing tenant —
 * the cross-tenant twin of what createTenant() above does for a tenant's first
 * president. A Party is always created (§4.2): without one the account would be
 * invisible/unmanageable from that tenant's own /vlasnici and could never be entered
 * into the ZEV's office-holder register (/organi).
 */
export async function createTenantAccount(
  actor: Actor,
  zevId: string,
  data: {
    role: Role;
    firstName?: string | null;
    lastName?: string | null;
    orgName?: string | null;
    email: string;
    phone?: string | null;
    password: string;
  }
) {
  requireSuperAdmin(actor);
  assertAssignableRole(data.role);
  await prisma.zev.findUniqueOrThrow({ where: { id: zevId } });

  const email = data.email.trim().toLowerCase();
  if (!email) throw new Error("E-mail adresa je obavezna.");
  const firstName = data.firstName?.trim() || "";
  const lastName = data.lastName?.trim() || "";
  const orgName = data.orgName?.trim() || "";
  if (!orgName && (!firstName || !lastName)) {
    throw new Error("Unesite ime i prezime, ili naziv organizacije.");
  }
  assertPasswordStrong(data.password);

  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) throw new Error(`Nalog sa e-mail adresom "${email}" već postoji.`);

  const passwordHash = await hashPassword(data.password);

  const { user, party } = await prisma.$transaction(async (tx) => {
    const party = await tx.party.create({
      data: {
        zevId,
        kind: orgName ? "ORGANIZATION" : "PERSON",
        firstName: orgName ? null : firstName,
        lastName: orgName ? null : lastName,
        orgName: orgName || null,
        email,
        phone: data.phone?.trim() || null,
      },
    });
    const user = await tx.user.create({
      data: {
        email,
        passwordHash,
        roles: [data.role], // legacy column — see User.roles comment in schema.prisma
        partyId: party.id,
      },
    });
    await tx.membership.create({ data: { userId: user.id, zevId, role: data.role } });
    return { user, party };
  });

  await audit(
    { ...actor, zevId },
    {
      action: "admin.account.create",
      targetType: "User",
      targetId: user.id,
      after: { email, role: data.role },
    }
  );

  await queueNotification({
    zevId,
    channel: "EMAIL",
    recipientId: party.id,
    toAddress: email,
    template: "tenant-account-welcome",
    subject: "Nalog za upravljanje ZEV-om je kreiran",
    body:
      `Poštovani,\n\n` +
      `Za vas je kreiran nalog u aplikaciji ZEV upravnik. ` +
      `Početnu lozinku je postavio administrator platforme i saopštio vam je odvojenim ` +
      `putem. Prijavite se na uobičajenoj stranici za prijavu sa e-mail adresom "${email}", ` +
      `a lozinku možete promijeniti u svakom trenutku preko linka "Zaboravljena lozinka" na ` +
      `stranici za prijavu.\n`,
    relatedType: "Zev",
    relatedId: zevId,
  });

  return user;
}

/**
 * Add a Membership for an EXISTING user in a tenant — no new Party, no new User. Covers
 * both "an accounting firm already serving another ZEV also takes this one on" (§5.3)
 * and a super admin granting themselves access (§3, "Dodaj mi pristup"): the caller
 * passes their own email for the latter, and the audit action distinguishes the two
 * (admin.membership.grant_self vs admin.membership.grant) without a separate code path.
 *
 * Known, accepted limitation carried from §5.3/§8 item 1: the granted user gets no
 * Party in this tenant (User.partyId is @unique — one Party per user, ever), so they
 * won't appear on this tenant's /vlasnici and can't be entered into /organi here.
 */
export async function grantMembership(
  actor: Actor,
  zevId: string,
  data: { email: string; role: Role; reason?: string | null }
) {
  requireSuperAdmin(actor);
  assertAssignableRole(data.role);
  await prisma.zev.findUniqueOrThrow({ where: { id: zevId } });

  const email = data.email.trim().toLowerCase();
  const user = await prisma.user.findUnique({ where: { email } });
  if (!user) throw new Error(`Ne postoji nalog sa e-mail adresom "${email}".`);

  const existing = await prisma.membership.findUnique({
    where: { userId_zevId_role: { userId: user.id, zevId, role: data.role } },
  });
  if (existing) throw new Error("Ovaj nalog već ima ovu rolu u ovom ZEV-u.");

  const membership = await prisma.membership.create({ data: { userId: user.id, zevId, role: data.role } });

  await audit(
    { ...actor, zevId },
    {
      action: user.id === actor.userId ? "admin.membership.grant_self" : "admin.membership.grant",
      targetType: "User",
      targetId: user.id,
      after: { email: user.email, role: data.role },
      reason: data.reason?.trim() || null,
    }
  );

  return membership;
}

/**
 * Remove a Membership row — the mandatory counterpart to grantMembership (§3.4): without
 * it a platform admin only ever accumulates president-level access across every tenant
 * they've ever touched. Reuses assertNotLastActivePresident (users.ts) so a tenant can't
 * be left with zero active presidents through this door either — the same guard the
 * tenant's own president is subject to on /vlasnici.
 *
 * Revoking the caller's own membership is allowed on purpose (this is also how "Ukloni
 * moj pristup" on /admin works) — resolveActiveZev() picks up the change on the caller's
 * next request and moves their session to another Membership, or to null, on its own.
 */
export async function revokeMembership(
  actor: Actor,
  zevId: string,
  data: { userId: string; role: Role; reason: string }
) {
  requireSuperAdmin(actor);
  const trimmedReason = data.reason.trim();
  if (!trimmedReason) throw new Error("Razlog je obavezan.");

  const membership = await prisma.membership.findUnique({
    where: { userId_zevId_role: { userId: data.userId, zevId, role: data.role } },
    include: { user: true },
  });
  if (!membership) throw new Error("Članstvo nije pronađeno.");

  if (data.role === "PRESIDENT") {
    await assertNotLastActivePresident(zevId, data.userId, "ukloniti pristup ovom nalogu");
  }

  await prisma.membership.delete({ where: { id: membership.id } });

  await audit(
    { ...actor, zevId },
    {
      action: "admin.membership.revoke",
      targetType: "User",
      targetId: data.userId,
      before: { role: data.role, email: membership.user.email },
      reason: trimmedReason,
    }
  );
}
