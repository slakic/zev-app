// FR (K-03, K-03a, K-03b): glasacki subjekti skupstine, zajednicki predstavnik i upozorenja o udjelima.
import { describe, it, expect } from "vitest";
import { prisma } from "@/lib/prisma";
import { createFixture, createProposalFixture, openVotingWithLinks, seedShapedZev, type Fixture } from "./helpers";
import {
  assemblyVotingSubjects, assemblyVotingBasis, setVotingRepresentative, unitOwnershipWarnings, addOwnershipStake, subjectKeyFor, grantProxy,
} from "@/server/services/ownership";
import { openVoting } from "@/server/services/meetings";
import { ForbiddenError } from "@/server/auth/guards";

const PROOF = { buffer: Buffer.from("test proof"), filename: "dokaz.pdf", mime: "application/pdf" };
const PAST = new Date("2020-01-01");

describe("assemblyVotingSubjects — one etazni vlasnik, one vote (K-03)", () => {
  it("6 persons / 8 units give 5 subjects; a multi-unit owner is one subject", async () => {
    const { f, nikola, sara } = await seedShapedZev("subj-seed");
    const subjects = await assemblyVotingSubjects(f.zev.id);
    expect(subjects).toHaveLength(5);

    const ana = subjects.find((s) => s.subjectKey === `P:${f.ownerA.id}`)!;
    expect(ana.units.map((u) => u.label.split("-")[0]).sort()).toEqual(["G1", "S1"]);
    expect(ana.memberPartyIds).toEqual([f.ownerA.id]);
    const marko = subjects.find((s) => s.subjectKey === `P:${f.ownerB.id}`)!;
    expect(marko.units).toHaveLength(2);

    const community = subjects.find((s) => s.memberPartyIds.length === 2)!;
    expect(community.subjectKey).toBe(`G:${[nikola.id, sara.id].sort().join(",")}`);
    expect(community.ownerName).toContain("Nikola");
    expect(community.ownerName).toContain("Sara");
    // all persons across subjects: 6
    expect(new Set(subjects.flatMap((s) => s.memberPartyIds)).size).toBe(6);
  });

  it("the default representative is the co-owner with the largest share, and is marked as not confirmed", async () => {
    const { f, nikola } = await seedShapedZev("subj-default");
    const community = (await assemblyVotingSubjects(f.zev.id)).find((s) => s.memberPartyIds.length === 2)!;
    expect(community.ownerId).toBe(nikola.id); // 60 %
    expect(community.representativeConfirmed).toBe(false);
    expect(community.email).toBe(nikola.email);
  });

  it("equal shares: the earlier validFrom wins", async () => {
    const f = await createFixture("subj-tie", { registerStatus: "REVIEW" });
    const fresh = await prisma.unit.create({
      data: { zevId: f.zev.id, buildingId: f.b1.id, type: "APARTMENT", label: `Tie-${f.t}`, usableArea: "10", ownershipShare: "1" },
    });
    await addOwnershipStake(f.president, { unitId: fresh.id, ownerId: f.ownerA.id, sharePercent: "50", validFrom: new Date("2021-06-01") }, PROOF);
    await addOwnershipStake(f.president, { unitId: fresh.id, ownerId: f.ownerC.id, sharePercent: "50", validFrom: new Date("2019-06-01") }, PROOF);
    const subjects = await assemblyVotingSubjects(f.zev.id, [fresh.id]);
    expect(subjects).toHaveLength(1);
    expect(subjects[0].ownerId).toBe(f.ownerC.id);
  });

  it("setVotingRepresentative moves the vote to the chosen co-owner (confirmed) and is audited", async () => {
    const { f, sara, nikola } = await seedShapedZev("subj-rep");
    await setVotingRepresentative(f.president, f.u3.id, sara.id, { note: "dogovor suvlasnika" });
    const community = (await assemblyVotingSubjects(f.zev.id)).find((s) => s.memberPartyIds.length === 2)!;
    expect(community.ownerId).toBe(sara.id);
    expect(community.representativeConfirmed).toBe(true);
    const audit = await prisma.auditEvent.findFirstOrThrow({ where: { action: "unit.voting_representative.set", targetId: f.u3.id } });
    expect(JSON.stringify(audit.after)).toContain(sara.id);
    expect(audit.reason).toBe("dogovor suvlasnika");
    expect(nikola.id).not.toBe(sara.id);
  });

  it("the same owner set on two units is ONE subject, and the representative applies to both", async () => {
    const { f, nikola, sara } = await seedShapedZev("subj-two-units");
    // a second unit co-owned by the same two persons (taken from the president's U8: close, re-open)
    const extra = await prisma.unit.create({
      data: { zevId: f.zev.id, buildingId: f.b2.id, type: "GARAGE_SPACE", label: `GM-${f.t}`, usableArea: "10", ownershipShare: "1" },
    });
    await addOwnershipStake(f.president, { unitId: extra.id, ownerId: nikola.id, sharePercent: "50", validFrom: PAST }, PROOF);
    await addOwnershipStake(f.president, { unitId: extra.id, ownerId: sara.id, sharePercent: "50", validFrom: PAST }, PROOF);

    const subjects = await assemblyVotingSubjects(f.zev.id);
    expect(subjects).toHaveLength(5); // still 5
    const community = subjects.find((s) => s.memberPartyIds.length === 2)!;
    expect(community.units).toHaveLength(2);

    const res = await setVotingRepresentative(f.president, f.u3.id, sara.id);
    expect(res.unitIds.sort()).toEqual([f.u3.id, extra.id].sort());
    const rows = await prisma.unit.findMany({ where: { id: { in: [f.u3.id, extra.id] } } });
    expect(rows.every((u) => u.votingRepresentativeId === sara.id)).toBe(true);
  });

  it("different explicit representatives on units of the same owner set raise a conflict flag; the smallest label wins", async () => {
    const { f, nikola, sara } = await seedShapedZev("subj-conflict");
    const extra = await prisma.unit.create({
      data: { zevId: f.zev.id, buildingId: f.b2.id, type: "GARAGE_SPACE", label: `AAA-${f.t}`, usableArea: "10", ownershipShare: "1" },
    });
    await addOwnershipStake(f.president, { unitId: extra.id, ownerId: nikola.id, sharePercent: "50", validFrom: PAST }, PROOF);
    await addOwnershipStake(f.president, { unitId: extra.id, ownerId: sara.id, sharePercent: "50", validFrom: PAST }, PROOF);
    await prisma.unit.update({ where: { id: extra.id }, data: { votingRepresentativeId: sara.id } }); // AAA-… < S3-…
    await prisma.unit.update({ where: { id: f.u3.id }, data: { votingRepresentativeId: nikola.id } });
    const community = (await assemblyVotingSubjects(f.zev.id)).find((s) => s.memberPartyIds.length === 2)!;
    expect(community.representativeConflict).toBe(true);
    expect(community.ownerId).toBe(sara.id);
  });

  it("K-03b: B solely owns u2 and co-owns u3 — the community keeps its own vote, but B cannot cast it (C does)", async () => {
    const f = await createFixture("subj-k03b");
    const subjects = await assemblyVotingSubjects(f.zev.id);
    // fixture: A (u1+u4), B (u2) and the u3 community B + C — B is a member of both subjects, votes in only one
    expect(subjects).toHaveLength(3);
    const withB = subjects.filter((s) => s.memberPartyIds.includes(f.ownerB.id));
    expect(withB).toHaveLength(2);
    expect(new Set(withB.map((s) => s.subjectKey)).size).toBe(2);
    const community = subjects.find((s) => s.memberPartyIds.length === 2)!;
    expect(community.actingPartyIds).toEqual([f.ownerC.id]);
    expect(community.ownerId).toBe(f.ownerC.id);
    expect(subjectKeyFor([f.ownerC.id, f.ownerB.id])).toBe(subjectKeyFor([f.ownerB.id, f.ownerC.id]));
  });

  it("a scope narrows the base to the owners of the scoped units only", async () => {
    const { f } = await seedShapedZev("subj-scope");
    const subjects = await assemblyVotingSubjects(f.zev.id, [f.u1.id]);
    expect(subjects).toHaveLength(1);
    expect(subjects[0].ownerId).toBe(f.ownerA.id);
  });

  it("tenant/occupant without a stake is never a subject; a closed stake drops out", async () => {
    const f = await createFixture("subj-closed");
    await prisma.ownershipStake.updateMany({ where: { unitId: f.u2.id, validTo: null }, data: { validTo: new Date("2021-01-01") } });
    const subjects = await assemblyVotingSubjects(f.zev.id);
    // B no longer owns u2, so only the u3 community remains for him: A, G{B,C} (rep C)
    expect(subjects.map((s) => s.subjectKey).sort()).toEqual([`P:${f.ownerA.id}`, subjectKeyFor([f.ownerB.id, f.ownerC.id])].sort());
  });
});

describe("setVotingRepresentative — rules", () => {
  it("accepts only a co-owner of a co-owned unit, and only the president", async () => {
    const { f, firma } = await seedShapedZev("rep-rules");
    await expect(setVotingRepresentative(f.president, f.u3.id, firma.id)).rejects.toThrow(/suvlasnik/);
    await expect(setVotingRepresentative(f.president, f.u1.id, f.ownerA.id)).rejects.toThrow(/više suvlasnika/);
    await expect(setVotingRepresentative(f.accountant, f.u3.id, firma.id)).rejects.toThrow(ForbiddenError);
  });

  it("is refused while a proposal covering the unit is VOTING_OPEN", async () => {
    const f = await createFixture("rep-open");
    const { proposal } = await createProposalFixture(f);
    await openVotingWithLinks(f, proposal.id);
    await expect(setVotingRepresentative(f.president, f.u3.id, f.ownerB.id)).rejects.toThrow(/dok traje glasanje/);
  });
});

describe("unitOwnershipWarnings and addOwnershipStake (K-01, K-01a)", () => {
  it("adding a stake that takes the sum over 100% does NOT throw and returns the unit's sum", async () => {
    const f = await createFixture("warn-over", { registerStatus: "REVIEW" });
    const res = await addOwnershipStake(
      f.president, { unitId: f.u1.id, ownerId: f.ownerC.id, sharePercent: "50", validFrom: new Date("2022-01-01") }, PROOF,
    );
    expect(res.unitShareSum.toFixed(0)).toBe("150");
    expect(res.stake.id).toBeTruthy();
    const warn = await unitOwnershipWarnings(f.zev.id);
    expect(warn.map((w) => [w.unitId, w.kind])).toEqual([[f.u1.id, "OVER"]]);
  });

  it("reports under-allocated and ownerless units", async () => {
    const f = await createFixture("warn-under");
    await prisma.ownershipStake.updateMany({ where: { unitId: f.u4.id, validTo: null }, data: { sharePercent: "60" } });
    await prisma.ownershipStake.updateMany({ where: { unitId: f.u2.id, validTo: null }, data: { validTo: new Date("2021-01-01") } });
    const warn = await unitOwnershipWarnings(f.zev.id);
    const byKind = Object.fromEntries(warn.map((w) => [w.unitId, w.kind]));
    expect(byKind[f.u4.id]).toBe("UNDER");
    expect(byKind[f.u2.id]).toBe("NONE");
    expect(Object.keys(byKind)).toHaveLength(2);
  });
});

describe("EligibleVoter (propagation / rollback safety, plan §10.6)", () => {
  async function openedProposal(f: Fixture) {
    const { proposal } = await createProposalFixture(f);
    return proposal;
  }

  it("a row written without subjectKey (pre-FR code) succeeds, and a duplicate of the same person for the same proposal still fails", async () => {
    const f = await createFixture("ev-legacy");
    const proposal = await openedProposal(f);
    const legacy = { proposalId: proposal.id, ownerId: f.ownerA.id, weight: "1", basis: {} };
    const row = await prisma.eligibleVoter.create({ data: legacy });
    expect(row.subjectKey).toBe("");
    expect(row.memberPartyIds).toEqual([]);
    await expect(prisma.eligibleVoter.create({ data: legacy })).rejects.toThrow();
    // ...while the same person in a DIFFERENT subject of the same proposal is allowed (K-03b)
    await expect(
      prisma.eligibleVoter.create({ data: { ...legacy, subjectKey: `G:${f.ownerA.id},${f.ownerB.id}`, memberPartyIds: [f.ownerA.id, f.ownerB.id] } }),
    ).resolves.toBeTruthy();
  });
});


// K-03b (odluka korisnika, 2026-10-26): lice daje najvise JEDAN glas ukupno.
describe("K-03b — a person casts at most one vote in total", () => {
  async function nikolaGarage(f: Fixture, nikolaId: string, tag = "Garaza4") {
    const garage = await prisma.unit.create({
      data: { zevId: f.zev.id, buildingId: f.b2.id, type: "GARAGE", label: `${tag}-${f.t}`, usableArea: "15", ownershipShare: "1" },
    });
    await addOwnershipStake(f.president, { unitId: garage.id, ownerId: nikolaId, sharePercent: "100", validFrom: PAST }, PROOF);
    return garage;
  }

  it("Nikola owns Garaza 4 alone and Stan 3 with Sara: Nikola has 1 vote, the Stan 3 community votes through Sara", async () => {
    const { f, nikola, sara } = await seedShapedZev("k03b-nikola");
    await nikolaGarage(f, nikola.id);
    const subjects = await assemblyVotingSubjects(f.zev.id);
    expect(subjects).toHaveLength(6); // 5 + Nikola's own vote
    expect(subjects.filter((s) => s.ownerId === nikola.id)).toHaveLength(1); // exactly one vote cast by Nikola
    const community = subjects.find((s) => s.memberPartyIds.length === 2)!;
    expect(community.ownerId).toBe(sara.id); // although Nikola has the larger share (60 %)
    expect(community.actingPartyIds).toEqual([sara.id]);
    expect(community.representativeSoleName).toBeNull();
    // every person is the representative of at most one subject
    const reps = subjects.map((s) => s.ownerId);
    expect(new Set(reps).size).toBe(reps.length);
  });

  it("a community whose every member already votes as a sole owner is not a voting subject (informational)", async () => {
    const { f, nikola, sara } = await seedShapedZev("k03b-absorbed");
    await nikolaGarage(f, nikola.id);
    await nikolaGarage(f, sara.id, "Garaza5");
    const { subjects, absorbed } = await assemblyVotingBasis(f.zev.id);
    expect(subjects.some((s) => s.memberPartyIds.length === 2)).toBe(false);
    expect(subjects).toHaveLength(6); // Ana, Marko, firma, president, Nikola, Sara — community adds nothing
    expect(absorbed).toHaveLength(1);
    expect(absorbed[0].names).toContain("Nikola");
    expect(absorbed[0].names).toContain("Sara");
  });

  it("a stored representative who also votes as a sole owner is flagged, and openVoting is blocked naming the community", async () => {
    const { f, nikola, sara } = await seedShapedZev("k03b-block");
    await nikolaGarage(f, nikola.id);
    await setVotingRepresentative(f.president, f.u3.id, nikola.id);
    const community = (await assemblyVotingSubjects(f.zev.id)).find((s) => s.memberPartyIds.length === 2)!;
    expect(community.representativeSoleName).toContain("Nikola");
    expect(community.ownerId).toBe(sara.id); // meanwhile the vote is Sara's

    const { proposal } = await createProposalFixture(f, { scope: "ZEV" });
    await expect(openVoting(f.president, proposal.id)).rejects.toThrow(/već glasa kao samostalni vlasnik/);
    await expect(openVoting(f.president, proposal.id)).rejects.toThrow(/Nikola/);
    expect((await prisma.proposal.findUniqueOrThrow({ where: { id: proposal.id } })).status).toBe("DRAFT");

    // the president picks the other co-owner: voting can open
    await setVotingRepresentative(f.president, f.u3.id, sara.id);
    await expect(openVoting(f.president, proposal.id)).resolves.toBeTruthy();
  });

  it("an already opened proposal keeps its frozen snapshot and eligible voters when ownership later changes", async () => {
    const { f, nikola } = await seedShapedZev("k03b-frozen");
    const { proposal } = await createProposalFixture(f, { scope: "ZEV" });
    await openVoting(f.president, proposal.id);
    const before = await prisma.proposal.findUniqueOrThrow({ where: { id: proposal.id } });
    const votersBefore = await prisma.eligibleVoter.findMany({ where: { proposalId: proposal.id }, orderBy: { subjectKey: "asc" } });
    expect((before.ruleSnapshot as { totalEligibleOwners: number }).totalEligibleOwners).toBe(5);

    await nikolaGarage(f, nikola.id); // today's base would now be 6
    expect(await assemblyVotingSubjects(f.zev.id)).toHaveLength(6);

    const after = await prisma.proposal.findUniqueOrThrow({ where: { id: proposal.id } });
    expect(after.ruleSnapshot).toEqual(before.ruleSnapshot);
    const votersAfter = await prisma.eligibleVoter.findMany({ where: { proposalId: proposal.id }, orderBy: { subjectKey: "asc" } });
    expect(votersAfter.map((v) => [v.subjectKey, v.ownerId])).toEqual(votersBefore.map((v) => [v.subjectKey, v.ownerId]));
  });

  it("a proxy granted by the community's representative still receives the vote link", async () => {
    const { f, nikola, sara, firma } = await seedShapedZev("k03b-proxy");
    await nikolaGarage(f, nikola.id);
    await grantProxy(f.president, { grantorId: sara.id, holderId: firma.id, scope: "ALL", validFrom: PAST });
    const { proposal } = await createProposalFixture(f, { scope: "ZEV" });
    await openVoting(f.president, proposal.id);
    const ev = await prisma.eligibleVoter.findMany({ where: { proposalId: proposal.id, memberPartyIds: { has: sara.id } } });
    expect(ev).toHaveLength(1);
    expect(ev[0].ownerId).toBe(sara.id);
    expect(ev[0].proxyId).toBe(firma.id);
  });
});
