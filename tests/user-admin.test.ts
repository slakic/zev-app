import { describe, it, expect } from "vitest";
import { prisma } from "@/lib/prisma";
import { updateUserRoles, activateUser, deactivateUser } from "@/server/services/users";
import { updateParty } from "@/server/services/ownership";
import { ForbiddenError } from "@/server/auth/guards";
import { createFixture } from "./helpers";

/**
 * The "don't strip the last active president" guard is a global invariant, not scoped
 * to one fixture — so to test it deterministically we must first neutralize every
 * OTHER active president left behind by earlier fixtures in this shared test database
 * (tests run sequentially in this file/suite — see vitest.config.ts's fileParallelism: false).
 */
async function deactivateOtherPresidents(keepUserId: string) {
  await prisma.user.updateMany({
    where: { id: { not: keepUserId }, roles: { has: "PRESIDENT" } },
    data: { active: false },
  });
}

describe("user account administration (roles, activation)", () => {
  it("president can change a user's roles", async () => {
    const f = await createFixture("roles");
    const updated = await updateUserRoles(f.president, f.actorA.userId, ["OWNER", "ACCOUNTANT"]);
    expect(updated.roles.sort()).toEqual(["ACCOUNTANT", "OWNER"].sort());
  });

  it("non-president cannot change roles or activation state", async () => {
    const f = await createFixture("roles-forbidden");
    await expect(updateUserRoles(f.accountant, f.actorA.userId, ["ACCOUNTANT"])).rejects.toThrow(ForbiddenError);
    await expect(deactivateUser(f.accountant, f.actorA.userId, "test")).rejects.toThrow(ForbiddenError);
    await expect(activateUser(f.accountant, f.actorA.userId, "test")).rejects.toThrow(ForbiddenError);
  });

  it("rejects an empty roles list", async () => {
    const f = await createFixture("roles-empty");
    await expect(updateUserRoles(f.president, f.actorA.userId, [])).rejects.toThrow();
  });

  it("refuses to remove PRESIDENT from the last active president account", async () => {
    const f = await createFixture("roles-lastpres");
    await deactivateOtherPresidents(f.president.userId);
    await expect(updateUserRoles(f.president, f.president.userId, ["OWNER"])).rejects.toThrow(/jedini aktivni nalog/);
    // Unaffected: still president afterwards.
    const u = await prisma.user.findUniqueOrThrow({ where: { id: f.president.userId } });
    expect(u.roles).toContain("PRESIDENT");
  });

  it("refuses to deactivate the last active president account", async () => {
    const f = await createFixture("deact-lastpres");
    await deactivateOtherPresidents(f.president.userId);
    await expect(deactivateUser(f.president, f.president.userId, "stepping down")).rejects.toThrow(/jedini aktivni nalog/);
    const u = await prisma.user.findUniqueOrThrow({ where: { id: f.president.userId } });
    expect(u.active).toBe(true);
  });

  it("allows demoting/deactivating a president when another active president exists", async () => {
    const f = await createFixture("multi-pres");
    const secondPresident = await prisma.user.create({
      data: { email: `second-${f.t}@zev.test`, passwordHash: "x", roles: ["PRESIDENT"] },
    });
    await expect(updateUserRoles(f.president, secondPresident.id, ["OWNER"])).resolves.toBeTruthy();
    const secondPresident2 = await prisma.user.create({
      data: { email: `third-${f.t}@zev.test`, passwordHash: "x", roles: ["PRESIDENT"] },
    });
    await expect(deactivateUser(f.president, secondPresident2.id, "cleanup")).resolves.toBeTruthy();
  });

  it("activateUser clears the deactivation and re-enables login eligibility", async () => {
    const f = await createFixture("reactivate");
    await deactivateUser(f.president, f.actorA.userId, "prodaja stana");
    let u = await prisma.user.findUniqueOrThrow({ where: { id: f.actorA.userId } });
    expect(u.active).toBe(false);
    expect(u.deactivatedAt).not.toBeNull();

    await activateUser(f.president, f.actorA.userId, "greškom deaktiviran");
    u = await prisma.user.findUniqueOrThrow({ where: { id: f.actorA.userId } });
    expect(u.active).toBe(true);
    expect(u.deactivatedAt).toBeNull();
  });

  it("deactivating a user revokes their existing sessions", async () => {
    const f = await createFixture("deact-sessions");
    const session = await prisma.session.create({
      data: { userId: f.actorB.userId, expiresAt: new Date(Date.now() + 3600_000) },
    });
    await deactivateUser(f.president, f.actorB.userId, "test");
    const s = await prisma.session.findUniqueOrThrow({ where: { id: session.id } });
    expect(s.revokedAt).not.toBeNull();
  });
});

describe("party contact-data editing", () => {
  it("president can update any field on any party", async () => {
    const f = await createFixture("party-pres");
    const updated = await updateParty(f.president, f.ownerA.id, {
      firstName: "Nova",
      lastName: "Vrijednost",
      phone: "+387-60-000-000",
    });
    expect(updated.firstName).toBe("Nova");
    expect(updated.phone).toBe("+387-60-000-000");
  });

  it("an owner can update their own contact fields only", async () => {
    const f = await createFixture("party-self");
    const updated = await updateParty(f.actorA, f.ownerA.id, { phone: "+387-61-111-111", correspondenceAddress: "Nova 1" });
    expect(updated.phone).toBe("+387-61-111-111");
  });

  it("an owner cannot change their own name or property address", async () => {
    const f = await createFixture("party-self-restricted");
    await expect(updateParty(f.actorA, f.ownerA.id, { firstName: "Hakovano" })).rejects.toThrow(ForbiddenError);
    await expect(updateParty(f.actorA, f.ownerA.id, { address: "Druga adresa" })).rejects.toThrow(ForbiddenError);
  });

  it("an owner cannot edit another owner's data", async () => {
    const f = await createFixture("party-other");
    await expect(updateParty(f.actorA, f.ownerB.id, { phone: "+387-62-222-222" })).rejects.toThrow(ForbiddenError);
  });

  it("an accountant (management, but not president or self) cannot edit contact data", async () => {
    const f = await createFixture("party-accountant");
    await expect(updateParty(f.accountant, f.ownerA.id, { phone: "+387-63-333-333" })).rejects.toThrow(ForbiddenError);
  });
});
