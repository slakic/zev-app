import { describe, it, expect, beforeEach } from "vitest";
import { prisma } from "@/lib/prisma";
import { ForbiddenError } from "@/server/auth/guards";
import { createFixture, createProposalFixture, openVotingWithLinks, uid } from "./helpers";
import {
  listOfficeHolders, addBoardMember, endBoardMembership, boardVotingBasis, setOfficeTerm,
} from "@/server/services/ownership";
import { submitVote, closeVoting, getProposal, createVotingRule } from "@/server/services/meetings";

// OfficeTerm (predsjednik/računovođa/upravni odbor) is intentionally global —
// this app manages exactly one ZEV per installation (see LEGAL_AND_FINANCIAL_ASSUMPTIONS.md),
// so unlike other fixtures it is NOT scoped per test. Close out any terms left
// open by other tests in this file before each test so board membership/voting
// assertions are deterministic regardless of run order.
async function resetOfficeTerms() {
  // A cutoff safely before every asOf date these tests use (2024+), so a term
  // closed here reads as inactive whether a test queries "now" or a past date.
  await prisma.officeTerm.updateMany({ where: { validTo: null }, data: { validTo: new Date("2000-01-01") } });
}

describe("Organi ZEV — upravni odbor (board) membership", () => {
  beforeEach(resetOfficeTerms);

  it("addBoardMember is multi-holder: adding a second member does not close the first", async () => {
    const f = await createFixture("board-multi");
    const m1 = await addBoardMember(f.president, { partyId: f.ownerA.id, validFrom: new Date("2024-01-01") });
    const m2 = await addBoardMember(f.president, { partyId: f.ownerB.id, validFrom: new Date("2024-01-01") });

    const holders = await listOfficeHolders(f.president);
    const ids = holders.boardMembers.map((b) => b.id).sort();
    expect(ids).toEqual([m1.id, m2.id].sort());
    expect(holders.boardMembers.every((b) => b.validTo === null)).toBe(true);
  });

  it("rejects adding the same party as an active board member twice", async () => {
    const f = await createFixture("board-dup");
    await addBoardMember(f.president, { partyId: f.ownerA.id, validFrom: new Date("2024-01-01") });
    await expect(
      addBoardMember(f.president, { partyId: f.ownerA.id, validFrom: new Date("2024-06-01") })
    ).rejects.toThrow(/već aktivan/);
  });

  it("only PRESIDENT can add or end board membership", async () => {
    const f = await createFixture("board-perm");
    await expect(
      addBoardMember(f.actorA, { partyId: f.ownerB.id, validFrom: new Date("2024-01-01") })
    ).rejects.toThrow(ForbiddenError);

    const m = await addBoardMember(f.president, { partyId: f.ownerA.id, validFrom: new Date("2024-01-01") });
    await expect(endBoardMembership(f.actorB, m.id, new Date())).rejects.toThrow(ForbiddenError);
  });

  it("endBoardMembership closes the term and it drops out of listOfficeHolders", async () => {
    const f = await createFixture("board-end");
    const m = await addBoardMember(f.president, { partyId: f.ownerA.id, validFrom: new Date("2024-01-01") });
    await endBoardMembership(f.president, m.id, new Date("2024-06-01"), "istek mandata");

    const holders = await listOfficeHolders(f.president, new Date("2024-07-01"));
    expect(holders.boardMembers.find((b) => b.id === m.id)).toBeUndefined();

    const asOfBefore = await listOfficeHolders(f.president, new Date("2024-03-01"));
    expect(asOfBefore.boardMembers.find((b) => b.id === m.id)).toBeDefined();
  });

  it("boardVotingBasis includes the predsjednik plus board members, deduplicated, ignoring ownership weight", async () => {
    const f = await createFixture("board-basis");
    // president already has OfficeRole.PRESIDENT from... nothing yet in this fixture, so set it explicitly.
    await setOfficeTerm(f.president, { role: "PRESIDENT", partyId: f.presidentParty.id, validFrom: new Date("2024-01-01") });
    await addBoardMember(f.president, { partyId: f.ownerA.id, validFrom: new Date("2024-01-01") });
    await addBoardMember(f.president, { partyId: f.ownerB.id, validFrom: new Date("2024-01-01") });

    const basis = await boardVotingBasis();
    const ownerIds = basis.map((b) => b.ownerId).sort();
    expect(ownerIds).toEqual([f.presidentParty.id, f.ownerA.id, f.ownerB.id].sort());
    // Ownership-share fields are irrelevant for board voting (PER_OWNER weight method).
    expect(basis.every((b) => b.ownershipShareSum.toString() === "0")).toBe(true);
  });

  it("a BOARD meeting's proposal is decided by board members only, one head one vote", async () => {
    const f = await createFixture("board-vote");
    await setOfficeTerm(f.president, { role: "PRESIDENT", partyId: f.presidentParty.id, validFrom: new Date("2024-01-01") });
    await addBoardMember(f.president, { partyId: f.ownerA.id, validFrom: new Date("2024-01-01") });
    await addBoardMember(f.president, { partyId: f.ownerB.id, validFrom: new Date("2024-01-01") });
    // ownerC is a ZEV owner but NOT on the board — must not be eligible to vote here.
    const boardRule = await createVotingRule(f.president, {
      name: uid("Rule-board"),
      quorumType: "PERCENT_OF_OWNER_COUNT", quorumPercent: "50",
      majorityType: "SIMPLE_OF_VOTES_CAST", weightMethod: "PER_OWNER",
    });

    const { proposal } = await createProposalFixture(f, { body: "BOARD", ruleId: boardRule.id });
    const links = await openVotingWithLinks(f, proposal.id);
    expect(links.length).toBe(3); // predsjednik + 2 board members, NOT ownerC

    const before = await getProposal(f.president, proposal.id);
    expect(before.ruleSnapshot).toMatchObject({ weightMethod: "PER_OWNER", totalEligibleOwners: 3 });

    for (const l of links) {
      const r = await submitVote({ tokenPlain: l.token, verificationCode: l.code, choice: "APPROVE" });
      expect(r.ok).toBe(true);
    }
    const closed = await closeVoting(f.president, proposal.id);
    expect(closed.result.accepted).toBe(true);
    expect(closed.result.totalEligibleOwners).toBe(3);
  });
});
