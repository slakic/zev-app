// F4.3 — potvrda koja se može ponovo otvoriti (V-Q3): `getVoteReceipt` po tajnom tokenu + id potvrde.
// Izbor se čita sa servera iz Vote; nikad ne ide u URL i nikad u audit.
import { describe, it, expect } from "vitest";
import { prisma } from "@/lib/prisma";
import { createFixture, createProposalFixture, openVotingWithLinks, createSessionFixture, openSessionBallots, ballotFor } from "./helpers";
import {
  getVoteReceipt, submitBallot, submitVote, recordManualVote, correctVote,
} from "@/server/services/meetings";

const choicesFor = (proposals: { id: string }[], pick: (i: number) => "APPROVE" | "REJECT" | "ABSTAIN") =>
  Object.fromEntries(proposals.map((p, i) => [p.id, pick(i)]));

describe("getVoteReceipt — session ballot", () => {
  it("returns the items with choices, vote ids, the ballot's time and recipient, and the skipped (paper) proposal", async () => {
    const f = await createFixture("rcpt-ballot");
    const { meeting, proposals } = await createSessionFixture(f, 3);
    const links = await openSessionBallots(f, meeting.id);
    const a = ballotFor(links, f.ownerA.email!);
    // a paper vote for A on the third proposal settles it: the ballot skips it
    const ev = await prisma.eligibleVoter.findFirstOrThrow({ where: { proposalId: proposals[2].id, ownerId: f.ownerA.id } });
    await recordManualVote(f.president, { eligibleVoterId: ev.id, choice: "REJECT", channel: "PAPER" });
    const res = await submitBallot({
      tokenPlain: a.token, verificationCode: a.code, ack: true,
      choices: { [proposals[0].id]: "APPROVE", [proposals[1].id]: "ABSTAIN" },
    });
    expect(res.ok).toBe(true);

    const r = await getVoteReceipt({ tokenPlain: a.token, receiptId: a.ballotId });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const ballot = await prisma.ballot.findUniqueOrThrow({ where: { id: a.ballotId } });
    expect(r.receipt.submittedAt.getTime()).toBe(ballot.usedAt!.getTime());
    expect(r.receipt.voterName).toContain("Ana");
    expect(r.receipt.meetingTitle).toBe(meeting.title);
    expect(r.receipt.items.map((i) => [i.code, i.choice])).toEqual(
      [[proposals[0].code, "APPROVE"], [proposals[1].code, "ABSTAIN"]].sort((x, y) => x[0].localeCompare(y[0])),
    );
    const votes = await prisma.vote.findMany({ where: { voterId: f.ownerA.id, proposalId: { in: [proposals[0].id, proposals[1].id] } } });
    expect(r.receipt.items.map((i) => i.voteId).sort()).toEqual(votes.map((v) => v.id).sort());
    expect(r.receipt.skipped).toEqual([{ code: proposals[2].code, title: proposals[2].title, reason: "voted" }]);
  });

  it("audits vote.receipt.view without any choice, secret or code", async () => {
    const f = await createFixture("rcpt-audit");
    const { meeting, proposals } = await createSessionFixture(f, 2);
    const a = ballotFor(await openSessionBallots(f, meeting.id), f.ownerA.email!);
    await submitBallot({ tokenPlain: a.token, verificationCode: a.code, ack: true, choices: choicesFor(proposals, () => "REJECT") });
    expect((await getVoteReceipt({ tokenPlain: a.token, receiptId: a.ballotId })).ok).toBe(true);
    const ev = await prisma.auditEvent.findFirstOrThrow({ where: { action: "vote.receipt.view", targetId: a.ballotId } });
    expect(ev.zevId).toBe(f.zev.id);
    expect(ev.targetType).toBe("Ballot");
    const dump = JSON.stringify(ev);
    for (const word of ["APPROVE", "REJECT", "ABSTAIN", a.token, a.code]) expect(dump).not.toContain(word);
  });

  it("is not_found for an unspent ballot, a wrong id, another ballot's id, a superseded ballot and an unknown token", async () => {
    const f = await createFixture("rcpt-miss");
    const { meeting, proposals } = await createSessionFixture(f, 2);
    const links = await openSessionBallots(f, meeting.id);
    const a = ballotFor(links, f.ownerA.email!);
    const b = ballotFor(links, f.ownerB.email!);
    const notFound = { ok: false, error: "not_found" };

    // not spent yet: even its own id opens nothing
    expect(await getVoteReceipt({ tokenPlain: a.token, receiptId: a.ballotId })).toMatchObject(notFound);

    await submitBallot({ tokenPlain: a.token, verificationCode: a.code, ack: true, choices: choicesFor(proposals, () => "APPROVE") });
    expect((await getVoteReceipt({ tokenPlain: a.token, receiptId: a.ballotId })).ok).toBe(true);
    expect(await getVoteReceipt({ tokenPlain: a.token, receiptId: "nonsense" })).toMatchObject(notFound);
    expect(await getVoteReceipt({ tokenPlain: a.token, receiptId: b.ballotId })).toMatchObject(notFound);
    expect(await getVoteReceipt({ tokenPlain: "no-such-token", receiptId: a.ballotId })).toMatchObject(notFound);

    // a superseded ballot (no vote on it) shows nothing
    await prisma.ballot.update({ where: { id: b.ballotId }, data: { status: "SUPERSEDED" } });
    expect(await getVoteReceipt({ tokenPlain: b.token, receiptId: b.ballotId })).toMatchObject(notFound);
  });
});

describe("getVoteReceipt — single-proposal link", () => {
  it("returns the one item after submitVote; another vote's id is not_found; a corrected vote still shows what the voter sent", async () => {
    const f = await createFixture("rcpt-single");
    const { proposal } = await createProposalFixture(f);
    const links = await openVotingWithLinks(f, proposal.id);
    const a = links.find((l) => l.toAddress === f.ownerA.email)!;
    const b = links.find((l) => l.toAddress === f.ownerB.email)!;
    const va = await submitVote({ tokenPlain: a.token, verificationCode: a.code, choice: "APPROVE" });
    const vb = await submitVote({ tokenPlain: b.token, verificationCode: b.code, choice: "REJECT" });
    expect(va.ok && vb.ok).toBe(true);
    if (!va.ok || !vb.ok) return;

    const r = await getVoteReceipt({ tokenPlain: a.token, receiptId: va.receipt.voteId });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.receipt.items).toEqual([{ code: proposal.code, title: proposal.title, voteId: va.receipt.voteId, choice: "APPROVE" }]);
    expect(r.receipt.skipped).toEqual([]);
    expect(await getVoteReceipt({ tokenPlain: a.token, receiptId: vb.receipt.voteId })).toMatchObject({ ok: false, error: "not_found" });
    const audit = await prisma.auditEvent.findFirstOrThrow({ where: { action: "vote.receipt.view", targetId: va.receipt.voteId } });
    expect(audit.targetType).toBe("Vote");
    expect(JSON.stringify(audit)).not.toContain("APPROVE");

    // the president corrects the vote: the receipt is the voter's own act, so it still shows what he sent
    await correctVote(f.president, { voteId: va.receipt.voteId, choice: "REJECT", reason: "Greška u evidenciji", authority: "Odluka skupštine" });
    const again = await getVoteReceipt({ tokenPlain: a.token, receiptId: va.receipt.voteId });
    expect(again.ok).toBe(true);
    if (again.ok) expect(again.receipt.items[0].choice).toBe("APPROVE");
  });

  it("an unused single token has no receipt", async () => {
    const f = await createFixture("rcpt-single-unused");
    const { proposal } = await createProposalFixture(f);
    const links = await openVotingWithLinks(f, proposal.id);
    const a = links.find((l) => l.toAddress === f.ownerA.email)!;
    expect(await getVoteReceipt({ tokenPlain: a.token, receiptId: "x" })).toMatchObject({ ok: false, error: "not_found" });
  });
});
