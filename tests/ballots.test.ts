// v2.44.0 — glasački listić po sjednici (Plans/glasacki-listic-po-sjednici-plan.md §5):
// jedan e-mail, jedan link i jedan kod po glasaču za sve prijedloge sjednice; glasovi sa listića su
// "svi ili nijedan", a dokaz ostaje po prijedlogu (poseban Vote po prijedlogu).
import { describe, it, expect, afterEach, vi } from "vitest";
import { prisma } from "@/lib/prisma";
import { createFixture, uid, type Fixture } from "./helpers";
import {
  createMeeting, createProposal, advanceMeetingStatus, previewSessionVotingOpen, openVoting, issueMeetingBallots,
  inspectBallot, submitBallot, submitVote, inspectApprovalToken, reissueBallot, revokeBallot, reissueToken, revokeToken,
  dispatchMeetingEmails, getMeetingBallotSummary, queueMeetingInvitations, computeProposalResult, recordManualVote,
  closeVoting, getProposal,
} from "@/server/services/meetings";
import { serializeResult } from "@/server/engines/voting";
import { grantProxy, setOfficeTerm } from "@/server/services/ownership";
import { extractApprovalSecrets } from "@/server/notifications/testOutbox";
import { enqueueNotification } from "@/server/notifications/service";
import { ForbiddenError } from "@/server/auth/guards";
import { sha256 } from "@/server/auth/tokens";

const DAY = 86_400_000;

/** A session with `n` draft proposals sharing one deadline; all of them cover the fixture's four units. */
async function session(f: Fixture, n = 2, opts?: { scopes?: ("ALL" | "A")[] }) {
  const closes = new Date(Date.now() + 7 * DAY);
  const meeting = await createMeeting(f.president, { title: `Sjednica ${f.t}`, type: "REGULAR", eVoteClosesAt: closes });
  const proposals = [];
  for (let i = 0; i < n; i++) {
    const onlyA = opts?.scopes?.[i] === "A";
    proposals.push(
      await createProposal(f.president, {
        meetingId: meeting.id,
        code: uid(`P${i + 1}`),
        title: `Prijedlog ${i + 1} ${f.t}`,
        text: `Tekst prijedloga ${i + 1}.`,
        scopeType: "UNITS",
        unitIds: onlyA ? [f.u1.id] : [f.u1.id, f.u2.id, f.u3.id, f.u4.id],
        votingRuleId: f.rule.id,
        votingClosesAt: closes,
      })
    );
  }
  return { meeting, proposals };
}

/** Opens the session's voting the way the desktop button does (ballot delivery) and returns the ballot links. */
async function openSession(f: Fixture, meetingId: string) {
  await advanceMeetingStatus(f.president, meetingId, "VOTING_OPEN", undefined, { openDraftProposals: true });
  return ballotLinks(meetingId);
}

async function ballotLinks(meetingId: string) {
  const ballots = await prisma.ballot.findMany({ where: { meetingId }, orderBy: { createdAt: "asc" } });
  const messages = await prisma.notificationMessage.findMany({
    where: { relatedType: "Ballot", relatedId: { in: ballots.map((b) => b.id) }, template: { in: ["ballot-link", "ballot-link-reissue"] } },
    orderBy: { createdAt: "asc" },
  });
  return messages.map((m) => ({ messageId: m.id, ballotId: m.relatedId!, toAddress: m.toAddress, body: m.body, subject: m.subject ?? "", ...extractApprovalSecrets(m.body) }));
}

const linkFor = (links: Awaited<ReturnType<typeof ballotLinks>>, email: string) => {
  const l = links.find((x) => x.toAddress === email);
  if (!l) throw new Error(`no ballot message for ${email}`);
  return { token: l.token!, code: l.code!, ballotId: l.ballotId };
};

const choicesFor = (proposals: { id: string }[], pick: (i: number) => "APPROVE" | "REJECT" | "ABSTAIN") =>
  Object.fromEntries(proposals.map((p, i) => [p.id, pick(i)]));

afterEach(() => vi.restoreAllMocks());

describe("openVoting(…, { delivery: \"BALLOT\" })", () => {
  it("writes the voting base and tokens but queues no message and attaches no ballot", async () => {
    const f = await createFixture("bal-open");
    const { proposals } = await session(f, 1);
    await openVoting(f.president, proposals[0].id, { delivery: "BALLOT" });
    const tokens = await prisma.approvalToken.findMany({ where: { eligibleVoter: { proposalId: proposals[0].id } } });
    expect(tokens).toHaveLength(3);
    expect(tokens.every((tk) => tk.deliveredVia === "BALLOT" && tk.ballotId === null)).toBe(true);
    expect(await prisma.notificationMessage.count({ where: { relatedType: "Proposal", relatedId: proposals[0].id } })).toBe(0);
    expect((await prisma.auditEvent.findFirstOrThrow({ where: { action: "proposal.voting.open", targetId: proposals[0].id } })).after).toMatchObject({ delivery: "BALLOT" });
  });
});

describe("issueMeetingBallots / session opening", () => {
  it("one ballot and ONE message per recipient for all proposals; none of the old per-proposal messages", async () => {
    const f = await createFixture("bal-issue");
    const { meeting, proposals } = await session(f, 3);
    const pre = await previewSessionVotingOpen(f.president, meeting.id);
    expect(pre.blocked).toBe(false);
    expect(pre.ballots).toBe(3); // A, B and C (the representative of the u3 community)

    const links = await openSession(f, meeting.id);
    expect(links).toHaveLength(3);
    expect(await prisma.ballot.count({ where: { meetingId: meeting.id } })).toBe(3);
    for (const p of proposals) {
      expect(await prisma.notificationMessage.count({ where: { relatedType: "Proposal", relatedId: p.id } })).toBe(0);
    }
    // every ballot covers all three proposals; its message lists them and carries link, code and deadline
    for (const l of links) {
      const b = await prisma.ballot.findUniqueOrThrow({ where: { id: l.ballotId }, include: { tokens: true } });
      expect(b.tokens).toHaveLength(3);
      for (const p of proposals) expect(l.body).toContain(p.code);
      expect(l.subject).toContain("3 prijedloga");
      expect(l.token).toBeTruthy();
      expect(l.code).toMatch(/^\d{6}$/);
    }
    // secrets are only hashes in the database and never in the audit trail
    const ballot = await prisma.ballot.findFirstOrThrow({ where: { meetingId: meeting.id } });
    expect(ballot.tokenHash).toHaveLength(64);
    const audits = await prisma.auditEvent.findMany({ where: { action: "ballot.issue", targetType: "Ballot" }, orderBy: { createdAt: "desc" }, take: 3 });
    for (const l of links) expect(JSON.stringify(audits)).not.toContain(l.token!);
    // the page-level numbers equal what was produced
    expect((await prisma.notificationMessage.count({ where: { template: "ballot-link", relatedId: { in: links.map((l) => l.ballotId) } } }))).toBe(pre.ballots);
  });

  it("a voter in the scope of only some proposals gets a ballot with only those", async () => {
    const f = await createFixture("bal-scope");
    const { meeting, proposals } = await session(f, 2, { scopes: ["ALL", "A"] });
    const links = await openSession(f, meeting.id);
    const count = async (email: string) =>
      (await prisma.ballot.findUniqueOrThrow({ where: { id: linkFor(links, email).ballotId }, include: { tokens: true } })).tokens.length;
    expect(await count(f.ownerA.email!)).toBe(2);
    expect(await count(f.ownerB.email!)).toBe(1);
    expect(await count(f.ownerC.email!)).toBe(1);
    expect(proposals).toHaveLength(2);
  });

  it("a proxy holder gets one ballot for their own and the represented owner's tokens (no ballot for the grantor)", async () => {
    const f = await createFixture("bal-proxy");
    await grantProxy(f.president, { grantorId: f.ownerA.id, holderId: f.ownerC.id, scope: "ALL", validFrom: new Date("2020-01-01") });
    const { meeting } = await session(f, 2);
    const links = await openSession(f, meeting.id);
    expect(links.map((l) => l.toAddress).sort()).toEqual([f.ownerB.email!, f.ownerC.email!].sort());
    const c = links.find((l) => l.toAddress === f.ownerC.email)!;
    const b = await prisma.ballot.findUniqueOrThrow({ where: { id: c.ballotId }, include: { tokens: true } });
    expect(b.tokens).toHaveLength(4); // A's two (via proxy) + the u3 community's two
    expect(c.body).toContain("kao punomoćnik vlasnika");
  });

  it("different recipients per proposal give separate ballots (grouping is always by recipient)", async () => {
    const f = await createFixture("bal-split");
    const { meeting, proposals } = await session(f, 2);
    for (const p of proposals) await openVoting(f.president, p.id, { delivery: "BALLOT" });
    // A is represented by C on the second proposal only
    await prisma.eligibleVoter.updateMany({ where: { proposalId: proposals[1].id, ownerId: f.ownerA.id }, data: { proxyId: f.ownerC.id } });
    const r = await issueMeetingBallots(f.president, meeting.id);
    expect(r.ballots).toBe(3);
    const links = await ballotLinks(meeting.id);
    const aBallot = await prisma.ballot.findUniqueOrThrow({ where: { id: linkFor(links, f.ownerA.email!).ballotId }, include: { tokens: { include: { eligibleVoter: true } } } });
    expect(aBallot.tokens.map((tk) => tk.eligibleVoter.proposalId)).toEqual([proposals[0].id]);
    const cBallot = await prisma.ballot.findUniqueOrThrow({ where: { id: linkFor(links, f.ownerC.email!).ballotId }, include: { tokens: true } });
    expect(cBallot.tokens).toHaveLength(3); // two community tokens + A's token of the second proposal
  });

  it("a repeated call creates no duplicates; a voter without an address gets no ballot but stays in the base", async () => {
    const f = await createFixture("bal-idem");
    await prisma.party.update({ where: { id: f.ownerB.id }, data: { email: null } });
    const { meeting, proposals } = await session(f, 2);
    await openSession(f, meeting.id);
    expect(await prisma.ballot.count({ where: { meetingId: meeting.id } })).toBe(2);
    const again = await issueMeetingBallots(f.president, meeting.id);
    expect(again.ballots).toBe(0);
    expect(again.withoutEmail).toBe(1);
    expect(await prisma.ballot.count({ where: { meetingId: meeting.id } })).toBe(2);
    expect(await prisma.notificationMessage.count({ where: { template: "ballot-link", relatedType: "Ballot", relatedId: { in: (await prisma.ballot.findMany({ where: { meetingId: meeting.id } })).map((b) => b.id) } } })).toBe(2);
    expect(await prisma.eligibleVoter.count({ where: { proposalId: proposals[0].id } })).toBe(3);
  });

  it("P-L3: proposals with different deadlines block opening the session, naming them", async () => {
    const f = await createFixture("bal-deadline");
    const { meeting, proposals } = await session(f, 2);
    await prisma.proposal.update({ where: { id: proposals[1].id }, data: { votingClosesAt: new Date(Date.now() + 3 * DAY) } });
    const pre = await previewSessionVotingOpen(f.president, meeting.id);
    expect(pre.blocked).toBe(true);
    expect(pre.sessionErrors).toHaveLength(1);
    expect(pre.sessionErrors[0]).toContain(proposals[0].code);
    expect(pre.sessionErrors[0]).toContain(proposals[1].code);
    await expect(advanceMeetingStatus(f.president, meeting.id, "VOTING_OPEN", undefined, { openDraftProposals: true })).rejects.toThrow(/različite rokove/);
    expect((await prisma.meeting.findUniqueOrThrow({ where: { id: meeting.id } })).status).toBe("DRAFT");
    expect(await prisma.ballot.count({ where: { meetingId: meeting.id } })).toBe(0);
  });

  it("P-L2: a new proposal cannot be added once ballots were issued for the session", async () => {
    const f = await createFixture("bal-locked");
    const { meeting } = await session(f, 1);
    await openSession(f, meeting.id);
    await expect(
      createProposal(f.president, {
        meetingId: meeting.id, code: uid("late"), title: "Kasni", text: "x", scopeType: "ZEV", votingRuleId: f.rule.id,
      })
    ).rejects.toThrow(/novi prijedlog ide na novu sjednicu/);
  });

  it("P-L2: a session whose voting is open without ballots (live mode) can still get a new proposal", async () => {
    const f = await createFixture("bal-live-add");
    const { meeting } = await session(f, 1);
    await advanceMeetingStatus(f.president, meeting.id, "VOTING_OPEN"); // live mode: no openDraftProposals, no ballots
    expect(await prisma.ballot.count({ where: { meetingId: meeting.id } })).toBe(0);
    await expect(
      createProposal(f.president, {
        meetingId: meeting.id, code: uid("live"), title: "Nova tačka uživo", text: "x", scopeType: "ZEV", votingRuleId: f.rule.id,
      })
    ).resolves.toBeTruthy();
  });

  it("is idempotent after a partial failure: repeating the step issues the missing ballots only", async () => {
    const f = await createFixture("bal-resume");
    const { meeting, proposals } = await session(f, 2);
    // simulate "proposals opened, ballots not issued yet"
    for (const p of proposals) await openVoting(f.president, p.id, { delivery: "BALLOT" });
    expect(await prisma.ballot.count({ where: { meetingId: meeting.id } })).toBe(0);
    await advanceMeetingStatus(f.president, meeting.id, "VOTING_OPEN", undefined, { openDraftProposals: true });
    expect(await prisma.ballot.count({ where: { meetingId: meeting.id } })).toBe(3);
  });
});

describe("submitBallot", () => {
  it("writes one Vote per proposal with each proposal's own text fingerprint, spends tokens and ballot, audits without choices", async () => {
    const f = await createFixture("bal-submit");
    const { meeting, proposals } = await session(f, 3);
    const links = await openSession(f, meeting.id);
    const a = linkFor(links, f.ownerA.email!);
    const info = await inspectBallot(a.token);
    expect(info.ok).toBe(true);
    if (info.ok) expect(info.proposals.map((p) => p.state)).toEqual(["open", "open", "open"]);

    const res = await submitBallot({
      tokenPlain: a.token, verificationCode: a.code, ack: true,
      choices: choicesFor(proposals, (i) => (["APPROVE", "REJECT", "ABSTAIN"] as const)[i]),
    });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.receipt.items).toHaveLength(3);

    const votes = await prisma.vote.findMany({ where: { voterId: f.ownerA.id, proposalId: { in: proposals.map((p) => p.id) } } });
    expect(votes).toHaveLength(3);
    for (const v of votes) {
      const p = proposals.find((x) => x.id === v.proposalId)!;
      const frozen = await prisma.proposal.findUniqueOrThrow({ where: { id: p.id } });
      expect(v.proposalHash).toBe(frozen.contentHash);
      expect(v.deliveryChannel).toBe("BALLOT");
      expect(v.channel).toBe("ELECTRONIC");
    }
    expect(votes.map((v) => v.choice).sort()).toEqual(["ABSTAIN", "APPROVE", "REJECT"]);
    expect(new Set(votes.map((v) => v.proposalHash)).size).toBe(3);
    const b = await prisma.ballot.findUniqueOrThrow({ where: { id: a.ballotId }, include: { tokens: true } });
    expect(b.status).toBe("USED");
    expect(b.tokens.every((tk) => tk.status === "USED")).toBe(true);

    const voteAudits = await prisma.auditEvent.findMany({ where: { action: "vote.submit", targetId: { in: votes.map((v) => v.id) } } });
    expect(voteAudits).toHaveLength(3);
    const ballotAudit = await prisma.auditEvent.findFirstOrThrow({ where: { action: "ballot.submit", targetId: a.ballotId } });
    const dump = JSON.stringify([...voteAudits, ballotAudit]);
    expect(dump).not.toContain(a.token);
    expect(dump).not.toContain(a.code);
    expect(ballotAudit.after).not.toHaveProperty("choices");
    expect(ballotAudit.zevId).toBe(f.zev.id);
    // a second submit is refused and writes nothing
    const again = await submitBallot({ tokenPlain: a.token, verificationCode: a.code, ack: true, choices: choicesFor(proposals, () => "APPROVE") });
    expect(again).toMatchObject({ ok: false, error: "used" });
    expect(await prisma.vote.count({ where: { voterId: f.ownerA.id, proposalId: { in: proposals.map((p) => p.id) } } })).toBe(3);
  });

  it("a missing choice writes nothing and names the proposal; choices stay submittable afterwards", async () => {
    const f = await createFixture("bal-missing");
    const { meeting, proposals } = await session(f, 3);
    const a = linkFor(await openSession(f, meeting.id), f.ownerA.email!);
    const res = await submitBallot({
      tokenPlain: a.token, verificationCode: a.code, ack: true,
      choices: { [proposals[0].id]: "APPROVE", [proposals[2].id]: "REJECT" },
    });
    expect(res).toMatchObject({ ok: false, error: "missing_choices" });
    if (!res.ok && "proposals" in res) expect(res.proposals?.map((p) => p.code)).toEqual([proposals[1].code]);
    expect(await prisma.vote.count({ where: { voterId: f.ownerA.id, proposalId: { in: proposals.map((p) => p.id) } } })).toBe(0);
    expect((await prisma.ballot.findUniqueOrThrow({ where: { id: a.ballotId } })).status).toBe("ACTIVE");
    expect(await prisma.approvalToken.count({ where: { ballotId: a.ballotId, status: "USED" } })).toBe(0);
    // the same ballot still works with a complete set
    const ok = await submitBallot({ tokenPlain: a.token, verificationCode: a.code, ack: true, choices: choicesFor(proposals, () => "ABSTAIN") });
    expect(ok.ok).toBe(true);
  });

  it("without the acknowledgement nothing is written", async () => {
    const f = await createFixture("bal-ack");
    const { meeting, proposals } = await session(f, 2);
    const a = linkFor(await openSession(f, meeting.id), f.ownerA.email!);
    expect(await submitBallot({ tokenPlain: a.token, verificationCode: a.code, ack: false, choices: choicesFor(proposals, () => "APPROVE") })).toMatchObject({ ok: false, error: "ack_required" });
    expect(await prisma.vote.count({ where: { voterId: f.ownerA.id } })).toBe(0);
  });

  it("a wrong code writes nothing; five misses revoke the ballot (audited), later even the right code fails", async () => {
    const f = await createFixture("bal-code");
    const { meeting, proposals } = await session(f, 2);
    const a = linkFor(await openSession(f, meeting.id), f.ownerA.email!);
    const wrong = a.code === "000000" ? "111111" : "000000";
    const choices = choicesFor(proposals, () => "APPROVE");
    for (let i = 0; i < 4; i++) {
      expect(await submitBallot({ tokenPlain: a.token, verificationCode: wrong, ack: true, choices, ipHash: `ip-${a.ballotId}-${i}` })).toMatchObject({ ok: false, error: "bad_code" });
    }
    expect(await prisma.vote.count({ where: { voterId: f.ownerA.id } })).toBe(0);
    expect((await prisma.ballot.findUniqueOrThrow({ where: { id: a.ballotId } })).status).toBe("ACTIVE");
    expect(await submitBallot({ tokenPlain: a.token, verificationCode: wrong, ack: true, choices, ipHash: `ip-${a.ballotId}-5` })).toMatchObject({ ok: false, error: "bad_code" });
    const b = await prisma.ballot.findUniqueOrThrow({ where: { id: a.ballotId } });
    expect(b.status).toBe("REVOKED");
    expect(b.failedAttempts).toBe(5);
    expect(await prisma.auditEvent.count({ where: { action: "ballot.revoke.auto", targetId: a.ballotId } })).toBe(1);
    expect(await submitBallot({ tokenPlain: a.token, verificationCode: a.code, ack: true, choices, ipHash: `ip-${a.ballotId}-6` })).toMatchObject({ ok: false, error: "revoked" });
  });

  it("a proposal that closed meanwhile is not required; one already settled by a paper vote is skipped, the rest are written", async () => {
    const f = await createFixture("bal-skip");
    const { meeting, proposals } = await session(f, 3);
    const a = linkFor(await openSession(f, meeting.id), f.ownerA.email!);
    // P1 closes, P2 gets a paper vote for A
    await closeVoting(f.president, proposals[0].id);
    const evA2 = await prisma.eligibleVoter.findFirstOrThrow({ where: { proposalId: proposals[1].id, ownerId: f.ownerA.id } });
    await recordManualVote(f.president, { eligibleVoterId: evA2.id, choice: "REJECT", channel: "PAPER" });

    const info = await inspectBallot(a.token);
    expect(info.ok).toBe(true);
    if (info.ok) expect(info.proposals.map((p) => p.state)).toEqual(["closed", "voted", "open"]);

    // choosing for the closed proposal is an error, nothing written
    expect(await submitBallot({ tokenPlain: a.token, verificationCode: a.code, ack: true, choices: { [proposals[0].id]: "APPROVE", [proposals[2].id]: "APPROVE" } }))
      .toMatchObject({ ok: false, error: "invalid_choice" });
    expect(await prisma.vote.count({ where: { voterId: f.ownerA.id, proposalId: proposals[2].id } })).toBe(0);

    const ok = await submitBallot({ tokenPlain: a.token, verificationCode: a.code, ack: true, choices: { [proposals[2].id]: "APPROVE" } });
    expect(ok.ok).toBe(true);
    if (ok.ok) {
      expect(ok.receipt.items.map((i) => i.proposalId)).toEqual([proposals[2].id]);
      expect(ok.receipt.skipped.map((s) => s.reason).sort()).toEqual(["closed", "voted"]);
    }
    // the paper vote is untouched and still the only vote on P2
    const p2 = await prisma.vote.findMany({ where: { proposalId: proposals[1].id, eligibleVoterId: evA2.id } });
    expect(p2).toHaveLength(1);
    expect(p2[0].channel).toBe("PAPER");
  });

  it("a choice for a proposal that is not on the ballot is an error", async () => {
    const f = await createFixture("bal-foreign");
    const { meeting, proposals } = await session(f, 2, { scopes: ["ALL", "A"] });
    const links = await openSession(f, meeting.id);
    const b = linkFor(links, f.ownerB.email!); // B is not in the scope of the second proposal
    const res = await submitBallot({ tokenPlain: b.token, verificationCode: b.code, ack: true, choices: { [proposals[0].id]: "APPROVE", [proposals[1].id]: "APPROVE" } });
    expect(res).toMatchObject({ ok: false, error: "invalid_choice" });
    expect(await prisma.vote.count({ where: { voterId: f.ownerB.id } })).toBe(0);
  });

  it("an unknown or invalid choice value is rejected", async () => {
    const f = await createFixture("bal-value");
    const { meeting, proposals } = await session(f, 2);
    const a = linkFor(await openSession(f, meeting.id), f.ownerA.email!);
    expect(await submitBallot({ tokenPlain: a.token, verificationCode: a.code, ack: true, choices: { [proposals[0].id]: "APPROVE", [proposals[1].id]: "MAYBE" } }))
      .toMatchObject({ ok: false, error: "invalid_choice" });
    expect(await prisma.vote.count({ where: { voterId: f.ownerA.id } })).toBe(0);
  });

  it("a token that belongs to a ballot cannot vote on its own (use_ballot)", async () => {
    const f = await createFixture("bal-usetoken");
    const { meeting } = await session(f, 2);
    await openSession(f, meeting.id);
    // The single-proposal tokens were never delivered; even if someone knew one, it is refused.
    const tk = await prisma.approvalToken.findFirstOrThrow({ where: { ballotId: { not: null }, eligibleVoter: { proposal: { meetingId: meeting.id } } } });
    const known = "known-link-token-for-test";
    await prisma.approvalToken.update({ where: { id: tk.id }, data: { tokenHash: sha256(known), verificationHash: sha256("123456") } });
    expect(await submitVote({ tokenPlain: known, verificationCode: "123456", choice: "APPROVE" })).toMatchObject({ ok: false, error: "use_ballot" });
    expect(await inspectApprovalToken(known)).toMatchObject({ ok: false, error: "use_ballot" });
    expect(await prisma.vote.count({ where: { tokenId: tk.id } })).toBe(0);
    // and per-token management refuses it too
    await expect(reissueToken(f.president, tk.id, "x")).rejects.toThrow(/listić/);
    await expect(revokeToken(f.president, tk.id, "x")).rejects.toThrow(/listić/);
  });

  it("an expired or closed-for-all ballot reports it", async () => {
    const f = await createFixture("bal-expired");
    const { meeting, proposals } = await session(f, 1);
    const links = await openSession(f, meeting.id);
    const a = linkFor(links, f.ownerA.email!);
    const b = linkFor(links, f.ownerB.email!);
    await prisma.ballot.update({ where: { id: a.ballotId }, data: { expiresAt: new Date(Date.now() - 1000) } });
    expect(await inspectBallot(a.token)).toMatchObject({ ok: false, error: "expired" });
    await closeVoting(f.president, proposals[0].id);
    expect(await inspectBallot(b.token)).toMatchObject({ ok: false, error: "voting_closed" });
    expect(await inspectBallot("no-such-token-" + f.t)).toMatchObject({ ok: false, error: "not_found" });
  });
});

describe("result equality: ballot votes vs single-token votes", () => {
  it("gives the same computeProposalResult as the same votes through individual tokens", async () => {
    const f = await createFixture("bal-equal");
    const plan: Record<string, ("APPROVE" | "REJECT" | "ABSTAIN")[]> = {
      [f.ownerA.email!]: ["APPROVE", "REJECT"],
      [f.ownerB.email!]: ["REJECT", "REJECT"],
      [f.ownerC.email!]: ["APPROVE", "ABSTAIN"],
    };
    // (1) ballots
    const viaBallot = await session(f, 2);
    const links = await openSession(f, viaBallot.meeting.id);
    for (const [email, picks] of Object.entries(plan)) {
      const l = linkFor(links, email);
      const r = await submitBallot({ tokenPlain: l.token, verificationCode: l.code, ack: true, choices: choicesFor(viaBallot.proposals, (i) => picks[i]) });
      expect(r.ok).toBe(true);
    }
    // (2) the same votes through the classic per-proposal links
    const viaTokens = await session(f, 2);
    for (const p of viaTokens.proposals) await openVoting(f.president, p.id);
    for (const [i, p] of viaTokens.proposals.entries()) {
      const msgs = await prisma.notificationMessage.findMany({ where: { relatedType: "Proposal", relatedId: p.id, template: "approval-link" } });
      for (const m of msgs) {
        const s = extractApprovalSecrets(m.body);
        const r = await submitVote({ tokenPlain: s.token!, verificationCode: s.code!, choice: plan[m.toAddress][i] });
        expect(r.ok).toBe(true);
      }
    }
    for (let i = 0; i < 2; i++) {
      const rb = serializeResult(await computeProposalResult(f.zev.id, viaBallot.proposals[i].id));
      const rt = serializeResult(await computeProposalResult(f.zev.id, viaTokens.proposals[i].id));
      expect(rb).toEqual(rt);
    }
  });
});

describe("reissueBallot / revokeBallot", () => {
  it("reissue: the old link stops working, the new one works with a new code, unused tokens move over", async () => {
    const f = await createFixture("bal-reissue");
    const { meeting, proposals } = await session(f, 2);
    const links = await openSession(f, meeting.id);
    const old = linkFor(links, f.ownerA.email!);
    await expect(reissueBallot(f.president, old.ballotId, "  ")).rejects.toThrow(/razlog/);
    await expect(reissueBallot(f.accountant, old.ballotId, "izgubljen")).rejects.toThrow(ForbiddenError);

    const r = await reissueBallot(f.president, old.ballotId, "Vlasnik je izgubio poruku");
    expect(r).toMatchObject({ emailed: true, sent: true });
    expect(await inspectBallot(old.token)).toMatchObject({ ok: false, error: "revoked" });
    expect(await submitBallot({ tokenPlain: old.token, verificationCode: old.code, ack: true, choices: choicesFor(proposals, () => "APPROVE") })).toMatchObject({ ok: false, error: "revoked" });

    const fresh = (await ballotLinks(meeting.id)).filter((l) => l.ballotId === r.newBallotId)[0];
    expect(fresh.toAddress).toBe(f.ownerA.email);
    expect(fresh.token).not.toBe(old.token);
    expect(fresh.code).not.toBe(undefined);
    const moved = await prisma.approvalToken.count({ where: { ballotId: r.newBallotId } });
    expect(moved).toBe(2);
    expect(await prisma.ballot.findUniqueOrThrow({ where: { id: old.ballotId } })).toMatchObject({ status: "SUPERSEDED", replacedById: r.newBallotId });
    expect(await prisma.auditEvent.count({ where: { action: "ballot.reissue", targetId: r.newBallotId } })).toBe(1);
    const ok = await submitBallot({ tokenPlain: fresh.token!, verificationCode: fresh.code!, ack: true, choices: choicesFor(proposals, () => "APPROVE") });
    expect(ok.ok).toBe(true);
    // a used ballot can be neither reissued nor revoked
    await expect(reissueBallot(f.president, r.newBallotId, "još jednom")).rejects.toThrow(ForbiddenError);
    await expect(revokeBallot(f.president, r.newBallotId, "ne")).rejects.toThrow(ForbiddenError);
  });

  it("revoke: the link stops working; a revoked ballot can still be reissued", async () => {
    const f = await createFixture("bal-revoke");
    const { meeting, proposals } = await session(f, 2);
    const links = await openSession(f, meeting.id);
    const b = linkFor(links, f.ownerB.email!);
    await expect(revokeBallot(f.president, b.ballotId, "")).rejects.toThrow(/razlog/);
    await revokeBallot(f.president, b.ballotId, "Vlasnik je preminuo");
    expect(await inspectBallot(b.token)).toMatchObject({ ok: false, error: "revoked" });
    expect(await prisma.auditEvent.count({ where: { action: "ballot.revoke", targetId: b.ballotId } })).toBe(1);
    const r = await reissueBallot(f.president, b.ballotId, "Ipak može glasati");
    const fresh = (await ballotLinks(meeting.id)).find((l) => l.ballotId === r.newBallotId)!;
    expect((await submitBallot({ tokenPlain: fresh.token!, verificationCode: fresh.code!, ack: true, choices: choicesFor(proposals, () => "REJECT") })).ok).toBe(true);
  });

  it("is tenant-scoped", async () => {
    const f = await createFixture("bal-tenant-a");
    const other = await createFixture("bal-tenant-b");
    const { meeting } = await session(f, 1);
    const a = linkFor(await openSession(f, meeting.id), f.ownerA.email!);
    await expect(reissueBallot(other.president, a.ballotId, "tuđe")).rejects.toThrow();
    await expect(revokeBallot(other.president, a.ballotId, "tuđe")).rejects.toThrow();
    await expect(getMeetingBallotSummary(other.president, meeting.id)).rejects.toThrow();
  });
});

describe("shared daily e-mail limit", () => {
  /** Count "sent today" only inside this fixture's ZEV, so parallel test files cannot change the arithmetic. */
  function scopeDailyCountToZev(zevId: string) {
    const real = prisma.notificationMessage.count.bind(prisma.notificationMessage);
    vi.spyOn(prisma.notificationMessage, "count").mockImplementation(((args?: { where?: { sentAt?: unknown } }) =>
      real(args?.where?.sentAt ? { where: { ...(args.where as object), zevId } } : (args as never))) as never);
  }

  it("with a limit of 3 and 5 queued ballots/invitations: 3 go out, 2 stay queued, the next day sends the rest; invoices share the limit", async () => {
    const f = await createFixture("bal-limit");
    const { meeting } = await session(f, 2);
    scopeDailyCountToZev(f.zev.id);

    await advanceMeetingStatus(f.president, meeting.id, "VOTING_OPEN", undefined, { openDraftProposals: true }); // issues 3 ballots, queues them
    expect((await prisma.notificationMessage.findMany({ where: { template: "ballot-link", zevId: f.zev.id } })).every((m) => m.status === "QUEUED")).toBe(true);
    await queueMeetingInvitations(f.president, meeting.id); // 3 invitations, sent right away (no limit in the mock environment)

    // 6 messages of this session exist; pretend the invitations were never sent and set a limit of 3 today
    await prisma.notificationMessage.updateMany({ where: { zevId: f.zev.id, template: "meeting-invitation" }, data: { status: "QUEUED", sentAt: null } });
    const first = await dispatchMeetingEmails(f.president, meeting.id, { dailyLimit: 3 });
    expect(first).toMatchObject({ attempted: 3, sent: 3, pending: 3, dailyLimitReached: true });
    const summary = await getMeetingBallotSummary(f.president, meeting.id);
    expect(summary.sent + summary.queued + summary.failed).toBe(3);
    expect(summary.total).toBe(3);

    // limit spent: nothing more today
    expect(await dispatchMeetingEmails(f.president, meeting.id, { dailyLimit: 3 })).toMatchObject({ attempted: 0, sent: 0, dailyLimitReached: true });

    // "the next day": what was sent yesterday no longer counts
    const SENT = ["SENT", "DELIVERED", "SEEN"] as const;
    const yesterday = new Date(Date.now() - 25 * 3600 * 1000);
    await prisma.notificationMessage.updateMany({ where: { zevId: f.zev.id, status: { in: [...SENT] } }, data: { sentAt: yesterday } });
    const next = await dispatchMeetingEmails(f.president, meeting.id, { dailyLimit: 3 });
    expect(next).toMatchObject({ sent: 3, pending: 0, dailyLimitReached: false });

    // an invoice e-mail sent today uses up the very same limit
    await prisma.notificationMessage.updateMany({ where: { zevId: f.zev.id, status: { in: [...SENT] } }, data: { sentAt: yesterday } });
    const ballotMsg = await prisma.notificationMessage.findFirstOrThrow({ where: { zevId: f.zev.id, template: "ballot-link" } });
    await prisma.notificationMessage.update({ where: { id: ballotMsg.id }, data: { status: "QUEUED", sentAt: null } });
    const inv = await enqueueNotification({ zevId: f.zev.id, channel: "EMAIL", toAddress: "x@example.com", template: "invoice-delivery", subject: "S", body: "B", relatedType: "Invoice", relatedId: "none" });
    await prisma.notificationMessage.update({ where: { id: inv.id }, data: { status: "SENT", sentAt: new Date() } });
    expect(await dispatchMeetingEmails(f.president, meeting.id, { dailyLimit: 1 })).toMatchObject({ attempted: 0, dailyLimitReached: true });
    expect(await dispatchMeetingEmails(f.president, meeting.id, { dailyLimit: 2 })).toMatchObject({ attempted: 1, sent: 1 });
  });

  it("'Pošalji neposlate' returns failed messages to the queue first", async () => {
    const f = await createFixture("bal-retry");
    const { meeting } = await session(f, 1);
    await openSession(f, meeting.id);
    await dispatchMeetingEmails(f.president, meeting.id);
    const one = await prisma.notificationMessage.findFirstOrThrow({ where: { zevId: f.zev.id, template: "ballot-link" } });
    await prisma.notificationMessage.update({ where: { id: one.id }, data: { status: "FAILED", lastError: "test", attempts: 1 } });
    const r = await dispatchMeetingEmails(f.president, meeting.id, { retryFailed: true });
    expect(r).toMatchObject({ retried: 1, sent: 1, failed: 0 });
    expect(await prisma.auditEvent.count({ where: { action: "ballot.dispatch", targetId: meeting.id } })).toBeGreaterThan(0);
  });

  it("is PRESIDENT/ACCOUNTANT-only", async () => {
    const f = await createFixture("bal-dispatch-guard");
    const { meeting } = await session(f, 1);
    await expect(dispatchMeetingEmails(f.actorA, meeting.id)).rejects.toThrow(ForbiddenError);
    await expect(getMeetingBallotSummary(f.actorA, meeting.id)).rejects.toThrow(ForbiddenError);
  });
});

describe("proposal page data", () => {
  it("tokens under a ballot are marked, so the page can say 'Preko listića'", async () => {
    const f = await createFixture("bal-page");
    const { meeting, proposals } = await session(f, 1);
    await openSession(f, meeting.id);
    const p = await getProposal(f.president, proposals[0].id);
    expect(p.eligibleVoters.flatMap((ev) => ev.tokens).every((tk) => tk.ballotId !== null)).toBe(true);
  });
});

describe("F4: attemptsLeft, president name, body and units on the ballot page data", () => {
  it("bad_code reports 4, 3, 2, 1, 0 attempts left and the fifth miss still revokes the ballot", async () => {
    const f = await createFixture("bal-left");
    const { meeting, proposals } = await session(f, 1);
    const a = linkFor(await openSession(f, meeting.id), f.ownerA.email!);
    const wrong = a.code === "000000" ? "111111" : "000000";
    const choices = choicesFor(proposals, () => "APPROVE");
    const left: (number | undefined)[] = [];
    for (let i = 0; i < 5; i++) {
      const res = await submitBallot({ tokenPlain: a.token, verificationCode: wrong, ack: true, choices, ipHash: `ip-left-${a.ballotId}-${i}` });
      expect(res).toMatchObject({ ok: false, error: "bad_code" });
      left.push("attemptsLeft" in res ? res.attemptsLeft : undefined);
    }
    expect(left).toEqual([4, 3, 2, 1, 0]);
    expect((await prisma.ballot.findUniqueOrThrow({ where: { id: a.ballotId } })).status).toBe("REVOKED");
  });

  it("inspectBallot returns the body, the units the recipient votes for, attachment mime and the president's name; errors carry the name too", async () => {
    const f = await createFixture("bal-inspect");
    await prisma.party.update({ where: { id: f.presidentParty.id }, data: { firstName: "Petar", lastName: "Predsjednik" } });
    await setOfficeTerm(f.president, { role: "PRESIDENT", partyId: f.presidentParty.id, validFrom: new Date("2020-01-01") });
    const { meeting, proposals } = await session(f, 1);
    const att = await prisma.attachment.create({ data: { zevId: f.zev.id, filename: "ponuda.pdf", mime: "application/pdf", size: 10, category: "OTHER", sha256: "abc" } });
    await prisma.proposal.update({ where: { id: proposals[0].id }, data: { attachments: { connect: { id: att.id } } } });
    const links = await openSession(f, meeting.id);
    const a = linkFor(links, f.ownerA.email!);
    const info = await inspectBallot(a.token);
    expect(info.ok).toBe(true);
    if (!info.ok) return;
    expect(info.body).toBe("ASSEMBLY");
    expect(info.units.sort()).toEqual([f.u1.label, f.u4.label].sort());
    expect(info.proposals[0].attachments[0]).toMatchObject({ id: att.id, mime: "application/pdf" });
    expect(info.presidentName).toContain("Predsjednik");

    await revokeBallot(f.president, a.ballotId, "test");
    const revoked = await inspectBallot(a.token);
    expect(revoked).toMatchObject({ ok: false, error: "revoked" });
    if (!revoked.ok) expect(revoked.presidentName).toContain("Predsjednik");
    const unknown = await inspectBallot("no-such-token");
    expect(unknown).toMatchObject({ ok: false, error: "not_found", presidentName: null });
  });
});
