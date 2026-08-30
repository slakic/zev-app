import { describe, it, expect, beforeAll } from "vitest";
import { prisma } from "@/lib/prisma";
import { createFixture, createAreaCharges, type Fixture } from "./helpers";
import { createDraftBatch, issueBatch } from "@/server/services/billing";
import {
  enterPayment, allocatePayment, reverseAllocation, reversePayment,
  ownerBalance, ownerAdvance, importBankCsv, suggestMatches, addBalanceCorrection,
} from "@/server/services/payments";
import { transferOwnership } from "@/server/services/ownership";
import type { Invoice } from "@/generated/prisma/client";

describe("payments and owner balances", () => {
  let f: Fixture;
  let invoices: Invoice[];
  let chargeIds: string[];
  const period = "2032-01";

  const invOf = (unitId: string) => invoices.find((i) => i.unitId === unitId)!;

  beforeAll(async () => {
    f = await createFixture("pay");
    chargeIds = await createAreaCharges(f, "1.00");
    const { batch } = await createDraftBatch(f.accountant, period, undefined, chargeIds);
    invoices = await issueBatch(f.accountant, batch.id);
    // u1(A)=50, u2(B)=70, u3(B 50%? debtor is main stake — B or C)=60, u4(A)=20
  });

  it("full payment settles an invoice", async () => {
    const inv = invOf(f.u1.id); // 50.00, debtor A
    const p = await enterPayment(f.accountant, {
      accountId: f.account.id, date: new Date(), amount: "50.00", payerId: f.ownerA.id,
    });
    await allocatePayment(f.accountant, { paymentId: p.id, invoiceId: inv.id, amount: "50.00" });
    const after = await prisma.invoice.findUniqueOrThrow({ where: { id: inv.id } });
    expect(after.status).toBe("PAID");
    const pay = await prisma.payment.findUniqueOrThrow({ where: { id: p.id } });
    expect(pay.status).toBe("APPLIED");
  });

  it("partial payment leaves the invoice open and tracks the paid amount", async () => {
    const inv = invOf(f.u2.id); // 70.00, debtor B
    const p = await enterPayment(f.accountant, {
      accountId: f.account.id, date: new Date(), amount: "30.00", payerId: f.ownerB.id,
    });
    await allocatePayment(f.accountant, { paymentId: p.id, invoiceId: inv.id, amount: "30.00" });
    const after = await prisma.invoice.findUniqueOrThrow({ where: { id: inv.id }, include: { allocations: true } });
    expect(after.status).toBe("ISSUED");
    expect(after.allocations.reduce((a, x) => a + Number(x.amount), 0)).toBe(30);
  });

  it("several payments settle one invoice", async () => {
    const inv = invOf(f.u2.id); // 40 open after previous test
    const p2 = await enterPayment(f.accountant, {
      accountId: f.account.id, date: new Date(), amount: "40.00", payerId: f.ownerB.id,
    });
    await allocatePayment(f.accountant, { paymentId: p2.id, invoiceId: inv.id, amount: "40.00" });
    const after = await prisma.invoice.findUniqueOrThrow({ where: { id: inv.id } });
    expect(after.status).toBe("PAID");
  });

  it("overpayment cannot be forced onto the invoice; the surplus stays as an unapplied advance", async () => {
    const inv = invOf(f.u4.id); // 20.00, debtor A
    const p = await enterPayment(f.accountant, {
      accountId: f.account.id, date: new Date(), amount: "35.00", payerId: f.ownerA.id,
    });
    await expect(
      allocatePayment(f.accountant, { paymentId: p.id, invoiceId: inv.id, amount: "35.00" })
    ).rejects.toThrow(/otvoreno/);
    await allocatePayment(f.accountant, { paymentId: p.id, invoiceId: inv.id, amount: "20.00" });
    const pay = await prisma.payment.findUniqueOrThrow({ where: { id: p.id } });
    expect(pay.status).toBe("PARTIALLY_APPLIED");
    const advance = await ownerAdvance(f.accountant, f.ownerA.id);
    expect(Number(advance)).toBeGreaterThanOrEqual(15);
  });

  it("one payment can cover several invoices", async () => {
    // new period so A has two open invoices (u1 was transferred in another suite? no — separate fixture)
    const { batch } = await createDraftBatch(f.accountant, "2032-02", undefined, chargeIds);
    const inv2 = await issueBatch(f.accountant, batch.id);
    const a1 = inv2.find((i) => i.unitId === f.u1.id)!; // 50
    const a2 = inv2.find((i) => i.unitId === f.u4.id)!; // 20
    const p = await enterPayment(f.accountant, {
      accountId: f.account.id, date: new Date(), amount: "70.00", payerId: f.ownerA.id,
    });
    await allocatePayment(f.accountant, { paymentId: p.id, invoiceId: a1.id, amount: "50.00" });
    await allocatePayment(f.accountant, { paymentId: p.id, invoiceId: a2.id, amount: "20.00" });
    const pay = await prisma.payment.findUniqueOrThrow({ where: { id: p.id } });
    expect(pay.status).toBe("APPLIED");
    expect((await prisma.invoice.findUniqueOrThrow({ where: { id: a1.id } })).status).toBe("PAID");
    expect((await prisma.invoice.findUniqueOrThrow({ where: { id: a2.id } })).status).toBe("PAID");
  });

  it("allocation reversal is an append-only negative row and reopens the invoice", async () => {
    const inv = invOf(f.u1.id);
    const alloc = await prisma.paymentAllocation.findFirstOrThrow({
      where: { invoiceId: inv.id, amount: { gt: 0 } },
    });
    await reverseAllocation(f.accountant, alloc.id, "pogrešno uparivanje");
    const allocs = await prisma.paymentAllocation.findMany({ where: { invoiceId: inv.id } });
    expect(allocs.some((a) => Number(a.amount) < 0)).toBe(true);
    // original row untouched (DB trigger forbids update anyway)
    const orig = await prisma.paymentAllocation.findUniqueOrThrow({ where: { id: alloc.id } });
    expect(Number(orig.amount)).toBeGreaterThan(0);
    const invAfter = await prisma.invoice.findUniqueOrThrow({ where: { id: inv.id } });
    expect(invAfter.status).toBe("ISSUED");
    // re-allocate for later tests
    await allocatePayment(f.accountant, { paymentId: alloc.paymentId, invoiceId: inv.id, amount: orig.amount.toString() });
  });

  it("payment reversal reverses its allocations and cancels its cash transaction", async () => {
    const inv = invOf(f.u3.id);
    const p = await enterPayment(f.accountant, {
      accountId: f.account.id, date: new Date(), amount: "60.00", payerId: inv.debtorId,
    });
    await allocatePayment(f.accountant, { paymentId: p.id, invoiceId: inv.id, amount: "60.00" });
    await reversePayment(f.accountant, p.id, "povrat banke");
    const pay = await prisma.payment.findUniqueOrThrow({ where: { id: p.id }, include: { transaction: true } });
    expect(pay.status).toBe("REVERSED");
    expect(pay.transaction?.status).toBe("CANCELLED");
    const invAfter = await prisma.invoice.findUniqueOrThrow({ where: { id: inv.id }, include: { allocations: true } });
    const net = invAfter.allocations.reduce((a, x) => a + Number(x.amount), 0);
    expect(net).toBe(0);
    expect(invAfter.status).toBe("ISSUED");
  });

  it("balance formula: opening + charges − allocated payments ± corrections", async () => {
    const before = await ownerBalance(f.accountant, f.ownerB.id);
    await addBalanceCorrection(f.accountant, {
      partyId: f.ownerB.id, amount: "-5.00", reason: "odobrenje po reklamaciji", authority: "odluka predsjednika 3/26",
    });
    const after = await ownerBalance(f.accountant, f.ownerB.id);
    expect(Number(after.balance)).toBeCloseTo(Number(before.balance) - 5, 2);
    expect(Number(after.charged) - Number(after.paid) + Number(after.corrections)).toBeCloseTo(Number(after.balance), 2);
  });

  it("historical balance as of a date excludes later documents", async () => {
    const asOfPast = await ownerBalance(f.accountant, f.ownerB.id, new Date("2000-01-01"));
    expect(asOfPast.balance).toBe("0.00");
  });

  it("CSV import with configurable mapping creates payments and suggests matches", async () => {
    const { batch } = await createDraftBatch(f.accountant, "2032-03", undefined, chargeIds);
    const inv3 = await issueBatch(f.accountant, batch.id);
    const target = inv3.find((i) => i.debtorId === f.ownerB.id && i.unitId === f.u2.id)!;
    const csv = [
      "Datum;Iznos;Platilac;Poziv",
      `15.03.2032.;70,00;"B-${f.t} BORIS";${target.paymentReference}`,
      "16.03.2032.;-55,00;ODLIV;X", // outgoing row must be skipped
    ].join("\n");
    const res = await importBankCsv(f.accountant, {
      accountId: f.account.id, filename: "izvod-test.csv", content: csv,
    });
    expect(res.imported).toBe(1);
    const imported = await prisma.payment.findFirstOrThrow({ where: { importBatchId: res.batchId } });
    expect(imported.amount.toString()).toBe("70");
    const matches = await suggestMatches(f.accountant, imported.id);
    expect(matches[0].invoiceId).toBe(target.id);
    expect(matches[0].reasons).toContain("poziv na broj");
  });

  it("ownership change preserves historical liability with the old owner", async () => {
    const balBefore = await ownerBalance(f.accountant, f.ownerC.id);
    await transferOwnership(f.president, {
      unitId: f.u2.id, fromOwnerId: f.ownerB.id, toOwnerId: f.ownerC.id,
      effectiveDate: new Date(), note: "kupoprodaja",
    });
    // C inherits NO old debt
    const balC = await ownerBalance(f.accountant, f.ownerC.id);
    expect(balC.charged).toBe(balBefore.charged);
    // B keeps the historical open invoice from 2032-03
    const balB = await ownerBalance(f.accountant, f.ownerB.id);
    expect(Number(balB.balance)).toBeGreaterThan(0);
  });
});
