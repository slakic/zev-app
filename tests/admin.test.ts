import { describe, it, expect } from "vitest";
import { prisma } from "@/lib/prisma";
import {
  createTenant,
  listTenants,
  createTenantAccount,
  grantMembership,
  revokeMembership,
  setTenantActive,
} from "@/server/services/admin";
import { authenticate } from "@/server/services/users";
import { ForbiddenError } from "@/server/auth/guards";
import { createSuperAdminActor, createFixture, uid } from "./helpers";

function tenantInput(t: string, overrides: Partial<Parameters<typeof createTenant>[1]> = {}) {
  return {
    legalName: `ZEV Admin Test ${t}`,
    tier: "FULL" as const,
    presidentFirstName: "Petar",
    presidentLastName: `Predsjednik-${t}`,
    presidentEmail: `${t}-pres@platform-created.test`,
    presidentPassword: "Test1234!",
    ...overrides,
  };
}

describe("createTenant (super admin, cross-tenant onboarding)", () => {
  it("creates a Zev + Party + User + PRESIDENT Membership + default settings", async () => {
    const admin = await createSuperAdminActor("ct-full");
    const t = uid("ct-full");
    const zev = await createTenant(admin, tenantInput(t));

    const party = await prisma.party.findFirstOrThrow({ where: { zevId: zev.id } });
    expect(party.email).toBe(`${t}-pres@platform-created.test`);

    const user = await prisma.user.findUniqueOrThrow({ where: { email: `${t}-pres@platform-created.test` } });
    expect(user.partyId).toBe(party.id);

    const membership = await prisma.membership.findFirstOrThrow({ where: { zevId: zev.id, userId: user.id } });
    expect(membership.role).toBe("PRESIDENT");

    const settingsCount = await prisma.setting.count({ where: { zevId: zev.id } });
    expect(settingsCount).toBeGreaterThan(0);
  });

  it("the password the super admin set actually authenticates the new president — no token/reset-link needed", async () => {
    const admin = await createSuperAdminActor("ct-login");
    const t = uid("ct-login");
    await createTenant(admin, tenantInput(t, { presidentPassword: "PlatformSet1!" }));

    const result = await authenticate(`${t}-pres@platform-created.test`, "PlatformSet1!");
    expect(result.ok).toBe(true);

    // No reset token is issued anymore — the old chicken-and-egg onboarding flow.
    const user = await prisma.user.findUniqueOrThrow({ where: { email: `${t}-pres@platform-created.test` } });
    expect(user.passwordResetTokenHash).toBeNull();
  });

  it("rejects a president password shorter than 8 characters", async () => {
    const admin = await createSuperAdminActor("ct-weak");
    const t = uid("ct-weak");
    await expect(createTenant(admin, tenantInput(t, { presidentPassword: "short" }))).rejects.toThrow(/8 znakova/);

    // Nothing was created — the failure happens before the transaction.
    const existing = await prisma.user.findUnique({ where: { email: `${t}-pres@platform-created.test` } });
    expect(existing).toBeNull();
  });

  it("rejects a duplicate president e-mail", async () => {
    const admin = await createSuperAdminActor("ct-dup");
    const t = uid("ct-dup");
    await createTenant(admin, tenantInput(t));
    await expect(createTenant(admin, tenantInput(t))).rejects.toThrow(/već postoji/);
  });

  it("rejects a non-super-admin actor", async () => {
    const f = await createFixture("ct-forbidden");
    const t = uid("ct-forbidden");
    await expect(createTenant(f.president, tenantInput(t))).rejects.toThrow(ForbiddenError);
    await expect(listTenants(f.president)).rejects.toThrow(ForbiddenError);
  });
});

// ---------------------------------------------------------------------------
// Korak 3 (Plans/tenant-switching-admin-accounts-plan.md §5) — cross-tenant
// account administration: createTenantAccount, grantMembership, revokeMembership,
// plus the setTenantActive self-suspend session fix.
// ---------------------------------------------------------------------------

describe("createTenantAccount (super admin creates a brand-new account in an existing tenant)", () => {
  it("creates a Party + User + Membership with the given role", async () => {
    const admin = await createSuperAdminActor("cta-basic");
    const f = await createFixture("cta-basic");
    const t = uid("cta-basic");
    const email = `${t}@platform-created.test`;

    const user = await createTenantAccount(admin, f.zev.id, {
      role: "ACCOUNTANT",
      firstName: "Nova",
      lastName: `Racunovodja-${t}`,
      email,
      password: "Test1234!",
    });

    const party = await prisma.party.findFirstOrThrow({ where: { zevId: f.zev.id, email } });
    expect(party.firstName).toBe("Nova");
    expect(user.partyId).toBe(party.id);

    const membership = await prisma.membership.findFirstOrThrow({ where: { zevId: f.zev.id, userId: user.id } });
    expect(membership.role).toBe("ACCOUNTANT");
  });

  it("accepts an organization account via orgName instead of firstName/lastName", async () => {
    const admin = await createSuperAdminActor("cta-org");
    const f = await createFixture("cta-org");
    const t = uid("cta-org");
    const email = `${t}@platform-created.test`;

    const user = await createTenantAccount(admin, f.zev.id, {
      role: "ACCOUNTANT",
      orgName: "Knjigovodstvena agencija d.o.o.",
      email,
      password: "Test1234!",
    });

    const party = await prisma.party.findUniqueOrThrow({ where: { id: user.partyId! } });
    expect(party.kind).toBe("ORGANIZATION");
    expect(party.orgName).toBe("Knjigovodstvena agencija d.o.o.");
  });

  it("rejects the OWNER role — ownership must go through /vlasnici with proof of title", async () => {
    const admin = await createSuperAdminActor("cta-owner");
    const f = await createFixture("cta-owner");
    const t = uid("cta-owner");
    await expect(
      createTenantAccount(admin, f.zev.id, {
        role: "OWNER",
        firstName: "X",
        lastName: "Y",
        email: `${t}@platform-created.test`,
        password: "Test1234!",
      })
    ).rejects.toThrow(/Predsjednik i Računovođa/);
  });

  it("rejects a weak password", async () => {
    const admin = await createSuperAdminActor("cta-weak");
    const f = await createFixture("cta-weak");
    const t = uid("cta-weak");
    await expect(
      createTenantAccount(admin, f.zev.id, {
        role: "ACCOUNTANT",
        firstName: "X",
        lastName: "Y",
        email: `${t}@platform-created.test`,
        password: "short",
      })
    ).rejects.toThrow(/8 znakova/);
  });

  it("rejects a duplicate e-mail", async () => {
    const admin = await createSuperAdminActor("cta-dup");
    const f = await createFixture("cta-dup");
    const t = uid("cta-dup");
    const email = `${t}@platform-created.test`;
    await createTenantAccount(admin, f.zev.id, { role: "ACCOUNTANT", firstName: "X", lastName: "Y", email, password: "Test1234!" });
    await expect(
      createTenantAccount(admin, f.zev.id, { role: "ACCOUNTANT", firstName: "X", lastName: "Y", email, password: "Test1234!" })
    ).rejects.toThrow(/već postoji/);
  });

  it("rejects a non-super-admin actor", async () => {
    const f = await createFixture("cta-forbidden");
    const t = uid("cta-forbidden");
    await expect(
      createTenantAccount(f.president, f.zev.id, {
        role: "ACCOUNTANT",
        firstName: "X",
        lastName: "Y",
        email: `${t}@platform-created.test`,
        password: "Test1234!",
      })
    ).rejects.toThrow(ForbiddenError);
  });
});

describe("grantMembership (existing user gets a Membership in another tenant, no new Party)", () => {
  it("adds a Membership for an existing user, without creating a Party in the target tenant", async () => {
    const admin = await createSuperAdminActor("gm-basic");
    const home = await createFixture("gm-basic-home");
    const other = await createFixture("gm-basic-other");
    const accountantUser = await prisma.user.findUniqueOrThrow({ where: { id: home.accountant.userId } });
    const partyCountBefore = await prisma.party.count({ where: { zevId: other.zev.id } });

    await grantMembership(admin, other.zev.id, { email: accountantUser.email, role: "ACCOUNTANT" });

    const membership = await prisma.membership.findUniqueOrThrow({
      where: { userId_zevId_role: { userId: accountantUser.id, zevId: other.zev.id, role: "ACCOUNTANT" } },
    });
    expect(membership.zevId).toBe(other.zev.id);
    // The known, accepted limitation (§5.3/§8): no Party is created for this account in
    // the *second* tenant — User.partyId is @unique, so it keeps its one Party in "home".
    const partyCountAfter = await prisma.party.count({ where: { zevId: other.zev.id } });
    expect(partyCountAfter).toBe(partyCountBefore);
    const stillOnlyOneParty = await prisma.user.findUniqueOrThrow({ where: { id: accountantUser.id } });
    expect(stillOnlyOneParty.partyId).toBe(home.accountantParty.id);
  });

  it("rejects an unknown e-mail address", async () => {
    const admin = await createSuperAdminActor("gm-unknown");
    const f = await createFixture("gm-unknown");
    await expect(
      grantMembership(admin, f.zev.id, { email: "nobody-at-all@example.test", role: "ACCOUNTANT" })
    ).rejects.toThrow(/Ne postoji nalog/);
  });

  it("rejects a duplicate (userId, zevId, role) membership with a readable error", async () => {
    const admin = await createSuperAdminActor("gm-dup");
    const home = await createFixture("gm-dup-home");
    const other = await createFixture("gm-dup-other");
    const accountantUser = await prisma.user.findUniqueOrThrow({ where: { id: home.accountant.userId } });

    await grantMembership(admin, other.zev.id, { email: accountantUser.email, role: "ACCOUNTANT" });
    await expect(
      grantMembership(admin, other.zev.id, { email: accountantUser.email, role: "ACCOUNTANT" })
    ).rejects.toThrow(/već ima ovu rolu/);
  });

  it("rejects the OWNER role", async () => {
    const admin = await createSuperAdminActor("gm-owner");
    const home = await createFixture("gm-owner-home");
    const other = await createFixture("gm-owner-other");
    const accountantUser = await prisma.user.findUniqueOrThrow({ where: { id: home.accountant.userId } });
    await expect(
      grantMembership(admin, other.zev.id, { email: accountantUser.email, role: "OWNER" })
    ).rejects.toThrow(/Predsjednik i Računovođa/);
  });

  it("distinguishes granting the super admin's own access (grant_self) from granting someone else (grant) in the audit trail", async () => {
    const admin = await createSuperAdminActor("gm-self");
    const f = await createFixture("gm-self");
    const home = await createFixture("gm-self-other-user-home");
    const otherUser = await prisma.user.findUniqueOrThrow({ where: { id: home.accountant.userId } });
    const adminUser = await prisma.user.findUniqueOrThrow({ where: { id: admin.userId } });

    await grantMembership(admin, f.zev.id, { email: adminUser.email, role: "PRESIDENT" });
    await grantMembership(admin, f.zev.id, { email: otherUser.email, role: "ACCOUNTANT" });

    const selfEvent = await prisma.auditEvent.findFirst({
      where: { zevId: f.zev.id, action: "admin.membership.grant_self", targetId: admin.userId },
    });
    expect(selfEvent).not.toBeNull();
    const otherEvent = await prisma.auditEvent.findFirst({
      where: { zevId: f.zev.id, action: "admin.membership.grant", targetId: otherUser.id },
    });
    expect(otherEvent).not.toBeNull();
  });

  it("rejects a non-super-admin actor", async () => {
    const f = await createFixture("gm-forbidden");
    const home = await createFixture("gm-forbidden-home");
    const accountantUser = await prisma.user.findUniqueOrThrow({ where: { id: home.accountant.userId } });
    await expect(
      grantMembership(f.president, f.zev.id, { email: accountantUser.email, role: "ACCOUNTANT" })
    ).rejects.toThrow(ForbiddenError);
  });
});

describe("revokeMembership (removes a Membership row)", () => {
  it("removes the Membership row and writes an audit record", async () => {
    const admin = await createSuperAdminActor("rm-basic");
    const f = await createFixture("rm-basic");

    await revokeMembership(admin, f.zev.id, { userId: f.accountant.userId, role: "ACCOUNTANT", reason: "Test uklanjanja" });

    const gone = await prisma.membership.findUnique({
      where: { userId_zevId_role: { userId: f.accountant.userId, zevId: f.zev.id, role: "ACCOUNTANT" } },
    });
    expect(gone).toBeNull();
    const event = await prisma.auditEvent.findFirst({
      where: { zevId: f.zev.id, action: "admin.membership.revoke", targetId: f.accountant.userId },
    });
    expect(event).not.toBeNull();
  });

  it("refuses to remove the last active PRESIDENT membership", async () => {
    const admin = await createSuperAdminActor("rm-lastpres");
    const f = await createFixture("rm-lastpres");
    await expect(
      revokeMembership(admin, f.zev.id, { userId: f.president.userId, role: "PRESIDENT", reason: "Test" })
    ).rejects.toThrow(/jedini aktivni nalog sa rolom Predsjednik/);
  });

  it("allows removing a PRESIDENT membership when another active president exists", async () => {
    const admin = await createSuperAdminActor("rm-secondpres");
    const f = await createFixture("rm-secondpres");
    await prisma.membership.create({ data: { userId: f.accountant.userId, zevId: f.zev.id, role: "PRESIDENT" } });

    await revokeMembership(admin, f.zev.id, { userId: f.president.userId, role: "PRESIDENT", reason: "Test" });

    const gone = await prisma.membership.findUnique({
      where: { userId_zevId_role: { userId: f.president.userId, zevId: f.zev.id, role: "PRESIDENT" } },
    });
    expect(gone).toBeNull();
  });

  it("requires a reason", async () => {
    const admin = await createSuperAdminActor("rm-noreason");
    const f = await createFixture("rm-noreason");
    await expect(
      revokeMembership(admin, f.zev.id, { userId: f.accountant.userId, role: "ACCOUNTANT", reason: "  " })
    ).rejects.toThrow(/Razlog je obavezan/);
  });

  it("rejects when the membership doesn't exist", async () => {
    const admin = await createSuperAdminActor("rm-notfound");
    const f = await createFixture("rm-notfound");
    await expect(
      revokeMembership(admin, f.zev.id, { userId: f.accountant.userId, role: "PRESIDENT", reason: "Test" })
    ).rejects.toThrow(/nije pronađeno/);
  });

  it("rejects a non-super-admin actor", async () => {
    const f = await createFixture("rm-forbidden");
    await expect(
      revokeMembership(f.president, f.zev.id, { userId: f.accountant.userId, role: "ACCOUNTANT", reason: "Test" })
    ).rejects.toThrow(ForbiddenError);
  });
});

describe("setTenantActive — suspending your own active tenant clears your session instead of logging you out", () => {
  it("clears Session.activeZevId when the super admin suspends the tenant they're currently active in", async () => {
    const admin = await createSuperAdminActor("sta-self");
    const f = await createFixture("sta-self");
    await prisma.membership.create({ data: { userId: admin.userId, zevId: f.zev.id, role: "PRESIDENT" } });
    const session = await prisma.session.create({ data: { userId: admin.userId, expiresAt: new Date(Date.now() + 3600_000), activeZevId: f.zev.id } });
    const actor = { ...admin, sessionId: session.id, zevId: f.zev.id };

    await setTenantActive(actor, f.zev.id, false, "Test suspenzije");

    const updated = await prisma.session.findUniqueOrThrow({ where: { id: session.id } });
    expect(updated.activeZevId).toBeNull();
  });

  it("leaves the session untouched when suspending a tenant the actor is NOT currently active in", async () => {
    const admin = await createSuperAdminActor("sta-other");
    const active = await createFixture("sta-other-active");
    const target = await createFixture("sta-other-target");
    const session = await prisma.session.create({ data: { userId: admin.userId, expiresAt: new Date(Date.now() + 3600_000), activeZevId: active.zev.id } });
    const actor = { ...admin, sessionId: session.id, zevId: active.zev.id };

    await setTenantActive(actor, target.zev.id, false, "Test suspenzije");

    const unchanged = await prisma.session.findUniqueOrThrow({ where: { id: session.id } });
    expect(unchanged.activeZevId).toBe(active.zev.id);
  });
});
