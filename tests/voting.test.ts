import { describe, it, expect, beforeAll } from "vitest";
import { prisma } from "@/lib/prisma";
import { createFixture, createProposalFixture, openVotingWithLinks, seedShapedZev, type Fixture } from "./helpers";
import {
  submitVote, reissueToken, revokeToken, closeVoting, recordManualVote,
  createProposalRevision, updateDraftProposal, computeProposalResult, createVotingRule,
  openVoting, advanceMeetingStatus, withdrawProposal, deleteDraftProposal, canDeleteDraftProposal,
  previewVotingDelivery, openProposalsForOwner, getMeeting, correctVote, inspectApprovalToken,
} from "@/server/services/meetings";
import { computeVotingResult, quorumRequirement, presenceQuorum, type RuleSnapshot } from "@/server/engines/voting";
import { dec } from "@/lib/money";
import { addOwnershipStake, setOfficeTerm } from "@/server/services/ownership";
import { establishUnitRegister } from "@/server/services/unitRegister";
import { generateVotingListPdf } from "@/server/services/documents";

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
    // K-03: since FR every voting subject weighs exactly 1 on the assembly (the fixture's rule was
    // written with OWNERSHIP_SHARE weights: A 35 / B 50 / C 15 of 100). Subjects: A, B, and the u3 community (C).
    const { proposal } = await createProposalFixture(f);
    const links = await openVotingWithLinks(f, proposal.id);
    const p = await prisma.proposal.findUniqueOrThrow({ where: { id: proposal.id } });
    const snapshot = p.ruleSnapshot as unknown as RuleSnapshot;
    expect(dec(snapshot.totalEligibleWeight).toFixed(2)).toBe("3.00");
    expect(snapshot.totalEligibleOwners).toBe(3);
    expect(snapshot.weightMethod).toBe("PER_OWNER");
    expect(snapshot.basisKind).toBe("ASSEMBLY_SUBJECTS");

    // Only A votes (1 of 3): quorum of 50% (2 subjects) NOT reached
    const lA = links.find((x) => x.toAddress === f.ownerA.email)!;
    await submitVote({ tokenPlain: lA.token, verificationCode: lA.code, choice: "APPROVE" });
    let result = await computeProposalResult(f.zev.id, proposal.id);
    expect(result.quorumReached).toBe(false);
    expect(result.weightCast.toFixed(0)).toBe("1");

    // B votes REJECT: quorum reached (2 >= 2); approve 1 vs reject 1 -> not more approve than reject -> rejected
    const lB = links.find((x) => x.toAddress === f.ownerB.email)!;
    await submitVote({ tokenPlain: lB.token, verificationCode: lB.code, choice: "REJECT" });
    result = await computeProposalResult(f.zev.id, proposal.id);
    expect(result.quorumReached).toBe(true);
    expect(result.approveWeight.toFixed(0)).toBe("1");
    expect(result.rejectWeight.toFixed(0)).toBe("1");
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

// FR (K-02, K-03, K-03a, K-01b) — plan §3.4: the assembly votes by etazni vlasnici, one vote each.
describe("FR — assembly voting by etazni vlasnici", () => {
  it("opens with one EligibleVoter per voting subject (5 for the seed's 6 persons / 8 units), each weighing 1", async () => {
    const { f, nikola, sara } = await seedShapedZev("fr-open");
    const { proposal } = await createProposalFixture(f, { scope: "ZEV" });
    await openVoting(f.president, proposal.id);

    const evs = await prisma.eligibleVoter.findMany({ where: { proposalId: proposal.id } });
    expect(evs).toHaveLength(5);
    expect(evs.every((ev) => ev.weight.toString() === "1")).toBe(true);
    expect(evs.every((ev) => ev.subjectKey !== "" && ev.memberPartyIds.length >= 1)).toBe(true);

    const community = evs.find((ev) => ev.memberPartyIds.length === 2)!;
    expect(community.ownerId).toBe(nikola.id); // default representative: 60 %
    expect([...community.memberPartyIds].sort()).toEqual([nikola.id, sara.id].sort());
    // only the representative holds a link: Sara has no EligibleVoter of her own and gets no e-mail
    expect(evs.some((ev) => ev.ownerId === sara.id)).toBe(false);
    const mails = await prisma.notificationMessage.findMany({ where: { relatedType: "Proposal", relatedId: proposal.id, template: "approval-link" } });
    expect(mails).toHaveLength(5);
    expect(mails.some((m) => m.toAddress === sara.email)).toBe(false);
    expect(mails.find((m) => m.toAddress === nikola.email)!.body).toContain("zajednički predstavnik");

    const snap = (await prisma.proposal.findUniqueOrThrow({ where: { id: proposal.id } })).ruleSnapshot as unknown as RuleSnapshot;
    expect(snap.totalEligibleOwners).toBe(5);
    expect(dec(snap.totalEligibleWeight).toFixed(0)).toBe("5");
    expect(snap.weightMethod).toBe("PER_OWNER");
    expect(snap.basisKind).toBe("ASSEMBLY_SUBJECTS");
    expect(snap.unitRegisterVersion).toBe(1);
    const audit = await prisma.auditEvent.findFirstOrThrow({ where: { action: "proposal.voting.open", targetId: proposal.id } });
    expect((audit.after as { basisKind: string }).basisKind).toBe("ASSEMBLY_SUBJECTS");
  });

  it("a legacy share-weighted rule is forced to weight 1 on the assembly (K-03)", async () => {
    const f = await createFixture("fr-legacy-rule");
    const legacy = await prisma.votingRule.create({
      data: {
        zevId: f.zev.id, name: `Stara ${f.t}`, quorumType: "PERCENT_OF_TOTAL_WEIGHT", quorumPercent: "50",
        majorityType: "SIMPLE_OF_VOTES_CAST", weightMethod: "OWNERSHIP_SHARE",
      },
    });
    const { proposal } = await createProposalFixture(f, { ruleId: legacy.id });
    await openVoting(f.president, proposal.id);
    const evs = await prisma.eligibleVoter.findMany({ where: { proposalId: proposal.id } });
    expect(evs.map((ev) => ev.weight.toString())).toEqual(["1", "1", "1"]);
    const snap = (await prisma.proposal.findUniqueOrThrow({ where: { id: proposal.id } })).ruleSnapshot as unknown as RuleSnapshot;
    expect(snap.weightMethod).toBe("PER_OWNER");
    expect(snap.totalEligibleWeight).toBe("3.000000");
  });

  it("the result reads in whole votes: 'Glasalo 2 od 5', quorum needs 3 of 5 (50 %, rounded up)", async () => {
    const { f } = await seedShapedZev("fr-result");
    const { proposal } = await createProposalFixture(f, { scope: "ZEV" });
    await openVoting(f.president, proposal.id);
    const evs = await prisma.eligibleVoter.findMany({ where: { proposalId: proposal.id } });
    for (const ev of evs.slice(0, 2)) {
      await recordManualVote(f.president, { eligibleVoterId: ev.id, choice: "APPROVE", channel: "PAPER" });
    }
    const result = await computeProposalResult(f.zev.id, proposal.id);
    expect(result.votesCast).toBe(2);
    expect(result.totalEligibleOwners).toBe(5);
    expect(result.quorumRequiredOwners).toBe(3);
    expect(result.quorumReached).toBe(false);
  });

  it("refuses to open while the register is not established, naming the way out; the previews report the same errors", async () => {
    const f = await createFixture("fr-pre-register", { registerStatus: "REVIEW" });
    const { proposal } = await createProposalFixture(f);
    await expect(openVoting(f.president, proposal.id)).rejects.toThrow(/Registar posebnih dijelova nije utvrđen/);
    const all = await previewVotingDelivery(f.president, proposal.id, "ALL");
    const live = await previewVotingDelivery(f.president, proposal.id, "LIVE");
    expect(all.preconditionErrors).toHaveLength(1);
    expect(live.preconditionErrors).toEqual(all.preconditionErrors);
    expect((await prisma.proposal.findUniqueOrThrow({ where: { id: proposal.id } })).status).toBe("DRAFT");
    expect(await prisma.eligibleVoter.count({ where: { proposalId: proposal.id } })).toBe(0);

    // once the president establishes it, the same proposal opens
    await establishUnitRegister(f.president);
    expect((await previewVotingDelivery(f.president, proposal.id, "ALL")).preconditionErrors).toEqual([]);
    await expect(openVoting(f.president, proposal.id)).resolves.toBeTruthy();
  });

  it("refuses a unit without an owner and a unit over 100 % (K-01b), naming the units; fixed, it opens", async () => {
    const f = await createFixture("fr-pre-units");
    // u2 loses its owner, u1 gets a second owner on top of A's 100 %
    await prisma.ownershipStake.updateMany({ where: { unitId: f.u2.id, validTo: null }, data: { validTo: new Date("2021-01-01") } });
    await addOwnershipStake(f.president, { unitId: f.u1.id, ownerId: f.ownerC.id, sharePercent: "50", validFrom: new Date("2022-01-01") },
      { buffer: Buffer.from("x"), filename: "d.pdf", mime: "application/pdf" });
    const { proposal } = await createProposalFixture(f);

    const preview = await previewVotingDelivery(f.president, proposal.id, "ALL");
    expect(preview.preconditionErrors).toHaveLength(2);
    const text = preview.preconditionErrors.join(" ");
    expect(text).toContain(f.u2.label);
    expect(text).toContain(f.u1.label);
    expect(text).toMatch(/150,00 %/);
    await expect(openVoting(f.president, proposal.id)).rejects.toThrow(new RegExp(f.u2.label));

    await prisma.ownershipStake.updateMany({ where: { unitId: f.u1.id, ownerId: f.ownerC.id }, data: { validTo: new Date("2022-02-01") } });
    await prisma.ownershipStake.create({ data: { zevId: f.zev.id, unitId: f.u2.id, ownerId: f.ownerB.id, sharePercent: "100", validFrom: new Date("2022-02-01") } });
    expect((await previewVotingDelivery(f.president, proposal.id, "ALL")).preconditionErrors).toEqual([]);
    await expect(openVoting(f.president, proposal.id)).resolves.toBeTruthy();
  });

  it("the board is untouched: a BOARD proposal opens on an unestablished register, with the pre-FR snapshot shape", async () => {
    const f = await createFixture("fr-board", { registerStatus: "DRAFT" });
    await setOfficeTerm(f.president, { role: "PRESIDENT", partyId: f.presidentParty.id, validFrom: new Date("2024-01-01") });
    const { proposal } = await createProposalFixture(f, { body: "BOARD" });
    await openVoting(f.president, proposal.id);
    const snap = (await prisma.proposal.findUniqueOrThrow({ where: { id: proposal.id } })).ruleSnapshot as unknown as RuleSnapshot;
    expect(snap.basisKind).toBeUndefined();
    expect(snap.unitRegisterVersion).toBeUndefined();
    const evs = await prisma.eligibleVoter.findMany({ where: { proposalId: proposal.id } });
    expect(evs.map((ev) => ev.subjectKey)).toContain(`B:${f.presidentParty.id}`);
  });

  it("the voting-list PDF renders one row per subject (incl. a long community name) without errors", async () => {
    const { f } = await seedShapedZev("fr-pdf");
    const { proposal } = await createProposalFixture(f, { scope: "ZEV" });
    await openVoting(f.president, proposal.id);
    const row = await generateVotingListPdf(f.president, proposal.id);
    expect(row.type).toBe("VOTING_LIST");
  });

  it("a co-owner who is not the representative sees the community's vote (openProposalsForOwner) and holds no link", async () => {
    const { f, sara, nikola } = await seedShapedZev("fr-owner-view");
    const { proposal } = await createProposalFixture(f, { scope: "ZEV" });
    await openVoting(f.president, proposal.id);
    const saraActor = { userId: "sara-user", roles: ["OWNER" as const], partyId: sara.id, zevId: f.zev.id };
    const mine = await openProposalsForOwner(saraActor, sara.id);
    expect(mine).toHaveLength(1);
    expect(mine[0].ownerId).toBe(nikola.id);
    expect(mine[0].proposalId).toBe(proposal.id);
    // an unrelated owner does not see it
    const other = await openProposalsForOwner({ userId: "x", roles: ["OWNER" as const], partyId: f.ownerA.id, zevId: f.zev.id }, f.ownerA.id);
    expect(other.map((o) => o.ownerId)).toEqual([f.ownerA.id]);
  });

  it("the representative's link votes for the whole community; the vote is recorded under the representative", async () => {
    const { f, nikola } = await seedShapedZev("fr-vote");
    const { proposal } = await createProposalFixture(f, { scope: "ZEV" });
    const links = await openVotingWithLinks(f, proposal.id);
    const l = links.find((x) => x.toAddress === nikola.email)!;
    expect((await submitVote({ tokenPlain: l.token, verificationCode: l.code, choice: "APPROVE" })).ok).toBe(true);
    const vote = await prisma.vote.findFirstOrThrow({ where: { proposalId: proposal.id, voterId: nikola.id } });
    expect(vote.weight.toString()).toBe("1");
  });

  it("closed proposals frozen with a pre-FR snapshot count the same before and after the rules are converted (K-03 safety)", async () => {
    // (the conversion itself is covered in tests/voting-rules-convert.test.ts — this one checks the engine:
    //  a share-weighted legacy snapshot is still evaluated by its own frozen numbers)
    const rule: RuleSnapshot = {
      ruleName: "stari", quorumType: "PERCENT_OF_TOTAL_WEIGHT", quorumPercent: "50",
      majorityType: "SIMPLE_OF_VOTES_CAST", majorityPercent: null, weightMethod: "OWNERSHIP_SHARE",
      totalEligibleWeight: "100", totalEligibleOwners: 3,
    };
    const votes = [
      { eligibleVoterId: "a", choice: "APPROVE" as const, weight: dec(35), countsForQuorum: true, invalid: false },
      { eligibleVoterId: "b", choice: "REJECT" as const, weight: dec(50), countsForQuorum: true, invalid: false },
    ];
    const r = computeVotingResult(rule, votes);
    expect(r.quorumReached).toBe(true);
    expect(r.accepted).toBe(false);
  });
});

describe("F6.3 — quorumRequirement and presenceQuorum (pure engine)", () => {
  const snap = (over: Partial<RuleSnapshot>): RuleSnapshot => ({
    ruleName: null, quorumType: "PERCENT_OF_OWNER_COUNT", quorumPercent: "50", majorityType: "SIMPLE_OF_VOTES_CAST", majorityPercent: null,
    weightMethod: "PER_OWNER", totalEligibleWeight: "5", totalEligibleOwners: 5, ...over,
  });
  const votes = (n: number) =>
    Array.from({ length: n }, (_, i) => ({ eligibleVoterId: `v${i}`, choice: "APPROVE" as const, weight: dec(1), countsForQuorum: true, invalid: false }));

  it("quorumRequirement gives the same thresholds computeVotingResult reports, for all three quorum types", () => {
    const cases: RuleSnapshot[] = [
      snap({ quorumType: "NONE", quorumPercent: null }),
      snap({ quorumType: "PERCENT_OF_OWNER_COUNT", quorumPercent: "50", totalEligibleOwners: 5 }),
      snap({ quorumType: "PERCENT_OF_OWNER_COUNT", quorumPercent: "33.333", totalEligibleOwners: 10 }),
      snap({ quorumType: "PERCENT_OF_TOTAL_WEIGHT", quorumPercent: "40", totalEligibleWeight: "250.5", totalEligibleOwners: 7 }),
    ];
    for (const rule of cases) {
      const req = quorumRequirement(rule, { totalEligibleWeight: rule.totalEligibleWeight, totalEligibleOwners: rule.totalEligibleOwners });
      const res = computeVotingResult(rule, votes(1));
      expect(req.requiredOwners).toBe(res.quorumRequiredOwners);
      expect(req.requiredWeight?.toFixed(6) ?? null).toBe(res.quorumRequiredWeight?.toFixed(6) ?? null);
    }
  });

  it("owner-count threshold rounds up (50 % of 5 -> 3, 33.333 % of 10 -> 4)", () => {
    expect(quorumRequirement(snap({}), { totalEligibleWeight: "5", totalEligibleOwners: 5 }).requiredOwners).toBe(3);
    expect(quorumRequirement(snap({ quorumPercent: "33.333" }), { totalEligibleWeight: "10", totalEligibleOwners: 10 }).requiredOwners).toBe(4);
    expect(quorumRequirement(snap({ quorumType: "NONE" }), { totalEligibleWeight: "10", totalEligibleOwners: 10 })).toEqual({ requiredWeight: null, requiredOwners: null });
  });

  it("presenceQuorum by head count: reached from the threshold, missing never negative", () => {
    const totals = { totalEligibleWeight: "5", totalEligibleOwners: 5 };
    expect(presenceQuorum(snap({}), totals, { count: 2, weight: dec(2) })).toMatchObject({ kind: "COUNT", required: 3, reached: false, missing: 1 });
    expect(presenceQuorum(snap({}), totals, { count: 3, weight: dec(3) })).toMatchObject({ kind: "COUNT", reached: true, missing: 0 });
    expect(presenceQuorum(snap({}), totals, { count: 5, weight: dec(5) })).toMatchObject({ reached: true, missing: 0 });
  });

  it("presenceQuorum by weight compares the weight of those present (no rounding of the weight itself)", () => {
    const rule = snap({ quorumType: "PERCENT_OF_TOTAL_WEIGHT", quorumPercent: "50", totalEligibleWeight: "100", weightMethod: "OWNERSHIP_SHARE" });
    const q = presenceQuorum(rule, { totalEligibleWeight: "100", totalEligibleOwners: 4 }, { count: 2, weight: dec("49.5") });
    expect(q.kind).toBe("WEIGHT");
    if (q.kind === "WEIGHT") {
      expect(q.requiredWeight.toFixed(1)).toBe("50.0");
      expect(q.reached).toBe(false);
      expect(q.missingWeight.toFixed(1)).toBe("0.5");
    }
    expect(presenceQuorum(rule, { totalEligibleWeight: "100", totalEligibleOwners: 4 }, { count: 2, weight: dec("50") })).toMatchObject({ reached: true });
  });

  it("presenceQuorum for a rule without a quorum is NONE", () => {
    expect(presenceQuorum(snap({ quorumType: "NONE" }), { totalEligibleWeight: "5", totalEligibleOwners: 5 }, { count: 0, weight: dec(0) })).toEqual({ kind: "NONE" });
  });
});

describe("F6.2 — getMeeting: voted X of Y per proposal", () => {
  it("counts effective votes once (a corrected vote is not counted twice) and the voters of the base", async () => {
    const f = await createFixture("meet-agg");
    const { meeting, proposal } = await createProposalFixture(f);
    const draft = (await getMeeting(f.president, meeting.id)).proposals.find((p) => p.id === proposal.id)!;
    expect([draft.votersCount, draft.votedCount]).toEqual([0, 0]);

    const links = await openVotingWithLinks(f, proposal.id);
    const lA = links.find((l) => l.toAddress === f.ownerA.email)!;
    const lB = links.find((l) => l.toAddress === f.ownerB.email)!;
    await submitVote({ tokenPlain: lA.token, verificationCode: lA.code, choice: "APPROVE" });
    await submitVote({ tokenPlain: lB.token, verificationCode: lB.code, choice: "REJECT" });
    let row = (await getMeeting(f.president, meeting.id)).proposals.find((p) => p.id === proposal.id)!;
    expect([row.votersCount, row.votedCount]).toEqual([3, 2]);

    const original = await prisma.vote.findFirstOrThrow({ where: { proposalId: proposal.id, voterId: f.ownerA.id } });
    await correctVote(f.president, { voteId: original.id, choice: "REJECT", reason: "Greška u evidenciji", authority: "Odluka skupštine" });
    row = (await getMeeting(f.president, meeting.id)).proposals.find((p) => p.id === proposal.id)!;
    expect(row.votedCount).toBe(2); // original + correction still one vote
  });
});

describe("F4: single-link page data", () => {
  it("inspectApprovalToken returns the proposal's attachments, the body and the president's name", async () => {
    const f = await createFixture("vote-f4");
    await setOfficeTerm(f.president, { role: "PRESIDENT", partyId: f.presidentParty.id, validFrom: new Date("2020-01-01") });
    const { proposal } = await createProposalFixture(f);
    const att = await prisma.attachment.create({ data: { zevId: f.zev.id, filename: "ponuda.pdf", mime: "application/pdf", size: 2048, category: "OTHER", sha256: "ff00" } });
    await prisma.proposal.update({ where: { id: proposal.id }, data: { attachments: { connect: { id: att.id } } } });
    const links = await openVotingWithLinks(f, proposal.id);
    const l = links.find((x) => x.toAddress === f.ownerA.email)!;
    const info = await inspectApprovalToken(l.token);
    expect(info.ok).toBe(true);
    if (!info.ok) return;
    expect(info.proposal.attachments).toEqual([{ id: att.id, filename: "ponuda.pdf", mime: "application/pdf", size: 2048, sha256: "ff00" }]);
    expect(info.proposal.body).toBe("ASSEMBLY");
    expect(info.voter.units.length).toBeGreaterThan(0);
    expect(info.presidentName).toContain("Predsjednik");
  });

  it("submitVote reports attemptsLeft on a wrong code; the acknowledgement text names the attachments for new votes", async () => {
    const f = await createFixture("vote-f4b");
    const { proposal } = await createProposalFixture(f);
    const links = await openVotingWithLinks(f, proposal.id);
    const l = links.find((x) => x.toAddress === f.ownerA.email)!;
    const miss = await submitVote({ tokenPlain: l.token, verificationCode: "999999", choice: "APPROVE" });
    expect(miss).toMatchObject({ ok: false, error: "bad_code", attemptsLeft: 4 });
    const ok = await submitVote({ tokenPlain: l.token, verificationCode: l.code, choice: "APPROVE" });
    expect(ok.ok).toBe(true);
    const vote = await prisma.vote.findFirstOrThrow({ where: { proposalId: proposal.id, voterId: f.ownerA.id } });
    expect(vote.acknowledgementText).toContain("njegove priloge");
  });
});
