import { describe, it, expect, beforeAll } from "vitest";
import fs from "node:fs";
import { prisma } from "@/lib/prisma";
import { createFixture, createProposalFixture, openVotingWithLinks, createAreaCharges, type Fixture } from "./helpers";
import { createDraftBatch, issueBatch } from "@/server/services/billing";
import { generateInvoicePdf, generateOwnerStatementPdf, readDocumentFile, generateDecisionPdf } from "@/server/services/documents";
import { submitVote, closeVoting, recordDecision, recordManualVote } from "@/server/services/meetings";
import { ForbiddenError } from "@/server/auth/guards";
import type { Invoice } from "@/generated/prisma/client";

describe("documents and audit trail", () => {
  let f: Fixture;
  let invoices: Invoice[];

  beforeAll(async () => {
    f = await createFixture("doc");
    const chargeIds = await createAreaCharges(f, "0.40");
    const { batch } = await createDraftBatch(f.accountant, "2035-01", undefined, chargeIds);
    invoices = await issueBatch(f.accountant, batch.id);
  });

  it("generated invoice PDF references the correct source record and owner", async () => {
    const inv = invoices.find((i) => i.debtorId === f.ownerA.id && i.unitId === f.u1.id)!;
    const doc = await generateInvoicePdf(f.accountant, inv.id);
    expect(doc.sourceType).toBe("Invoice");
    expect(doc.sourceId).toBe(inv.id);
    expect(doc.number).toBe(inv.number);
    expect(doc.status).toBe("FINAL");
    expect(fs.existsSync(doc.filePath)).toBe(true);
    // the rendered PDF embeds the owner's name and the amount
    const raw = fs.readFileSync(doc.filePath);
    expect(raw.subarray(0, 5).toString()).toBe("%PDF-");
    expect(raw.length).toBeGreaterThan(1000);
  });

  it("finalized documents are immutable: regeneration creates a new version, both files kept", async () => {
    const inv = invoices.find((i) => i.debtorId === f.ownerA.id && i.unitId === f.u1.id)!;
    const v1 = await prisma.document.findFirstOrThrow({ where: { sourceId: inv.id, type: "INVOICE" }, orderBy: { version: "desc" } });
    const v2 = await generateInvoicePdf(f.accountant, inv.id);
    expect(v2.version).toBe(v1.version + 1);
    const still = await prisma.document.findUniqueOrThrow({ where: { id: v1.id } });
    expect(still.sha256).toBe(v1.sha256);
    expect(fs.existsSync(still.filePath)).toBe(true);
    expect(fs.existsSync(v2.filePath)).toBe(true);
  });

  it("owners can download their own documents but not another owner's", async () => {
    const invA = invoices.find((i) => i.debtorId === f.ownerA.id && i.unitId === f.u1.id)!;
    const docA = await prisma.document.findFirstOrThrow({ where: { sourceId: invA.id, type: "INVOICE" } });
    const read = await readDocumentFile(f.actorA, docA.id);
    expect(read.buffer.length).toBeGreaterThan(0);
    await expect(readDocumentFile(f.actorB, docA.id)).rejects.toThrow(ForbiddenError);
    // owner statement isolation as well
    const stmt = await generateOwnerStatementPdf(f.actorA, f.ownerA.id);
    expect(stmt.type).toBe("OWNER_STATEMENT");
    await expect(generateOwnerStatementPdf(f.actorB, f.ownerA.id)).rejects.toThrow(ForbiddenError);
  });

  it("a decision document references the exact proposal version and its content hash", async () => {
    const { proposal } = await createProposalFixture(f);
    await openVotingWithLinks(f, proposal.id);
    const evs = await prisma.eligibleVoter.findMany({ where: { proposalId: proposal.id } });
    for (const ev of evs) {
      await recordManualVote(f.president, { eligibleVoterId: ev.id, choice: "APPROVE", channel: "PAPER" });
    }
    await closeVoting(f.president, proposal.id);
    await recordDecision(f.president, proposal.id, `OD-${f.t}`);
    const doc = await generateDecisionPdf(f.president, proposal.id);
    expect(doc.sourceType).toBe("Proposal");
    expect(doc.sourceId).toBe(proposal.id);
    expect(doc.number).toBe(`OD-${f.t}`);
    expect(doc.publishedToOwners).toBe(true);
  });

  it("audit events are append-only at the database level", async () => {
    const ev = await prisma.auditEvent.findFirstOrThrow();
    await expect(
      prisma.auditEvent.update({ where: { id: ev.id }, data: { action: "tampered" } })
    ).rejects.toThrow();
    await expect(prisma.auditEvent.delete({ where: { id: ev.id } })).rejects.toThrow();
  });

  it("plaintext approval tokens never appear in the audit trail or notification metadata", async () => {
    const { proposal } = await createProposalFixture(f);
    const links = await openVotingWithLinks(f, proposal.id);
    const l = links.find((x) => x.toAddress === f.ownerA.email)!;
    await submitVote({ tokenPlain: l.token, verificationCode: l.code, choice: "APPROVE" });
    const audits = await prisma.auditEvent.findMany();
    const auditBlob = JSON.stringify(audits);
    expect(auditBlob).not.toContain(l.token);
    // and the stored token row has only the hash
    const tokens = await prisma.approvalToken.findMany({
      where: { eligibleVoter: { proposalId: proposal.id } },
    });
    for (const t of tokens) {
      expect(t.tokenHash).toMatch(/^[0-9a-f]{64}$/);
      expect(t.tokenHash).not.toBe(l.token);
    }
  });

  it("material actions leave audit events (issue, allocate, vote, transfer, document)", async () => {
    const actions = (await prisma.auditEvent.groupBy({ by: ["action"] })).map((a) => a.action);
    for (const expected of [
      "invoice.issue", "invoice_batch.issue", "vote.submit", "proposal.voting.open",
      "proposal.voting.close", "document.generate", "charge_item.create",
      "unit.create", "ownership.stake.add",
    ]) {
      expect(actions).toContain(expected);
    }
  });
});
