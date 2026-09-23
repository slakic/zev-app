// Faza 0 of Plans/live-meeting-mode-plan.md — the domain/service-layer changes that back
// the live-meeting screen (no UI yet). Each test builds its own fixture (createFixture)
// rather than sharing one across `it` blocks, because these tests deliberately mutate
// Party.eVoteConsentStatus and Attendance — state that must not leak between cases.
import { describe, it, expect } from "vitest";
import { prisma } from "@/lib/prisma";
import { createFixture, createProposalFixture, type Fixture } from "./helpers";
import {
  openVoting, recordAttendance, recordAttendanceBulk, recordManualVote, submitVote,
  advanceMeetingStatus, closeVoting, getLiveMeetingState, previewLiveDelivery, createVotingRule,
} from "@/server/services/meetings";
import { grantProxy } from "@/server/services/ownership";
import { ForbiddenError } from "@/server/auth/guards";

async function markSigned(partyId: string) {
  await prisma.party.update({ where: { id: partyId }, data: { eVoteConsentStatus: "SIGNED" } });
}

describe("live meeting — attendance-aware delivery (openVoting delivery: \"LIVE\")", () => {
  it("delivery omitted (default) still sends to everyone, unaffected by the new code path", async () => {
    const f: Fixture = await createFixture("lm-default");
    const { proposal } = await createProposalFixture(f);
    const deliveries = await openVoting(f.president, proposal.id);
    expect(deliveries).toHaveLength(3); // ownerA, ownerB, ownerC
    const tokens = await prisma.approvalToken.findMany({
      where: { eligibleVoter: { proposalId: proposal.id } },
    });
    expect(tokens.every((t) => t.deliveredVia === "EMAIL")).toBe(true);
    const sent = await prisma.notificationMessage.findMany({
      where: { relatedType: "Proposal", relatedId: proposal.id, template: "approval-link" },
    });
    expect(sent).toHaveLength(3);
  });

  it("LIVE mode: present owner is suppressed, absent+consented owner is delivered, absent+unconsented owner is suppressed but stays eligible", async () => {
    const f: Fixture = await createFixture("lm-buckets");
    const { meeting, proposal } = await createProposalFixture(f);
    await recordAttendance(f.president, { meetingId: meeting.id, partyId: f.ownerA.id, present: true }); // korpa A
    await markSigned(f.ownerB.id); // korpa B: absent + signed + has email
    // f.ownerC gets neither attendance nor consent -> korpa C

    const deliveries = await openVoting(f.president, proposal.id, { delivery: "LIVE" });
    expect(deliveries).toHaveLength(3); // EligibleVoter+token created for all three, regardless of delivery

    const byOwner = new Map(
      (await prisma.eligibleVoter.findMany({ where: { proposalId: proposal.id }, include: { tokens: true } })).map(
        (ev) => [ev.ownerId, ev.tokens[0]]
      )
    );
    expect(byOwner.get(f.ownerA.id)?.deliveredVia).toBeNull();
    expect(byOwner.get(f.ownerB.id)?.deliveredVia).toBe("EMAIL");
    expect(byOwner.get(f.ownerC.id)?.deliveredVia).toBeNull();

    const sent = await prisma.notificationMessage.findMany({
      where: { relatedType: "Proposal", relatedId: proposal.id, template: "approval-link" },
    });
    expect(sent).toHaveLength(1);
    expect(sent[0].toAddress).toBe(f.ownerB.email);
  });

  it("LIVE mode: a proxy-represented owner is delivered only when BOTH owner and holder have signed consent (P1)", async () => {
    const f: Fixture = await createFixture("lm-proxy-consent");
    const { proposal } = await createProposalFixture(f);
    // ownerA is absent, represented by ownerC. Owner signs, holder does not (yet).
    // scope "ALL" (not "MEETING") so the same proxy also applies to the second proposal's
    // own, separately-created meeting below (createProposalFixture always makes a fresh one).
    await grantProxy(f.president, {
      grantorId: f.ownerA.id, holderId: f.ownerC.id, scope: "ALL", validFrom: new Date("2020-01-01"),
    });
    await markSigned(f.ownerA.id);

    await openVoting(f.president, proposal.id, { delivery: "LIVE" });
    // Not delivered: holder (ownerC) has not signed consent, even though the owner has.
    const tokenA = await prisma.approvalToken.findFirstOrThrow({
      where: { eligibleVoter: { proposalId: proposal.id, ownerId: f.ownerA.id } },
    });
    expect(tokenA.deliveredVia).toBeNull();

    // New proposal (voting can't reopen on the same one): now both sign — expect delivery,
    // to the holder's e-mail.
    await markSigned(f.ownerC.id);
    const { proposal: proposal2 } = await createProposalFixture(f);
    const second = await openVoting(f.president, proposal2.id, { delivery: "LIVE" });
    const tokenA2 = await prisma.approvalToken.findFirstOrThrow({
      where: { eligibleVoter: { proposalId: proposal2.id, ownerId: f.ownerA.id } },
    });
    expect(tokenA2.deliveredVia).toBe("EMAIL");
    const sentTo = second.find((d) => d.viaProxy)?.email;
    expect(sentTo).toBe(f.ownerC.email);
  });

  it("an absent, unconsented owner (korpa C) stays in the eligible base and in totalEligibleWeight — never quietly excluded", async () => {
    const f: Fixture = await createFixture("lm-korpa-c");
    const { proposal } = await createProposalFixture(f);
    await openVoting(f.president, proposal.id, { delivery: "LIVE" }); // nobody marked present or consented
    const eligibleCount = await prisma.eligibleVoter.count({ where: { proposalId: proposal.id } });
    expect(eligibleCount).toBe(3);
    const p = await prisma.proposal.findUniqueOrThrow({ where: { id: proposal.id } });
    const snapshot = p.ruleSnapshot as { totalEligibleOwners: number; totalEligibleWeight: string };
    expect(snapshot.totalEligibleOwners).toBe(3);
    expect(Number(snapshot.totalEligibleWeight)).toBeGreaterThan(0);
  });

  it("audit trail records delivery mode and suppression counts", async () => {
    const f: Fixture = await createFixture("lm-audit");
    const { meeting, proposal } = await createProposalFixture(f);
    await recordAttendance(f.president, { meetingId: meeting.id, partyId: f.ownerA.id, present: true });
    await markSigned(f.ownerB.id);
    await openVoting(f.president, proposal.id, { delivery: "LIVE" });
    const ev = await prisma.auditEvent.findFirstOrThrow({ where: { action: "proposal.voting.open", targetId: proposal.id } });
    const after = ev.after as {
      delivery: string; deliveredCount: number; suppressedPresent: number; suppressedNoConsent: number; suppressedNoEmail: number;
    };
    expect(after.delivery).toBe("LIVE");
    expect(after.deliveredCount).toBe(1);
    expect(after.suppressedPresent).toBe(1);
    expect(after.suppressedNoConsent).toBe(1);
    expect(after.suppressedNoEmail).toBe(0);
  });

  it("a present owner's manual (IN_PERSON) vote blocks a later electronic submission with their own (never-emailed) token", async () => {
    const f: Fixture = await createFixture("lm-manual-then-electronic");
    const { meeting, proposal } = await createProposalFixture(f);
    await recordAttendance(f.president, { meetingId: meeting.id, partyId: f.ownerA.id, present: true });
    const deliveries = await openVoting(f.president, proposal.id, { delivery: "LIVE" });
    // Never delivered by e-mail, but the token itself still exists (§2.2) — extract the
    // plaintext token/code straight from openVoting's own return value, the only place
    // they're ever available for a suppressed recipient.
    const aDelivery = deliveries.find((d) => !d.viaProxy && d.email === f.ownerA.email)!;
    const eligibleVoterA = await prisma.eligibleVoter.findFirstOrThrow({
      where: { proposalId: proposal.id, ownerId: f.ownerA.id },
    });
    await recordManualVote(f.president, { eligibleVoterId: eligibleVoterA.id, choice: "APPROVE", channel: "IN_PERSON" });

    const token = aDelivery.link.split("/").pop()!;
    const result = await submitVote({ tokenPlain: token, verificationCode: aDelivery.verificationCode, choice: "REJECT" });
    expect(result.ok).toBe(false);
  });
});

describe("live meeting — ACCOUNTANT gains access to the five shared meeting/voting functions (P7)", () => {
  it("ACCOUNTANT can advance meeting status, record attendance, open/close voting and record a manual vote", async () => {
    const f: Fixture = await createFixture("lm-accountant");
    const { meeting, proposal } = await createProposalFixture(f);
    await expect(advanceMeetingStatus(f.accountant, meeting.id, "SCHEDULED")).resolves.toBeTruthy();
    await expect(recordAttendance(f.accountant, { meetingId: meeting.id, partyId: f.ownerA.id, present: true })).resolves.toBeTruthy();
    await expect(openVoting(f.accountant, proposal.id, { delivery: "LIVE" })).resolves.toBeTruthy();
    const ev = await prisma.eligibleVoter.findFirstOrThrow({ where: { proposalId: proposal.id, ownerId: f.ownerA.id } });
    await expect(recordManualVote(f.accountant, { eligibleVoterId: ev.id, choice: "APPROVE", channel: "IN_PERSON" })).resolves.toBeTruthy();
    await expect(closeVoting(f.accountant, proposal.id)).resolves.toBeTruthy();
  });

  it("OWNER is still rejected on all five, and on the new live-meeting functions", async () => {
    const f: Fixture = await createFixture("lm-owner-forbidden");
    const { meeting, proposal } = await createProposalFixture(f);
    await expect(advanceMeetingStatus(f.actorA, meeting.id, "SCHEDULED")).rejects.toThrow(ForbiddenError);
    await expect(recordAttendance(f.actorA, { meetingId: meeting.id, partyId: f.ownerA.id, present: true })).rejects.toThrow(ForbiddenError);
    await expect(recordAttendanceBulk(f.actorA, { meetingId: meeting.id, entries: [{ partyId: f.ownerA.id, present: true }] })).rejects.toThrow(
      ForbiddenError
    );
    await expect(openVoting(f.actorA, proposal.id, { delivery: "LIVE" })).rejects.toThrow(ForbiddenError);
    await expect(getLiveMeetingState(f.actorA, meeting.id)).rejects.toThrow(ForbiddenError);
  });
});

describe("live meeting — recordAttendanceBulk", () => {
  it("upserts many attendance rows in one transaction, with the same per-person audit shape as recordAttendance", async () => {
    const f: Fixture = await createFixture("lm-bulk");
    const { meeting } = await createProposalFixture(f);
    await recordAttendanceBulk(f.president, {
      meetingId: meeting.id,
      entries: [
        { partyId: f.ownerA.id, present: true },
        { partyId: f.ownerB.id, present: false },
      ],
    });
    const rows = await prisma.attendance.findMany({ where: { meetingId: meeting.id } });
    expect(rows).toHaveLength(2);
    const audits = await prisma.auditEvent.findMany({ where: { action: "attendance.record", zevId: f.zev.id } });
    expect(audits.length).toBeGreaterThanOrEqual(2);
  });
});

describe("live meeting — getLiveMeetingState", () => {
  it("reports roll-call counts, per-voter consent/attendance, and the active proposal's result only", async () => {
    const f: Fixture = await createFixture("lm-state");
    const { meeting, proposal } = await createProposalFixture(f);
    await recordAttendance(f.president, { meetingId: meeting.id, partyId: f.ownerA.id, present: true });
    await markSigned(f.ownerB.id);
    await openVoting(f.president, proposal.id, { delivery: "LIVE" });

    const state = await getLiveMeetingState(f.president, meeting.id, { proposalId: proposal.id });
    expect(state.totalCount).toBe(3);
    expect(state.presentCount).toBe(1);
    expect(state.absentCount).toBe(2);
    const voterA = state.voters.find((v) => v.ownerId === f.ownerA.id)!;
    expect(voterA.present).toBe(true);
    expect(voterA.marked).toBe(true);
    const voterC = state.voters.find((v) => v.ownerId === f.ownerC.id)!;
    expect(voterC.marked).toBe(false); // never prozivka'd -> distinct from "explicitly absent"
    expect(voterC.eVoteConsentSigned).toBe(false);
    expect(state.activeResult).not.toBeNull();

    // activeVoters (§3.4): present+unvoted (manual entry), electronic (read-only), and
    // no-channel (paper entry) all derive from the same three buckets as the delivery
    // classification above — ownerA present, ownerB delivered, ownerC no channel.
    expect(state.activeVoters).toHaveLength(3);
    const avA = state.activeVoters.find((v) => v.ownerId === f.ownerA.id)!;
    expect(avA.present).toBe(true);
    expect(avA.voted).toBe(false);
    expect(avA.deliveredVia).toBeNull();
    const avB = state.activeVoters.find((v) => v.ownerId === f.ownerB.id)!;
    expect(avB.present).toBe(false);
    expect(avB.deliveredVia).toBe("EMAIL");
    const avC = state.activeVoters.find((v) => v.ownerId === f.ownerC.id)!;
    expect(avC.present).toBe(false);
    expect(avC.deliveredVia).toBeNull();
  });

  it("activeVoters reflects a submitted electronic vote and an in-person manual vote", async () => {
    const f: Fixture = await createFixture("lm-state-votes");
    const { meeting, proposal } = await createProposalFixture(f);
    await recordAttendance(f.president, { meetingId: meeting.id, partyId: f.ownerA.id, present: true });
    await markSigned(f.ownerB.id);
    const deliveries = await openVoting(f.president, proposal.id, { delivery: "LIVE" });

    const evA = await prisma.eligibleVoter.findFirstOrThrow({ where: { proposalId: proposal.id, ownerId: f.ownerA.id } });
    await recordManualVote(f.president, { eligibleVoterId: evA.id, choice: "APPROVE", channel: "IN_PERSON" });

    const bDelivery = deliveries.find((d) => d.email === f.ownerB.email)!;
    const bToken = bDelivery.link.split("/").pop()!;
    const submitted = await submitVote({ tokenPlain: bToken, verificationCode: bDelivery.verificationCode, choice: "REJECT" });
    expect(submitted.ok).toBe(true);

    const state = await getLiveMeetingState(f.president, meeting.id, { proposalId: proposal.id });
    const avA = state.activeVoters.find((v) => v.ownerId === f.ownerA.id)!;
    expect(avA.voted).toBe(true);
    expect(avA.channel).toBe("IN_PERSON");
    const avB = state.activeVoters.find((v) => v.ownerId === f.ownerB.id)!;
    expect(avB.voted).toBe(true);
    expect(avB.channel).toBe("ELECTRONIC");
    const avC = state.activeVoters.find((v) => v.ownerId === f.ownerC.id)!;
    expect(avC.voted).toBe(false);
  });

  it("is zevId-scoped and PRESIDENT/ACCOUNTANT-only", async () => {
    const f: Fixture = await createFixture("lm-state-scope");
    const other: Fixture = await createFixture("lm-state-scope-other");
    const { meeting } = await createProposalFixture(f);
    await expect(getLiveMeetingState(other.president, meeting.id)).rejects.toThrow();
  });
});

describe("live meeting — previewLiveDelivery (Faza 2, §2.1/§3.4 confirmation panel)", () => {
  it("matches exactly what openVoting(delivery: \"LIVE\") actually does, and creates nothing itself", async () => {
    const f: Fixture = await createFixture("lm-preview-match");
    const { meeting, proposal } = await createProposalFixture(f);
    await recordAttendance(f.president, { meetingId: meeting.id, partyId: f.ownerA.id, present: true });
    await markSigned(f.ownerB.id);
    // ownerC: absent, no consent -> no channel

    const preview = await previewLiveDelivery(f.president, proposal.id);
    expect(preview.presentCount).toBe(1);
    expect(preview.deliverCount).toBe(1);
    expect(preview.noChannelCount).toBe(1);
    // Read-only: nothing created yet.
    expect(await prisma.eligibleVoter.count({ where: { proposalId: proposal.id } })).toBe(0);
    expect((await prisma.proposal.findUniqueOrThrow({ where: { id: proposal.id } })).status).toBe("DRAFT");

    // The real call must land on the exact same three numbers.
    await openVoting(f.president, proposal.id, { delivery: "LIVE" });
    const audit = await prisma.auditEvent.findFirstOrThrow({ where: { action: "proposal.voting.open", targetId: proposal.id } });
    const after = audit.after as { deliveredCount: number; suppressedPresent: number; suppressedNoConsent: number; suppressedNoEmail: number };
    expect(after.suppressedPresent).toBe(preview.presentCount);
    expect(after.deliveredCount).toBe(preview.deliverCount);
    expect(after.suppressedNoConsent + after.suppressedNoEmail).toBe(preview.noChannelCount);
  });

  it("quorumReachable is true when korpa A+B weight clears the rule's quorum, false when it doesn't", async () => {
    const f: Fixture = await createFixture("lm-preview-quorum");
    // "Veći radovi" style rule: 2/3 of total weight required for quorum.
    const strictRule = await createVotingRule(f.president, {
      name: `Strogi kvorum ${f.t}`,
      quorumType: "PERCENT_OF_TOTAL_WEIGHT",
      quorumPercent: "66.67",
      majorityType: "SIMPLE_OF_VOTES_CAST",
      weightMethod: "OWNERSHIP_SHARE",
    });
    const { meeting, proposal } = await createProposalFixture(f, { ruleId: strictRule.id });
    // Nobody present, nobody consented -> reachable weight is 0, quorum unreachable.
    const unreachable = await previewLiveDelivery(f.president, proposal.id);
    expect(unreachable.quorumReachable).toBe(false);

    // Mark everyone present -> full weight reachable, quorum met.
    await recordAttendance(f.president, { meetingId: meeting.id, partyId: f.ownerA.id, present: true });
    await recordAttendance(f.president, { meetingId: meeting.id, partyId: f.ownerB.id, present: true });
    await recordAttendance(f.president, { meetingId: meeting.id, partyId: f.ownerC.id, present: true });
    const reachable = await previewLiveDelivery(f.president, proposal.id);
    expect(reachable.quorumReachable).toBe(true);
    expect(reachable.presentCount).toBe(3);
  });

  it("is PRESIDENT/ACCOUNTANT-only and zevId-scoped", async () => {
    const f: Fixture = await createFixture("lm-preview-auth");
    const { proposal } = await createProposalFixture(f);
    await expect(previewLiveDelivery(f.actorA, proposal.id)).rejects.toThrow(ForbiddenError);
    await expect(previewLiveDelivery(f.accountant, proposal.id)).resolves.toBeTruthy();
  });
});
