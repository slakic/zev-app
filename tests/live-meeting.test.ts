// Faza 0 of Plans/live-meeting-mode-plan.md — the domain/service-layer changes that back
// the live-meeting screen (no UI yet). Each test builds its own fixture (createFixture)
// rather than sharing one across `it` blocks, because these tests deliberately mutate
// Party.eVoteConsentStatus and Attendance — state that must not leak between cases.
import { describe, it, expect } from "vitest";
import { prisma } from "@/lib/prisma";
import { createFixture, createProposalFixture, seedShapedZev, type Fixture } from "./helpers";
import {
  openVoting, recordAttendance, recordAttendanceBulk, recordManualVote, recordManualVoteBulk, submitVote,
  advanceMeetingStatus, closeVoting, getLiveMeetingState, previewLiveDelivery, createVotingRule,
  addAgendaItem, linkProposalToAgendaItem, getMeetingNextStepInput,
} from "@/server/services/meetings";
import { meetingNextStep } from "@/lib/meetingNextStep";
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
    // F6.3: "not yet called" is not "absent" — only ownerA was marked, so nobody is recorded absent.
    expect(state.unmarkedCount).toBe(2);
    expect(state.absentCount).toBe(0);
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

  it("unlinkedProposals lists proposals without an agenda item, and a linked one moves to its item (F1.7)", async () => {
    const f: Fixture = await createFixture("lm-unlinked");
    const { meeting, proposal } = await createProposalFixture(f); // created with no agendaItemId
    const item = await addAgendaItem(f.president, { meetingId: meeting.id, title: "Izbor izvođača" });

    const before = await getLiveMeetingState(f.president, meeting.id);
    expect(before.unlinkedProposals.map((p) => p.id)).toEqual([proposal.id]);
    expect(before.unlinkedProposals[0].code).toBe(proposal.code);
    expect(before.agendaItems.find((a) => a.id === item.id)!.proposals).toHaveLength(0);

    await linkProposalToAgendaItem(f.president, proposal.id, item.id);

    const after = await getLiveMeetingState(f.president, meeting.id);
    expect(after.unlinkedProposals).toHaveLength(0);
    expect(after.agendaItems.find((a) => a.id === item.id)!.proposals.map((p) => p.id)).toEqual([proposal.id]);
  });

  it("linkProposalToAgendaItem links a proposal already open for voting without touching the frozen text or links (K4)", async () => {
    const f: Fixture = await createFixture("lm-link-open");
    const { meeting, proposal } = await createProposalFixture(f);
    const item = await addAgendaItem(f.president, { meetingId: meeting.id, title: "Izbor izvođača" });
    await openVoting(f.president, proposal.id);
    const frozen = await prisma.proposal.findUniqueOrThrow({ where: { id: proposal.id } });
    const tokensBefore = await prisma.approvalToken.count({ where: { eligibleVoter: { proposalId: proposal.id }, status: "ACTIVE" } });

    const before = await getLiveMeetingState(f.president, meeting.id);
    expect(before.unlinkedProposals.map((p) => [p.id, p.status])).toEqual([[proposal.id, "VOTING_OPEN"]]);

    await linkProposalToAgendaItem(f.president, proposal.id, item.id);

    const linked = await prisma.proposal.findUniqueOrThrow({ where: { id: proposal.id } });
    expect(linked.agendaItemId).toBe(item.id);
    expect(linked.status).toBe("VOTING_OPEN");
    expect(linked.contentHash).toBe(frozen.contentHash);
    expect(await prisma.approvalToken.count({ where: { eligibleVoter: { proposalId: proposal.id }, status: "ACTIVE" } })).toBe(tokensBefore);
    const auditRow = await prisma.auditEvent.findFirst({ where: { action: "proposal.link", targetId: proposal.id } });
    expect(auditRow).not.toBeNull();
  });

  it("linkProposalToAgendaItem refuses an already linked proposal, a closed one, an item of another meeting, and a non-president", async () => {
    const f: Fixture = await createFixture("lm-link-refuse");
    const { meeting, proposal } = await createProposalFixture(f);
    const item = await addAgendaItem(f.president, { meetingId: meeting.id, title: "Tačka 1" });
    const other = await createProposalFixture(f);
    const foreignItem = await addAgendaItem(f.president, { meetingId: other.meeting.id, title: "Tuđa tačka" });

    await expect(linkProposalToAgendaItem(f.accountant, proposal.id, item.id)).rejects.toThrow();
    await expect(linkProposalToAgendaItem(f.president, proposal.id, foreignItem.id)).rejects.toThrow();

    await linkProposalToAgendaItem(f.president, proposal.id, item.id);
    await expect(linkProposalToAgendaItem(f.president, proposal.id, item.id)).rejects.toThrow(/već vezan/);

    await openVoting(f.president, other.proposal.id);
    await closeVoting(f.president, other.proposal.id);
    await expect(linkProposalToAgendaItem(f.president, other.proposal.id, foreignItem.id)).rejects.toThrow(/nacrt ili prijedlog/);
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

describe("live meeting — Faza 4 (poliranje)", () => {
  it("recordManualVoteBulk writes one Vote per person via recordManualVote, and skips (not aborts) an entry that already voted", async () => {
    const f: Fixture = await createFixture("lm-bulk-vote");
    const { meeting, proposal } = await createProposalFixture(f);
    await recordAttendance(f.president, { meetingId: meeting.id, partyId: f.ownerA.id, present: true });
    await recordAttendance(f.president, { meetingId: meeting.id, partyId: f.ownerB.id, present: true });
    await openVoting(f.president, proposal.id, { delivery: "LIVE" });
    const evA = await prisma.eligibleVoter.findFirstOrThrow({ where: { proposalId: proposal.id, ownerId: f.ownerA.id } });
    const evB = await prisma.eligibleVoter.findFirstOrThrow({ where: { proposalId: proposal.id, ownerId: f.ownerB.id } });

    // ownerA already voted (e.g. a race with an earlier manual entry) before the bulk call.
    await recordManualVote(f.president, { eligibleVoterId: evA.id, choice: "REJECT", channel: "IN_PERSON" });

    const results = await recordManualVoteBulk(f.president, {
      eligibleVoterIds: [evA.id, evB.id],
      choice: "APPROVE",
      channel: "IN_PERSON",
    });
    expect(results.find((r) => r.eligibleVoterId === evA.id)?.ok).toBe(false);
    expect(results.find((r) => r.eligibleVoterId === evB.id)?.ok).toBe(true);

    // ownerA's original REJECT vote is untouched (bulk never overwrites); ownerB got a new APPROVE.
    const voteA = await prisma.vote.findFirstOrThrow({ where: { eligibleVoterId: evA.id, invalid: false, correctedBy: null } });
    expect(voteA.choice).toBe("REJECT");
    const voteB = await prisma.vote.findFirstOrThrow({ where: { eligibleVoterId: evB.id, invalid: false, correctedBy: null } });
    expect(voteB.choice).toBe("APPROVE");
    expect(voteB.channel).toBe("IN_PERSON");
    const audits = await prisma.auditEvent.findMany({ where: { action: "vote.manual_entry", zevId: f.zev.id } });
    // One per successful call (evA's earlier single call + evB's bulk call) — the skipped
    // evA bulk entry never reaches recordManualVote's own audit write.
    expect(audits.length).toBeGreaterThanOrEqual(2);
  });

  it("getLiveMeetingState surfaces an already-granted proxy inline, for roll-call's 'prisutan preko punomoćnika' control", async () => {
    const f: Fixture = await createFixture("lm-proxy-inline");
    const { meeting } = await createProposalFixture(f);
    await grantProxy(f.president, {
      grantorId: f.ownerA.id, holderId: f.ownerC.id, scope: "MEETING", meetingId: meeting.id, validFrom: new Date("2020-01-01"),
    });

    const state = await getLiveMeetingState(f.president, meeting.id);
    const voterA = state.voters.find((v) => v.ownerId === f.ownerA.id)!;
    expect(voterA.proxy).not.toBeNull();
    expect(voterA.proxy!.id).toBeTruthy();
    const voterB = state.voters.find((v) => v.ownerId === f.ownerB.id)!;
    expect(voterB.proxy).toBeNull();

    // Marking present via that proxy round-trips through recordAttendance's existing
    // viaProxyId field — no service-layer change needed for this part (only the UI is new).
    await recordAttendance(f.president, { meetingId: meeting.id, partyId: f.ownerA.id, present: true, viaProxyId: voterA.proxy!.id });
    const after = await getLiveMeetingState(f.president, meeting.id);
    const voterAAfter = after.voters.find((v) => v.ownerId === f.ownerA.id)!;
    expect(voterAAfter.present).toBe(true);
    expect(voterAAfter.viaProxyId).toBe(voterA.proxy!.id);
  });

  it("getLiveMeetingState reports each pending electronic voter's NotificationMessage delivery status (§5 risk 3)", async () => {
    const f: Fixture = await createFixture("lm-notify-status");
    const { meeting, proposal } = await createProposalFixture(f);
    await markSigned(f.ownerB.id); // korpa B: absent + signed + has email -> delivered
    await openVoting(f.president, proposal.id, { delivery: "LIVE" });

    const state = await getLiveMeetingState(f.president, meeting.id, { proposalId: proposal.id });
    const avB = state.activeVoters.find((v) => v.ownerId === f.ownerB.id)!;
    expect(avB.deliveredVia).toBe("EMAIL");
    // Mock provider (src/server/notifications/providers.ts) always reports sent+delivered.
    expect(avB.notifyStatus).toBe("DELIVERED");

    const avA = state.activeVoters.find((v) => v.ownerId === f.ownerA.id)!;
    expect(avA.notifyStatus).toBeNull(); // korpa C here — no channel, nothing to report status for

    // Confirm recipientId was actually stamped, since notifyStatus is looked up through it.
    const msg = await prisma.notificationMessage.findFirstOrThrow({
      where: { relatedType: "Proposal", relatedId: proposal.id, toAddress: f.ownerB.email! },
    });
    expect(msg.recipientId).toBe(f.ownerB.id);
  });
});

// FR (K-03a) — plan §3.4: the roll-call and the delivery split work per voting SUBJECT.
describe("live meeting — voting subjects (FR)", () => {
  it("the roll-call lists 5 subjects for the seed's 6 persons; a co-owner community is present when ONE co-owner is", async () => {
    const { f, nikola, sara } = await seedShapedZev("lm-subj-state");
    const { meeting } = await createProposalFixture(f, { scope: "ZEV" });

    const before = await getLiveMeetingState(f.president, meeting.id);
    expect(before.totalCount).toBe(5);
    const community = before.voters.find((v) => v.isCommunity)!;
    expect(community.ownerId).toBe(nikola.id); // representative
    expect(community.ownerName).toContain("Sara");
    expect(community.marked).toBe(false);

    // only Sara (not the representative) is in the room
    await recordAttendance(f.president, { meetingId: meeting.id, partyId: sara.id, present: true });
    const after = await getLiveMeetingState(f.president, meeting.id);
    const c2 = after.voters.find((v) => v.isCommunity)!;
    expect(c2.present).toBe(true);
    expect(c2.marked).toBe(true);
    expect(after.presentCount).toBe(1);
    expect(after.unmarkedCount).toBe(4);
    expect(after.absentCount).toBe(0);
  });

  it("LIVE delivery: a community whose non-representative co-owner is present is suppressed as PRESENT, and the preview agrees", async () => {
    const { f, sara, nikola } = await seedShapedZev("lm-subj-live");
    const { meeting, proposal } = await createProposalFixture(f, { scope: "ZEV" });
    await recordAttendance(f.president, { meetingId: meeting.id, partyId: sara.id, present: true });
    await markSigned(nikola.id);

    const preview = await previewLiveDelivery(f.president, proposal.id);
    expect(preview.preconditionErrors).toEqual([]);
    expect(preview.presentCount).toBe(1);
    expect(preview.deliverCount).toBe(0);
    expect(preview.noChannelCount).toBe(4);
    expect(preview.totalEligibleWeight).toBe("5.000000");

    await openVoting(f.president, proposal.id, { delivery: "LIVE" });
    const ev = await prisma.eligibleVoter.findFirstOrThrow({ where: { proposalId: proposal.id, ownerId: nikola.id }, include: { tokens: true } });
    expect(ev.tokens[0].deliveredVia).toBeNull(); // in the room — votes IN_PERSON through the manual entry
    const audit = await prisma.auditEvent.findFirstOrThrow({ where: { action: "proposal.voting.open", targetId: proposal.id } });
    expect((audit.after as { suppressedPresent: number }).suppressedPresent).toBe(1);

    const state = await getLiveMeetingState(f.president, meeting.id, { proposalId: proposal.id });
    const av = state.activeVoters.find((v) => v.ownerId === nikola.id)!;
    expect(av.isCommunity).toBe(true);
    expect(av.present).toBe(true);
    expect(av.ownerName).toContain("Sara");
  });

  it("a present proxy holder makes the grantor's subject present (the holder votes in the room)", async () => {
    const f: Fixture = await createFixture("lm-subj-proxy");
    const { meeting, proposal } = await createProposalFixture(f);
    await grantProxy(f.president, { grantorId: f.ownerA.id, holderId: f.ownerB.id, scope: "ALL", validFrom: new Date("2020-01-01") });
    await recordAttendance(f.president, { meetingId: meeting.id, partyId: f.ownerB.id, present: true });
    const preview = await previewLiveDelivery(f.president, proposal.id);
    // K-03b (2026-10-26): B votes in the room as the sole owner of u2 and A is represented by B -> 2 subjects present.
    // B is also a member of the u3 community, but its vote is cast by C (B already votes as a sole owner), so B's
    // presence does not make the community present.
    expect(preview.presentCount).toBe(2);
  });

  it("the preview shows the register preconditions instead of numbers that cannot be acted on", async () => {
    const f: Fixture = await createFixture("lm-subj-pre", { registerStatus: "REVIEW" });
    const { proposal } = await createProposalFixture(f);
    const preview = await previewLiveDelivery(f.president, proposal.id);
    expect(preview.preconditionErrors.join(" ")).toMatch(/nije utvrđen/);
    await expect(openVoting(f.president, proposal.id, { delivery: "LIVE" })).rejects.toThrow(/nije utvrđen/);
  });
});

describe("live meeting — F6.3 quorum bar (presence)", () => {
  it("counts not-yet-called people separately from those marked absent", async () => {
    const f: Fixture = await createFixture("lm-unmarked");
    const { meeting } = await createProposalFixture(f);
    // ownerA is a subject of his own; ownerB heads another and is also a member of the u3 community (K-03b), ownerC represents it.
    await recordAttendance(f.president, { meetingId: meeting.id, partyId: f.ownerA.id, present: false });
    const s = await getLiveMeetingState(f.president, meeting.id);
    expect([s.presentCount, s.unmarkedCount, s.absentCount, s.totalCount]).toEqual([0, 2, 1, 3]);
  });

  it("quorum follows the first proposal's rule (a draft: its voting rule against the roll-call base); 50 % of 3 needs 2", async () => {
    const f: Fixture = await createFixture("lm-quorum");
    const { meeting, proposal } = await createProposalFixture(f);
    const empty = await getLiveMeetingState(f.president, meeting.id);
    expect(empty.quorum).toMatchObject({ kind: "COUNT", present: 0, required: 2, total: 3, reached: false, missing: 2, proposalId: proposal.id });
    await recordAttendance(f.president, { meetingId: meeting.id, partyId: f.ownerA.id, present: true });
    await recordAttendance(f.president, { meetingId: meeting.id, partyId: f.ownerC.id, present: true }); // representative of the u3 community
    const two = await getLiveMeetingState(f.president, meeting.id);
    expect(two.quorum).toMatchObject({ kind: "COUNT", present: 2, required: 2, reached: true, missing: 0 });
  });

  it("an open proposal uses its frozen snapshot, takes the active item's proposal when asked, and flags e-votes", async () => {
    const f: Fixture = await createFixture("lm-quorum-open");
    const { meeting, proposal } = await createProposalFixture(f);
    const item = await addAgendaItem(f.president, { meetingId: meeting.id, title: "Tačka" });
    await linkProposalToAgendaItem(f.president, proposal.id, item.id);
    await markSigned(f.ownerB.id);
    await openVoting(f.president, proposal.id, { delivery: "LIVE" });
    const s = await getLiveMeetingState(f.president, meeting.id, { proposalId: proposal.id });
    expect(s.quorum).toMatchObject({ kind: "COUNT", required: 2, total: 3, proposalId: proposal.id, acceptsEVotes: true });
    // Presence is read from the proposal's own (frozen) EligibleVoter rows: ownerA plus the u3 community via its representative.
    await recordAttendance(f.president, { meetingId: meeting.id, partyId: f.ownerA.id, present: true });
    await recordAttendance(f.president, { meetingId: meeting.id, partyId: f.ownerC.id, present: true });
    const two = await getLiveMeetingState(f.president, meeting.id, { proposalId: proposal.id });
    expect(two.quorum).toMatchObject({ kind: "COUNT", present: 2, required: 2, total: 3, reached: true, missing: 0 });
  });

  it("without any proposal the quorum is null", async () => {
    const f: Fixture = await createFixture("lm-quorum-none");
    const meeting = await prisma.meeting.create({ data: { zevId: f.zev.id, title: "Prazna", type: "REGULAR", body: "ASSEMBLY" } });
    const s = await getLiveMeetingState(f.president, meeting.id);
    expect(s.quorum).toBeNull();
  });

  it("a rule without a quorum reads as NONE", async () => {
    const f: Fixture = await createFixture("lm-quorum-notneeded");
    const rule = await createVotingRule(f.president, {
      name: `Bez kvoruma ${f.t}`, quorumType: "NONE", majorityType: "SIMPLE_OF_VOTES_CAST",
    });
    const { meeting } = await createProposalFixture(f, { ruleId: rule.id });
    const s = await getLiveMeetingState(f.president, meeting.id);
    expect(s.quorum).toMatchObject({ kind: "NONE" });
  });

  it("a co-owner community counts as present when any member is (one subject, one unit of the quorum)", async () => {
    const { f, sara } = await seedShapedZev("lm-quorum-community");
    const { meeting } = await createProposalFixture(f, { scope: "ZEV" });
    await recordAttendance(f.president, { meetingId: meeting.id, partyId: sara.id, present: true });
    const s = await getLiveMeetingState(f.president, meeting.id);
    expect(s.quorum).toMatchObject({ kind: "COUNT", present: 1, total: 5 });
  });

  it("the board counts per member: its basis is the office holders", async () => {
    const f: Fixture = await createFixture("lm-quorum-board");
    const { meeting } = await createProposalFixture(f, { body: "BOARD" });
    const s = await getLiveMeetingState(f.president, meeting.id);
    expect(s.totalCount).toBe(s.quorum && s.quorum.kind === "COUNT" ? s.quorum.total : -1);
  });
});

describe("F6.1 — getMeetingNextStepInput feeds meetingNextStep from real data", () => {
  it("a scheduled session with an unlinked proposal and an item without a proposal warns about both; president/accountant only", async () => {
    const f: Fixture = await createFixture("lm-nextstep");
    const { meeting, proposal } = await createProposalFixture(f);
    await addAgendaItem(f.president, { meetingId: meeting.id, title: "Diskusija" });
    await prisma.meeting.update({ where: { id: meeting.id }, data: { status: "SCHEDULED" } });
    const { input } = await getMeetingNextStepInput(f.president, meeting.id);
    expect(input.proposals.map((p) => p.id)).toContain(proposal.id);
    const step = meetingNextStep(input)!;
    expect(step.to).toBe("INVITATIONS_PREPARED");
    expect(step.preconditions.filter((p) => !p.ok)).toHaveLength(2);
    await expect(getMeetingNextStepInput(f.actorA, meeting.id)).rejects.toThrow(ForbiddenError);
  });
});
