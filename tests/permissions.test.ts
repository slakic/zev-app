import { describe, it, expect, beforeAll } from "vitest";
import { prisma } from "@/lib/prisma";
import { createFixture, createProposalFixture, openVotingWithLinks, createAreaCharges, type Fixture } from "./helpers";
import { ownerBalance } from "@/server/services/payments";
import { getInvoice, createDraftBatch, issueBatch } from "@/server/services/billing";
import { getParty } from "@/server/services/ownership";
import { correctVote, submitVote, recordManualVote } from "@/server/services/meetings";
import { ForbiddenError } from "@/server/auth/guards";

describe("permission isolation (server-side)", () => {
  let f: Fixture;
  let invoiceOfB: string;

  beforeAll(async () => {
    f = await createFixture("perm");
    const chargeIds = await createAreaCharges(f, "0.50");
    const { batch } = await createDraftBatch(f.accountant, "2030-01", undefined, chargeIds);
    const invoices = await issueBatch(f.accountant, batch.id);
    invoiceOfB = invoices.find((i) => i.debtorId === f.ownerB.id)!.id;
  });

  it("owner cannot read another owner's balance", async () => {
    await expect(ownerBalance(f.actorA, f.ownerB.id)).rejects.toThrow(ForbiddenError);
  });

  it("owner can read their own balance", async () => {
    const b = await ownerBalance(f.actorA, f.ownerA.id);
    expect(Number(b.charged)).toBeGreaterThan(0);
  });

  it("owner cannot open another owner's invoice", async () => {
    await expect(getInvoice(f.actorA, invoiceOfB)).rejects.toThrow(ForbiddenError);
  });

  it("management roles can open any invoice", async () => {
    const inv = await getInvoice(f.accountant, invoiceOfB);
    expect(inv.debtorId).toBe(f.ownerB.id);
  });

  it("owner cannot read another owner's personal data", async () => {
    await expect(getParty(f.actorA, f.ownerB.id)).rejects.toThrow(ForbiddenError);
  });

  it("owner cannot access another owner's approval link (token is scoped to one voter)", async () => {
    const { proposal } = await createProposalFixture(f);
    const links = await openVotingWithLinks(f, proposal.id);
    const linkOfB = links.find((l) => l.toAddress === f.ownerB.email)!;
    // A obtains B's link but not B's separately delivered verification code
    const res = await submitVote({ tokenPlain: linkOfB.token, verificationCode: "000000", choice: "APPROVE" });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toBe("bad_code");
  });

  it("accountant cannot correct votes (only president, with reason + authority)", async () => {
    const { proposal } = await createProposalFixture(f);
    await openVotingWithLinks(f, proposal.id);
    const ev = await prisma.eligibleVoter.findFirstOrThrow({ where: { proposalId: proposal.id } });
    const vote = await recordManualVote(f.president, { eligibleVoterId: ev.id, choice: "APPROVE", channel: "PAPER" });
    await expect(
      correctVote(f.accountant, { voteId: vote.id, choice: "REJECT", reason: "x", authority: "y" })
    ).rejects.toThrow(ForbiddenError);
  });

  it("nobody can UPDATE or DELETE a submitted vote — blocked by the database itself", async () => {
    const { proposal } = await createProposalFixture(f);
    await openVotingWithLinks(f, proposal.id);
    const ev = await prisma.eligibleVoter.findFirstOrThrow({ where: { proposalId: proposal.id } });
    const vote = await recordManualVote(f.president, { eligibleVoterId: ev.id, choice: "APPROVE", channel: "PAPER" });
    await expect(
      prisma.vote.update({ where: { id: vote.id }, data: { choice: "REJECT" } })
    ).rejects.toThrow();
    await expect(prisma.vote.delete({ where: { id: vote.id } })).rejects.toThrow();
    const still = await prisma.vote.findUniqueOrThrow({ where: { id: vote.id } });
    expect(still.choice).toBe("APPROVE");
  });

  it("authorization lives in the service layer, not the UI: same call, different actor", async () => {
    // identical invocation succeeds for the entitled actor and fails for the other
    await expect(ownerBalance(f.actorB, f.ownerB.id)).resolves.toBeTruthy();
    await expect(ownerBalance(f.actorA, f.ownerB.id)).rejects.toThrow(ForbiddenError);
  });
});
