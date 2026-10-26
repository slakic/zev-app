// F4.4 — prilozi prijedloga preko glasačkog linka (`readVotingAttachment`, token je guard) i vlasniku u aplikaciji
// (`readAttachmentFile`: prijedlog koji nije nacrt).
import { describe, it, expect } from "vitest";
import { prisma } from "@/lib/prisma";
import {
  createFixture, createProposalFixture, openVotingWithLinks, createSessionFixture, openSessionBallots, ballotFor, attachToProposal,
} from "./helpers";
import { readVotingAttachment, revokeBallot, submitBallot, submitVote, revokeToken } from "@/server/services/meetings";
import { readAttachmentFile } from "@/server/services/attachments";
import { ForbiddenError } from "@/server/auth/guards";

const notFound = { ok: false, error: "not_found" };

describe("readVotingAttachment — session ballot", () => {
  it("reads the attachment of a proposal on the ballot (same bytes) and audits the download with the ZEV", async () => {
    const f = await createFixture("vatt-ok");
    const { meeting, proposals } = await createSessionFixture(f, 2);
    const att = await attachToProposal(f, proposals[0].id, "SADRZAJ PONUDE");
    const a = ballotFor(await openSessionBallots(f, meeting.id), f.ownerA.email!);
    const res = await readVotingAttachment({ tokenPlain: a.token, attachmentId: att.id });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.buffer.toString()).toBe("SADRZAJ PONUDE");
    expect(res.attachment).toEqual({ filename: "ponuda.pdf", mime: "application/pdf" });
    const ev = await prisma.auditEvent.findFirstOrThrow({ where: { action: "voting.attachment.download", targetId: att.id } });
    expect(ev.zevId).toBe(f.zev.id);
    expect(JSON.stringify(ev)).not.toContain(a.token);
  });

  it("a proposal that is not on this ballot, and another ZEV's attachment, are not_found", async () => {
    const f = await createFixture("vatt-scope");
    const other = await createFixture("vatt-other");
    const { meeting, proposals } = await createSessionFixture(f, 2, ["ALL", "A"]); // proposal 2 covers only A's unit u1
    const onlyA = await attachToProposal(f, proposals[1].id, "SAMO A");
    const foreign = await attachToProposal(other, (await createProposalFixture(other)).proposal.id, "TUDJI");
    const links = await openSessionBallots(f, meeting.id);
    const a = ballotFor(links, f.ownerA.email!);
    const b = ballotFor(links, f.ownerB.email!);
    expect((await readVotingAttachment({ tokenPlain: a.token, attachmentId: onlyA.id })).ok).toBe(true);
    expect(await readVotingAttachment({ tokenPlain: b.token, attachmentId: onlyA.id })).toMatchObject(notFound);
    expect(await readVotingAttachment({ tokenPlain: a.token, attachmentId: foreign.id })).toMatchObject(notFound);
    expect(await readVotingAttachment({ tokenPlain: "no-such-token", attachmentId: onlyA.id })).toMatchObject(notFound);
  });

  it("a revoked, superseded or expired ballot opens nothing; a spent one still does", async () => {
    const f = await createFixture("vatt-state");
    const { meeting, proposals } = await createSessionFixture(f, 1);
    const att = await attachToProposal(f, proposals[0].id, "X");
    const links = await openSessionBallots(f, meeting.id);
    const a = ballotFor(links, f.ownerA.email!);
    const b = ballotFor(links, f.ownerB.email!);
    const c = ballotFor(links, f.ownerC.email!);
    const read = (token: string) => readVotingAttachment({ tokenPlain: token, attachmentId: att.id });

    await revokeBallot(f.president, a.ballotId, "test");
    expect(await read(a.token)).toMatchObject(notFound);
    await prisma.ballot.update({ where: { id: b.ballotId }, data: { status: "SUPERSEDED" } });
    expect(await read(b.token)).toMatchObject(notFound);
    await prisma.ballot.update({ where: { id: c.ballotId }, data: { expiresAt: new Date(Date.now() - 1000) } });
    expect(await read(c.token)).toMatchObject(notFound);

    // a spent ballot (separate voter, fresh session) can still be read
    const f2 = await createFixture("vatt-used");
    const s2 = await createSessionFixture(f2, 1);
    const att2 = await attachToProposal(f2, s2.proposals[0].id, "Y");
    const a2 = ballotFor(await openSessionBallots(f2, s2.meeting.id), f2.ownerA.email!);
    const sent = await submitBallot({ tokenPlain: a2.token, verificationCode: a2.code, ack: true, choices: { [s2.proposals[0].id]: "APPROVE" } });
    expect(sent.ok).toBe(true);
    expect((await readVotingAttachment({ tokenPlain: a2.token, attachmentId: att2.id })).ok).toBe(true);
  });
});

describe("readVotingAttachment — single-proposal link", () => {
  it("works for its own proposal while active and after use; not for a revoked token", async () => {
    const f = await createFixture("vatt-single");
    const { proposal } = await createProposalFixture(f);
    const att = await attachToProposal(f, proposal.id, "KLASICNI");
    const links = await openVotingWithLinks(f, proposal.id);
    const a = links.find((l) => l.toAddress === f.ownerA.email)!;
    const b = links.find((l) => l.toAddress === f.ownerB.email)!;
    const read = (token: string) => readVotingAttachment({ tokenPlain: token, attachmentId: att.id });

    const ok = await read(a.token);
    expect(ok.ok && ok.buffer.toString()).toBe("KLASICNI");
    expect((await submitVote({ tokenPlain: a.token, verificationCode: a.code, choice: "APPROVE" })).ok).toBe(true);
    expect((await read(a.token)).ok).toBe(true); // used

    const tokenB = await prisma.approvalToken.findFirstOrThrow({ where: { eligibleVoter: { proposalId: proposal.id, ownerId: f.ownerB.id, memberPartyIds: { equals: [f.ownerB.id] } } } });
    await revokeToken(f.president, tokenB.id, "test");
    expect(await read(b.token)).toMatchObject(notFound);

  });
});

describe("readAttachmentFile — owner, proposal attachments", () => {
  it("an owner reads the attachment of a proposal out of DRAFT, but not of a draft; ownership proof rules are unchanged", async () => {
    const f = await createFixture("vatt-owner");
    const { meeting, proposals } = await createSessionFixture(f, 1);
    const att = await attachToProposal(f, proposals[0].id, "ZA VLASNIKE");
    await expect(readAttachmentFile(f.actorB, att.id)).rejects.toThrow(ForbiddenError); // still a draft
    await openSessionBallots(f, meeting.id);
    const { buffer } = await readAttachmentFile(f.actorB, att.id);
    expect(buffer.toString()).toBe("ZA VLASNIKE");
    expect(await prisma.auditEvent.count({ where: { action: "attachment.download", targetId: att.id } })).toBe(1);

    // an attachment that belongs to no proposal stays closed to an owner
    const loose = await prisma.attachment.create({ data: { zevId: f.zev.id, filename: "x.pdf", mime: "application/pdf", size: 1, category: "OTHER" } });
    await prisma.attachmentBlob.create({ data: { attachmentId: loose.id, data: new Uint8Array([1]) } });
    await expect(readAttachmentFile(f.actorB, loose.id)).rejects.toThrow(ForbiddenError);
  });

  it("another ZEV's owner cannot read it", async () => {
    const f = await createFixture("vatt-owner-a");
    const g = await createFixture("vatt-owner-b");
    const { meeting, proposals } = await createSessionFixture(f, 1);
    const att = await attachToProposal(f, proposals[0].id, "TAJNA");
    await openSessionBallots(f, meeting.id);
    await expect(readAttachmentFile(g.actorB, att.id)).rejects.toThrow();
  });
});
