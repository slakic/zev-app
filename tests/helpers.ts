import { prisma } from "@/lib/prisma";
import { hashPassword } from "@/server/auth/password";
import type { Actor } from "@/server/auth/guards";
import * as property from "@/server/services/property";
import * as ownership from "@/server/services/ownership";
import * as finance from "@/server/services/finance";
import * as meetings from "@/server/services/meetings";
import * as billing from "@/server/services/billing";
import { seedDefaultSettings } from "@/server/services/settings";

let counter = 0;
export function uid(prefix: string): string {
  counter += 1;
  return `${prefix}-${Date.now().toString(36)}-${counter}`;
}

export type Fixture = Awaited<ReturnType<typeof createFixture>>;

/**
 * A platform-level super admin actor for exercising src/server/services/admin.ts
 * (requireSuperAdmin, not requireRole/requireZev). Backed by a real User row
 * (isSuperAdmin: true, no Party, no Membership, zevId null) so it behaves like
 * the real thing rather than a bare object literal — useful once tests also need
 * to look the user back up (e.g. authenticate() after createTenant sets a password).
 */
export async function createSuperAdminActor(tag = "super"): Promise<Actor> {
  const t = uid(tag);
  const user = await prisma.user.create({
    data: {
      email: `${t}@platform.test`,
      passwordHash: await hashPassword("Test1234!"),
      roles: [],
      isSuperAdmin: true,
    },
  });
  return { userId: user.id, roles: [], partyId: null, zevId: null, isSuperAdmin: true };
}

/**
 * Self-contained fixture: a ZEV context with 2 buildings, 4 units,
 * 3 owners (one co-owned unit), users/actors for each role and a bank account.
 * All names are unique per call so suites do not interfere.
 */
export async function createFixture(tag: string) {
  const t = uid(tag);
  const pw = await hashPassword("Test1234!");

  // Created before any Party: Party.zevId is a required FK (docs/multitenancy-plan.md §6.3)
  // that falls back to a temporary DB default (the single globally-earliest Zev) when not set
  // explicitly. On a freshly reset test DB with zero Zev rows, that default resolves to NULL —
  // so creating Party first would crash on the very first fixture of the whole test run. Every
  // Party below is also given this fixture's own zevId explicitly rather than relying on the
  // default, so it isn't silently mis-attributed to whichever other (parallel-running) fixture's
  // Zev happens to be globally earliest.
  const zev = await prisma.zev.create({
    data: { legalName: `ZEV Test ${t}`, jib: "4400000000000" },
  });
  // Mirrors createTenant()'s own seeding step (admin.ts) so fixtures match real tenants.
  await seedDefaultSettings(prisma, zev.id);

  const presidentParty = await prisma.party.create({
    data: { zevId: zev.id, kind: "PERSON", firstName: "Petar", lastName: `Predsjednik-${t}`, email: `${t}-pres@example.com` },
  });
  const accountantParty = await prisma.party.create({
    data: { zevId: zev.id, kind: "PERSON", firstName: "Rada", lastName: `Racun-${t}`, email: `${t}-acc@example.com` },
  });
  const ownerA = await prisma.party.create({
    data: { zevId: zev.id, kind: "PERSON", firstName: "Ana", lastName: `A-${t}`, email: `${t}-a@example.com` },
  });
  const ownerB = await prisma.party.create({
    data: { zevId: zev.id, kind: "PERSON", firstName: "Boris", lastName: `B-${t}`, email: `${t}-b@example.com` },
  });
  const ownerC = await prisma.party.create({
    data: { zevId: zev.id, kind: "PERSON", firstName: "Cvijeta", lastName: `C-${t}`, email: `${t}-c@example.com` },
  });

  const presidentUser = await prisma.user.create({
    data: { email: `${t}-pres@zev.test`, passwordHash: pw, roles: ["PRESIDENT", "OWNER"], partyId: presidentParty.id },
  });
  const accountantUser = await prisma.user.create({
    data: { email: `${t}-acc@zev.test`, passwordHash: pw, roles: ["ACCOUNTANT"], partyId: accountantParty.id },
  });
  const ownerAUser = await prisma.user.create({
    data: { email: `${t}-a@zev.test`, passwordHash: pw, roles: ["OWNER"], partyId: ownerA.id },
  });
  const ownerBUser = await prisma.user.create({
    data: { email: `${t}-b@zev.test`, passwordHash: pw, roles: ["OWNER"], partyId: ownerB.id },
  });

  // Membership rows mirroring each Actor's `roles` below — updateUserRoles/
  // createUserForParty now require actor.zevId (see users.ts) and reconcile
  // Membership on every call, so fixture actors need both.
  await prisma.membership.createMany({
    data: [
      { userId: presidentUser.id, zevId: zev.id, role: "PRESIDENT" },
      { userId: presidentUser.id, zevId: zev.id, role: "OWNER" },
      { userId: accountantUser.id, zevId: zev.id, role: "ACCOUNTANT" },
      { userId: ownerAUser.id, zevId: zev.id, role: "OWNER" },
      { userId: ownerBUser.id, zevId: zev.id, role: "OWNER" },
    ],
  });

  const president: Actor = { userId: presidentUser.id, roles: ["PRESIDENT", "OWNER"], partyId: presidentParty.id, zevId: zev.id };
  const accountant: Actor = { userId: accountantUser.id, roles: ["ACCOUNTANT"], partyId: accountantParty.id, zevId: zev.id };
  const actorA: Actor = { userId: ownerAUser.id, roles: ["OWNER"], partyId: ownerA.id, zevId: zev.id };
  const actorB: Actor = { userId: ownerBUser.id, roles: ["OWNER"], partyId: ownerB.id, zevId: zev.id };
  const b1 = await property.createBuilding(president, { name: `Zgrada 1 ${t}`, address: "Test 1" });
  const b2 = await property.createBuilding(president, { name: `Zgrada 2 ${t}`, address: "Test 2" });

  // shares sum to 100 across the fixture's units
  const u1 = await property.createUnit(president, { buildingId: b1.id, type: "APARTMENT", label: `S1-${t}`, usableArea: "50.00", ownershipShare: "25.00", occupantCount: 2 });
  const u2 = await property.createUnit(president, { buildingId: b1.id, type: "APARTMENT", label: `S2-${t}`, usableArea: "70.00", ownershipShare: "35.00", occupantCount: 3 });
  const u3 = await property.createUnit(president, { buildingId: b2.id, type: "APARTMENT", label: `S3-${t}`, usableArea: "60.00", ownershipShare: "30.00", occupantCount: 1 });
  const u4 = await property.createUnit(president, { buildingId: b2.id, type: "GARAGE", label: `G1-${t}`, usableArea: "20.00", ownershipShare: "10.00", occupantCount: 0, typeCoefficient: "0.5" });

  const past = new Date("2020-01-01");
  const proof = { buffer: Buffer.from("test proof"), filename: "dokaz.pdf", mime: "application/pdf" };
  await ownership.addOwnershipStake(president, { unitId: u1.id, ownerId: ownerA.id, sharePercent: "100", validFrom: past }, proof);
  await ownership.addOwnershipStake(president, { unitId: u2.id, ownerId: ownerB.id, sharePercent: "100", validFrom: past }, proof);
  // co-owned unit: B 50 / C 50
  await ownership.addOwnershipStake(president, { unitId: u3.id, ownerId: ownerB.id, sharePercent: "50", validFrom: past }, proof);
  await ownership.addOwnershipStake(president, { unitId: u3.id, ownerId: ownerC.id, sharePercent: "50", validFrom: past }, proof);
  await ownership.addOwnershipStake(president, { unitId: u4.id, ownerId: ownerA.id, sharePercent: "100", validFrom: past }, proof);

  const account = await finance.createAccount(accountant, {
    type: "BANK", name: `Racun-${t}`, openingBalance: "1000.00", openingDate: past,
  });

  const rule = await meetings.createVotingRule(president, {
    name: `Pravilo-${t}`,
    quorumType: "PERCENT_OF_TOTAL_WEIGHT",
    quorumPercent: "50",
    majorityType: "SIMPLE_OF_VOTES_CAST",
    weightMethod: "OWNERSHIP_SHARE",
  });

  return {
    t, zev, b1, b2, u1, u2, u3, u4,
    presidentParty, accountantParty, ownerA, ownerB, ownerC,
    president, accountant, actorA, actorB,
    account, rule,
  };
}

/**
 * PER_AREA charge items covering exactly this fixture's units (scoped per
 * building so parallel fixtures in the shared test DB don't interfere).
 * Returns the charge item ids to pass to previewBatch/createDraftBatch.
 */
export async function createAreaCharges(f: Fixture, rate: string): Promise<string[]> {
  const ids: string[] = [];
  for (const b of [f.b1, f.b2]) {
    const item = await billing.createChargeItem(f.accountant, {
      name: `Naknada-${uid("ci")}`,
      method: "PER_AREA",
      rate,
      scopeType: "BUILDING",
      buildingId: b.id,
      effectiveFrom: new Date("2020-01-01"),
    });
    ids.push(item.id);
  }
  return ids;
}

/** Create a meeting + proposal (scoped to fixture units) ready for voting. */
export async function createProposalFixture(f: Fixture, opts?: { ruleId?: string; scope?: "ZEV" | "UNITS"; body?: "ASSEMBLY" | "BOARD" }) {
  const meeting = await meetings.createMeeting(f.president, {
    title: `Sjednica ${f.t}`,
    type: "REGULAR",
    body: opts?.body ?? "ASSEMBLY",
    eVoteClosesAt: new Date(Date.now() + 7 * 86400000),
  });
  const proposal = await meetings.createProposal(f.president, {
    meetingId: meeting.id,
    code: uid(`P-${f.t}`),
    title: `Prijedlog ${f.t}`,
    text: "Tekst prijedloga za test.",
    scopeType: "UNITS",
    unitIds: [f.u1.id, f.u2.id, f.u3.id, f.u4.id],
    votingRuleId: opts?.ruleId ?? f.rule.id,
    votingClosesAt: new Date(Date.now() + 7 * 86400000),
  });
  return { meeting, proposal };
}

/** Open voting and return delivered token info + the raw links from the outbox. */
export async function openVotingWithLinks(f: Fixture, proposalId: string) {
  await meetings.openVoting(f.president, proposalId);
  const messages = await prisma.notificationMessage.findMany({
    where: { relatedType: "Proposal", relatedId: proposalId, template: "approval-link" },
  });
  // extract token + code from the mock e-mail bodies
  return messages.map((m) => {
    const link = m.body.match(/http\S+\/glasanje\/(\S+)/);
    const code = m.body.match(/verifikacioni kod: (\d{6})/i);
    return { toAddress: m.toAddress, token: link?.[1] ?? "", code: code?.[1] ?? "" };
  });
}
