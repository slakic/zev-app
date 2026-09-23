import { describe, it, expect, beforeAll } from "vitest";
import { prisma } from "@/lib/prisma";
import { createFixture, createProposalFixture, openVotingWithLinks, type Fixture } from "./helpers";
import {
  submitVote, reissueToken, revokeToken, closeVoting, recordManualVote,
  createProposalRevision, updateDraftProposal, computeProposalResult, createVotingRule,
  openVoting, advanceMeetingStatus, withdrawProposal, deleteDraftProposal, canDeleteDraftProposal,
} from "@/server/services/meetings";
import { computeVotingResult, type RuleSnapshot } from "@/server/engines/voting";
import { dec } from "@/lib/money";

describe("secure electronic approval", () => {
  let f: Fixture;
  beforeAll(async () => {
    f = await createFixture("vote");
  });

  it("valid link + code records an immutable vote with audit evidence", async () => {
    const { proposal } = await createProposalFixture(f);
    const links = await openVotingWithLinks(f, proposal.id);
    const linkA = links.find((l) => l.toAddress === f.ownerA.email)!;
    const res = await submitVote({ tokenPlain: linkA.token, verificationCode: linkA.code, choice: "APPROVE" });
    expect(res.ok).toBe(true);

    const vote = await prisma.vote.findFirstOrThrow({ where: { proposalId: proposal.id, voterId: f.ownerA.id } });
    expect(vote.proposalHash).toHaveLength(64);
    expect(vote.acknowledgementText.length).toBeGreaterThan(20);
    // token stored only as hash, marked USED
    const token = await prisma.approvalToken.findUniqueOrThrow({ where: { id: vote.tokenId! } });
    expect(token.status).toBe("USED");
    expect(token.tokenHash).not.toBe(linkA.token);
    // audit event exists and does not contain the plaintext token
    const audits = await prisma.auditEvent.findMany({ where: { action: "vote.submit", targetId: vote.id } });
    expect(audits).toHaveLength(1);
    expect(JSON.stringify(audits[0].after)).not.toContain(linkA.token);
    // zevId/subjectPartyId fix (Plans/user-activity-log-plan.md §7.1): the event is now
    // tenant-attributed and party-attributed even though there is no Actor (public token
    // flow), and the vote choice itself is never written into the audit payload — it stays
    // correctly recorded only on Vote, above, for counting and the official result.
    expect(audits[0].zevId).toBe(f.zev.id);
    expect((audits[0].after as { subjectPartyId?: string })?.subjectPartyId).toBe(f.ownerA.id);
    expect(audits[0].after).not.toHaveProperty("choice");
  });

  it("a used link cannot vote again", async () => {
    const { proposal } = await createProposalFixture(f);
    const links = await openVotingWithLinks(f, proposal.id);
    const l = links.find((x) => x.toAddress === f.ownerA.email)!;
    expect((await submitVote({ tokenPlain: l.token, verificationCode: l.code, choice: "REJECT" })).ok).toBe(true);
    const second = await submitVote({ tokenPlain: l.token, verificationCode: l.code, choice: "APPROVE" });
    expect(second.ok).toBe(false);
    if (!second.ok) expect(second.error).toBe("used");
  });

  it("an expired link fails", async () => {
    const { proposal } = await createProposalFixture(f);
    const links = await openVotingWithLinks(f, proposal.id);
    const l = links.find((x) => x.toAddress === f.ownerA.email)!;
    const ev = await prisma.eligibleVoter.findFirstOrThrow({ where: { proposalId: proposal.id, ownerId: f.ownerA.id } });
    await prisma.approvalToken.updateMany({
      where: { eligibleVoterId: ev.id },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });
    const res = await submitVote({ tokenPlain: l.token, verificationCode: l.code, choice: "APPROVE" });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toBe("expired");
  });

  it("a revoked link fails", async () => {
    const { proposal } = await createProposalFixture(f);
    const links = await openVotingWithLinks(f, proposal.id);
    const l = links.find((x) => x.toAddress === f.ownerB.email)!;
    const ev = await prisma.eligibleVoter.findFirstOrThrow({ where: { proposalId: proposal.id, ownerId: f.ownerB.id } });
    const token = await prisma.approvalToken.findFirstOrThrow({ where: { eligibleVoterId: ev.id, status: "ACTIVE" } });
    await revokeToken(f.president, token.id, "test opoziv");
    const res = await submitVote({ tokenPlain: l.token, verificationCode: l.code, choice: "APPROVE" });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toBe("revoked");
  });

  it("reissuing a link invalidates the old one", async () => {
    const { proposal } = await createProposalFixture(f);
    const links = await openVotingWithLinks(f, proposal.id);
    const l = links.find((x) => x.toAddress === f.ownerA.email)!;
    const ev = await prisma.eligibleVoter.findFirstOrThrow({ where: { proposalId: proposal.id, ownerId: f.ownerA.id } });
    const oldToken = await prisma.approvalToken.findFirstOrThrow({ where: { eligibleVoterId: ev.id, status: "ACTIVE" } });
    await reissueToken(f.president, oldToken.id, "izgubljen e-mail");
    // old link no longer works
    const res = await submitVote({ tokenPlain: l.token, verificationCode: l.code, choice: "APPROVE" });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toBe("revoked");
    // new link (from the reissue notification) works
    const msg = await prisma.notificationMessage.findFirstOrThrow({
      where: { template: "approval-link-reissue", toAddress: f.ownerA.email! },
      orderBy: { createdAt: "desc" },
    });
    const newToken = msg.body.match(/glasanje\/(\S+)/)![1];
    const newCode = msg.body.match(/kod: (\d{6})/i)![1];
    const res2 = await submitVote({ tokenPlain: newToken, verificationCode: newCode, choice: "APPROVE" });
    expect(res2.ok).toBe(true);
  });

  it("a forwarded link does not bypass identity verification, and repeated failures revoke the token", async () => {
    const { proposal } = await createProposalFixture(f);
    const links = await openVotingWithLinks(f, proposal.id);
    const l = links.find((x) => x.toAddress === f.ownerB.email)!;
    for (let i = 0; i < 5; i++) {
      const res = await submitVote({ tokenPlain: l.token, verificationCode: "999999", choice: "APPROVE" });
      expect(res.ok).toBe(false);
    }
    const after = await submitVote({ tokenPlain: l.token, verificationCode: l.code, choice: "APPROVE" });
    expect(after.ok).toBe(false);
    if (!after.ok) expect(after.error).toBe("revoked"); // auto-revoked after 5 failures
  });

  it("one voting authority cannot vote twice (electronic + paper)", async () => {
    const { proposal } = await createProposalFixture(f);
    const links = await openVotingWithLinks(f, proposal.id);
    const l = links.find((x) => x.toAddress === f.ownerA.email)!;
    await submitVote({ tokenPlain: l.token, verificationCode: l.code, choice: "APPROVE" });
    const ev = await prisma.eligibleVoter.findFirstOrThrow({ where: { proposalId: proposal.id, ownerId: f.ownerA.id } });
    await expect(
      recordManualVote(f.president, { eligibleVoterId: ev.id, choice: "REJECT", channel: "PAPER" })
    ).rejects.toThrow(/već izjasnio/);
  });

  it("proposal content is frozen once voting opens", async () => {
    const { proposal } = await createProposalFixture(f);
    await openVotingWithLinks(f, proposal.id);
    await expect(
      updateDraftProposal(f.president, proposal.id, { text: "izmijenjen tekst" })
    ).rejects.toThrow(/zamrznut/);
  });

  it("a material change creates a new version and invalidates all existing links", async () => {
    const { proposal } = await createProposalFixture(f);
    const links = await openVotingWithLinks(f, proposal.id);
    const next = await createProposalRevision(f.president, proposal.id, { text: "novi tekst" }, "izmjena obima radova");
    expect(next.version).toBe(proposal.version + 1);
    expect(next.supersedesId).toBe(proposal.id);
    const old = await prisma.proposal.findUniqueOrThrow({ where: { id: proposal.id } });
    expect(old.status).toBe("SUPERSEDED");
    for (const l of links) {
      const res = await submitVote({ tokenPlain: l.token, verificationCode: l.code, choice: "APPROVE" });
      expect(res.ok).toBe(false);
    }
  });

  it("quorum, weight and majority are computed from the frozen rule snapshot", async () => {
    // fixture unit shares: A: u1(25)+u4(10)=35, B: u2(35)+50% u3(15)=50, C: 50% u3=15
    const { proposal } = await createProposalFixture(f);
    const links = await openVotingWithLinks(f, proposal.id);
    const p = await prisma.proposal.findUniqueOrThrow({ where: { id: proposal.id } });
    const snapshot = p.ruleSnapshot as unknown as RuleSnapshot;
    expect(dec(snapshot.totalEligibleWeight).toFixed(2)).toBe("100.00");
    expect(snapshot.totalEligibleOwners).toBe(3);

    // Only A votes (35%): quorum of 50% NOT reached
    const lA = links.find((x) => x.toAddress === f.ownerA.email)!;
    await submitVote({ tokenPlain: lA.token, verificationCode: lA.code, choice: "APPROVE" });
    let result = await computeProposalResult(f.zev.id, proposal.id);
    expect(result.quorumReached).toBe(false);
    expect(result.weightCast.toFixed(2)).toBe("35.00");

    // B votes REJECT (50%): quorum reached (85 >= 50); approve 35 vs reject 50 -> rejected
    const lB = links.find((x) => x.toAddress === f.ownerB.email)!;
    await submitVote({ tokenPlain: lB.token, verificationCode: lB.code, choice: "REJECT" });
    result = await computeProposalResult(f.zev.id, proposal.id);
    expect(result.quorumReached).toBe(true);
    expect(result.approveWeight.toFixed(2)).toBe("35.00");
    expect(result.rejectWeight.toFixed(2)).toBe("50.00");
    expect(result.accepted).toBe(false);

    const { result: closedResult } = await closeVoting(f.president, proposal.id);
    expect(closedResult.accepted).toBe(false);
    const closedP = await prisma.proposal.findUniqueOrThrow({ where: { id: proposal.id } });
    expect(closedP.status).toBe("REJECTED");
  });

  it("PER_OWNER weight method gives each owner exactly one vote", async () => {
    const rule = await createVotingRule(f.president, {
      name: `PerOwner-${f.t}`,
      quorumType: "PERCENT_OF_OWNER_COUNT",
      quorumPercent: "50",
      majorityType: "SIMPLE_OF_VOTES_CAST",
      weightMethod: "PER_OWNER",
    });
    const { proposal } = await createProposalFixture(f, { ruleId: rule.id });
    const links = await openVotingWithLinks(f, proposal.id);
    for (const l of links) {
      const res = await submitVote({ tokenPlain: l.token, verificationCode: l.code, choice: "APPROVE" });
      expect(res.ok).toBe(true);
    }
    const result = await computeProposalResult(f.zev.id, proposal.id);
    expect(result.approveWeight.toFixed(0)).toBe("3");
    expect(result.accepted).toBe(true);
  });

  it("pure engine: PERCENT_OF_ELIGIBLE_WEIGHT majority requires the configured share of the whole base", () => {
    const rule: RuleSnapshot = {
      ruleName: "2/3", quorumType: "NONE", quorumPercent: null,
      majorityType: "PERCENT_OF_ELIGIBLE_WEIGHT", majorityPercent: "66.67",
      weightMethod: "OWNERSHIP_SHARE", totalEligibleWeight: "100", totalEligibleOwners: 4,
    };
    const votes = [
      { eligibleVoterId: "1", choice: "APPROVE" as const, weight: dec(60), countsForQuorum: true, invalid: false },
      { eligibleVoterId: "2", choice: "REJECT" as const, weight: dec(10), countsForQuorum: true, invalid: false },
    ];
    expect(computeVotingResult(rule, votes).accepted).toBe(false); // 60 < 66.67
    votes.push({ eligibleVoterId: "3", choice: "APPROVE" as const, weight: dec(10), countsForQuorum: true, invalid: false });
    expect(computeVotingResult(rule, votes).accepted).toBe(true); // 70 > 66.67
  });

  it("tenant/occupant without ownership never enters the eligible voting base", async () => {
    const tenant = await prisma.party.create({
      data: { zevId: f.zev.id, kind: "PERSON", firstName: "Zak", lastName: `Upac-${f.t}`, email: `${f.t}-tenant@example.com` },
    });
    await prisma.occupancy.create({
      data: { zevId: f.zev.id, unitId: f.u1.id, partyId: tenant.id, type: "TENANT", validFrom: new Date("2023-01-01") },
    });
    const { proposal } = await createProposalFixture(f);
    await openVotingWithLinks(f, proposal.id);
    const evTenant = await prisma.eligibleVoter.findFirst({ where: { proposalId: proposal.id, ownerId: tenant.id } });
    expect(evTenant).toBeNull();
  });
});

// Gap reported by the user (2026-09-23): advancing the meeting past VOTING_OPEN (e.g. the
// desktop "Označi glasanje zatvorenim" button) left any still-open proposal's own voting
// untouched — Proposal.status stayed VOTING_OPEN and its e-vote links kept working, even
// though the session itself had moved on. Meeting.status was deliberately never a gate for
// Proposal.status (§1.1 of Plans/live-meeting-mode-plan.md), but nothing ever closed the
// individual votes on the session's behalf either — this is that missing link.
describe("advanceMeetingStatus auto-closes proposals left VOTING_OPEN", () => {
  it("moving the meeting to VOTING_CLOSED closes a still-open proposal: result computed, status ACCEPTED/REJECTED, unused links stop working", async () => {
    const f: Fixture = await createFixture("auto-close");
    const { meeting, proposal } = await createProposalFixture(f);
    const links = await openVotingWithLinks(f, proposal.id);
    // Nobody votes — proposal stays VOTING_OPEN right up until the meeting itself closes.
    expect((await prisma.proposal.findUniqueOrThrow({ where: { id: proposal.id } })).status).toBe("VOTING_OPEN");

    await advanceMeetingStatus(f.president, meeting.id, "VOTING_CLOSED");

    const closed = await prisma.proposal.findUniqueOrThrow({ where: { id: proposal.id } });
    expect(["ACCEPTED", "REJECTED"]).toContain(closed.status);
    expect(closed.resultSummary).not.toBeNull();
    // The same audit as a manual closeVoting() call — no second, divergent close-code-path.
    expect(await prisma.auditEvent.findFirst({ where: { action: "proposal.voting.close", targetId: proposal.id } })).toBeTruthy();
    // Every previously-active token for this proposal is now expired...
    const tokens = await prisma.approvalToken.findMany({ where: { eligibleVoter: { proposalId: proposal.id } } });
    expect(tokens.some((t) => t.status === "ACTIVE")).toBe(false);
    // ...and a never-used link can no longer cast a vote at all.
    const l = links[0];
    const res = await submitVote({ tokenPlain: l.token, verificationCode: l.code, choice: "APPROVE" });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toBe("voting_closed");
  });

  it("records which proposals were auto-closed in the meeting.status audit event", async () => {
    const f: Fixture = await createFixture("auto-close-audit");
    const { meeting, proposal } = await createProposalFixture(f);
    await openVoting(f.president, proposal.id);

    await advanceMeetingStatus(f.president, meeting.id, "VOTING_CLOSED");

    const ev = await prisma.auditEvent.findFirstOrThrow({ where: { action: "meeting.status", targetId: meeting.id } });
    const after = ev.after as { status: string; autoClosedProposalIds: string[] };
    expect(after.status).toBe("VOTING_CLOSED");
    expect(after.autoClosedProposalIds).toContain(proposal.id);
  });

  it("a proposal already closed (manually, before the meeting advances) is left untouched — no double-close, no error", async () => {
    const f: Fixture = await createFixture("auto-close-idempotent");
    const { meeting, proposal } = await createProposalFixture(f);
    await openVotingWithLinks(f, proposal.id);
    const { result: manualResult } = await closeVoting(f.president, proposal.id);

    await expect(advanceMeetingStatus(f.president, meeting.id, "VOTING_CLOSED")).resolves.toBeTruthy();

    const p = await prisma.proposal.findUniqueOrThrow({ where: { id: proposal.id } });
    expect(p.status).toBe(manualResult.accepted ? "ACCEPTED" : "REJECTED");
    // Only the one manual close — advanceMeetingStatus must not have tried (and failed, or
    // silently re-run) closeVoting on a proposal that isn't VOTING_OPEN any more.
    const closeAudits = await prisma.auditEvent.findMany({ where: { action: "proposal.voting.close", targetId: proposal.id } });
    expect(closeAudits).toHaveLength(1);
  });

  it("moving the meeting only as far as VOTING_OPEN itself never touches an open proposal's voting", async () => {
    // createProposalFixture's meeting starts at DRAFT and is never advanced by
    // openVoting/openVotingWithLinks (§1.1: meeting status is not a voting gate) — so this
    // is a genuine forward move (DRAFT -> VOTING_OPEN), landing exactly ON the boundary
    // index, not past it. The fix must trigger only on "past VOTING_OPEN", not "at or past".
    const f: Fixture = await createFixture("auto-close-boundary");
    const { meeting, proposal } = await createProposalFixture(f);
    await openVotingWithLinks(f, proposal.id);

    await advanceMeetingStatus(f.president, meeting.id, "VOTING_OPEN");
    expect((await prisma.proposal.findUniqueOrThrow({ where: { id: proposal.id } })).status).toBe("VOTING_OPEN");
  });
});

// Plans/skupstina-draft-management-and-test-outbox-plan.md, Dio A — a DRAFT proposal
// previously couldn't be edited or removed at all (updateDraftProposal existed but had
// no caller; there was no delete/withdraw). §A.8's test list.
describe("draft proposal management (Dio A)", () => {
  let f: Fixture;
  beforeAll(async () => {
    f = await createFixture("draft-mgmt");
  });

  it("updateDraftProposal edits text and scope, and writes a proposal.update audit with before/after", async () => {
    const { proposal } = await createProposalFixture(f);
    const updated = await updateDraftProposal(f.president, proposal.id, {
      text: "Novi tekst nacrta.",
      scopeType: "BUILDING",
      buildingId: f.b1.id,
    });
    expect(updated.text).toBe("Novi tekst nacrta.");
    expect(updated.scopeType).toBe("BUILDING");
    expect(updated.buildingId).toBe(f.b1.id);
    const audits = await prisma.auditEvent.findMany({ where: { action: "proposal.update", targetId: proposal.id } });
    expect(audits.length).toBeGreaterThan(0);
    const last = audits[audits.length - 1];
    expect((last.after as { scopeType?: string })?.scopeType).toBe("BUILDING");
  });

  it("withdrawProposal sets WITHDRAWN, and openVoting on a withdrawn proposal is rejected", async () => {
    const { proposal } = await createProposalFixture(f);
    const withdrawn = await withdrawProposal(f.president, proposal.id, "Više nije aktuelno.");
    expect(withdrawn.status).toBe("WITHDRAWN");
    await expect(openVoting(f.president, proposal.id)).rejects.toThrow(/Nacrt/);
  });

  it("withdrawProposal without a reason fails", async () => {
    const { proposal } = await createProposalFixture(f);
    await expect(withdrawProposal(f.president, proposal.id, "")).rejects.toThrow(/razlog/);
  });

  it("deleteDraftProposal removes the row and its ProposalUnit rows, but the audit event survives with the deleted content", async () => {
    const { proposal } = await createProposalFixture(f);
    const unitsBefore = await prisma.proposalUnit.count({ where: { proposalId: proposal.id } });
    expect(unitsBefore).toBeGreaterThan(0);
    await deleteDraftProposal(f.president, proposal.id, "Duplikat unosa.");
    const gone = await prisma.proposal.findUnique({ where: { id: proposal.id } });
    expect(gone).toBeNull();
    const unitsAfter = await prisma.proposalUnit.count({ where: { proposalId: proposal.id } });
    expect(unitsAfter).toBe(0);
    const audits = await prisma.auditEvent.findMany({ where: { action: "proposal.delete", targetId: proposal.id } });
    expect(audits).toHaveLength(1);
    expect((audits[0].before as { text?: string })?.text).toBe(proposal.text);
  });

  it("deleteDraftProposal fails once the meeting has sent invitations, even though the proposal is still a draft", async () => {
    const { meeting, proposal } = await createProposalFixture(f);
    await advanceMeetingStatus(f.president, meeting.id, "INVITATIONS_SENT");
    await expect(deleteDraftProposal(f.president, proposal.id, "Greška.")).rejects.toThrow(/saopštena/);
    expect(canDeleteDraftProposal("INVITATIONS_SENT")).toBe(false);
    expect(canDeleteDraftProposal("SCHEDULED")).toBe(true);
  });

  it("deleteDraftProposal fails for a VOTING_OPEN proposal", async () => {
    const { proposal } = await createProposalFixture(f);
    await openVotingWithLinks(f, proposal.id);
    await expect(deleteDraftProposal(f.president, proposal.id, "Greška.")).rejects.toThrow(/nacrt/);
  });
});
