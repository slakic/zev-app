// Plans/sms-statement-payment-matching-plan.md — SMS ↔ izvod usklađivanje against the real test
// database: the link kept when a PDF row is skipped as already booked from SMS, detection of
// already-booked duplicates, merging an inflow duplicate (append-only storno + allocation move),
// "nisu iste", manual statement confirmation, outflows (link only), roles and tenant isolation.
import { describe, it, expect } from "vitest";
import { prisma } from "@/lib/prisma";
import { createFixture, uid, type Fixture } from "./helpers";
import { receiveBankSms, issueBankSmsToken, listBankSmsReview, confirmBankSms } from "@/server/services/bankSms";
import { allocatePayment, commitPdfImport, ownerBalance } from "@/server/services/payments";
import {
  getChannelReconciliation,
  mergeChannelDuplicate,
  markChannelNotSame,
  confirmSmsByStatement,
  linkChannelTransaction,
  getPaymentChannelInfo,
} from "@/server/services/paymentMatching";
import { ForbiddenError } from "@/server/auth/guards";

const PRILIV =
  "NOVA BANKA-Priliv na 5551000051546932 Iznos 47,87 KM, svrha UPL. ZA 08/26 STAN BR 11, 5550000000009912 ZELJKO GALIC.Raspolozivo 11.175,20 KM";
const ODLIV_FEE =
  "NOVA BANKA-Odliv sa 5551000051546932 Iznos 9,00 KM, svrha Naknada za PAKET START SME za SEPTEMBAR-2026.Raspolozivo 11.102,91 KM";
const DAY = 86400000;

async function setup(tag: string) {
  const f = await createFixture(tag);
  await prisma.moneyAccount.update({ where: { id: f.account.id }, data: { iban: "555-10000515469-32" } });
  const { token } = await issueBankSmsToken(f.accountant);
  return { f, token };
}

async function invoiceForZeljko(f: Fixture, total: string) {
  const party = await prisma.party.create({
    data: { zevId: f.zev.id, kind: "PERSON", firstName: "Željko", lastName: "Galić", email: `${uid("zg")}@example.com` },
  });
  const b = await prisma.building.create({ data: { zevId: f.zev.id, name: `Zgrada-pm-${f.t}`, address: "Test" } });
  const unit = await prisma.unit.create({
    data: { zevId: f.zev.id, buildingId: b.id, type: "APARTMENT", label: "Stan 11", usableArea: "40.00", ownershipShare: "1.00" },
  });
  const inv = await prisma.invoice.create({
    data: { zevId: f.zev.id, number: `FAK-PM11-${f.t}`, unitId: unit.id, debtorId: party.id, issueDate: new Date(), dueDate: new Date(), total, status: "ISSUED" },
  });
  return { party, unit, inv };
}

/** Receives one SMS and confirms it (optionally allocated to an invoice); returns the SMS row. */
async function bookSms(f: Fixture, token: string, text: string, opts: { invoiceId?: string; categoryName?: string } = {}) {
  await receiveBankSms({ authorization: `Bearer ${token}`, text, ipHash: uid("ip") });
  const r = (await listBankSmsReview(f.accountant)).rows[0];
  await confirmBankSms(f.accountant, {
    items: [{
      smsId: r.id, accountId: r.accountId, date: r.date, amount: r.amount, payerNameRaw: r.payerNameRaw, purposeRaw: r.purposeRaw,
      invoiceId: opts.invoiceId ?? null, categoryName: opts.categoryName ?? null,
    }],
  });
  return prisma.incomingBankSms.findUniqueOrThrow({ where: { id: r.id } });
}

/** Books the same 47,87 KM inflow from a "PDF statement" (the shared commit path). */
async function bookFromPdf(f: Fixture, date: string, invoiceId: string | null = null) {
  const res = await commitPdfImport(f.accountant, {
    accountId: f.account.id,
    filename: `izvod-${f.t}.pdf`,
    rawText: "test",
    rows: [{ direction: "IN", date, amount: "47.87", payerNameRaw: "ZELJKO GALIC", purposeRaw: "UPL. ZA 08/26 STAN BR 11", reference: "", invoiceId }],
  });
  return prisma.payment.findFirstOrThrow({ where: { importBatchId: res.batchId } });
}

const today = (sms: { receivedAt: Date }) => sms.receivedAt.toISOString().slice(0, 10);

describe("PDF import keeps the link to an SMS it skipped", () => {
  it("an un-ticked duplicate row is recorded as SAME/IMPORT_SKIP; another ZEV's SMS id is ignored", async () => {
    const { f, token } = await setup("pm-skip");
    const sms = await bookSms(f, token, PRILIV);
    const other = await setup("pm-skip-other");
    const foreign = await bookSms(other.f, other.token, PRILIV);

    const res = await commitPdfImport(f.accountant, {
      accountId: f.account.id, filename: "izvod.pdf", rawText: "test", rows: [], skippedSmsIds: [sms.id, foreign.id],
    });
    expect(res.imported).toBe(0);
    expect(res.linkedToSms).toBe(1);
    const links = await prisma.bankRecordMatch.findMany({ where: { smsId: { in: [sms.id, foreign.id] } } });
    expect(links).toHaveLength(1);
    expect(links[0]).toMatchObject({ smsId: sms.id, decision: "SAME", origin: "IMPORT_SKIP", statementBatchId: res.batchId });
    expect(await prisma.payment.count({ where: { zevId: f.zev.id } })).toBe(1); // nothing booked twice

    // Even once old, a statement-confirmed SMS is neither a duplicate nor "bez potvrde".
    await prisma.incomingBankSms.update({ where: { id: sms.id }, data: { receivedAt: new Date(Date.now() - 6 * DAY) } });
    const rec = await getChannelReconciliation(f.accountant);
    expect(rec.duplicates).toHaveLength(0);
    expect(rec.unconfirmed).toHaveLength(0);
    expect(rec.confirmedCount).toBe(1);
    const info = await getPaymentChannelInfo(f.accountant, sms.paymentId!);
    expect(info).toMatchObject({ fromSms: true, statementConfirmed: true, merge: null });
  });
});

describe("detecting the same inflow booked twice", () => {
  it("finds the SMS + PDF pair with high confidence; 'nisu iste' removes it for good", async () => {
    const { f, token } = await setup("pm-detect");
    const sms = await bookSms(f, token, PRILIV);
    const pdf = await bookFromPdf(f, today(sms));

    const rec = await getChannelReconciliation(f.president); // the president may look
    expect(rec.duplicates).toHaveLength(1);
    expect(rec.duplicates[0]).toMatchObject({ smsId: sms.id, direction: "IN", confidence: "HIGH", canMerge: true });
    expect(rec.duplicates[0].sms.id).toBe(sms.paymentId);
    expect(rec.duplicates[0].other).toMatchObject({ id: pdf.id, source: "PDF" });

    await expect(markChannelNotSame(f.president, { smsId: sms.id, otherPaymentId: pdf.id })).rejects.toThrow(ForbiddenError);
    await markChannelNotSame(f.accountant, { smsId: sms.id, otherPaymentId: pdf.id });
    expect((await getChannelReconciliation(f.accountant)).duplicates).toHaveLength(0);
  });

  it("a manual entry is a candidate too; a different amount or a reversed payment is not", async () => {
    const { f, token } = await setup("pm-manual");
    const sms = await bookSms(f, token, PRILIV);
    await prisma.payment.create({
      data: { zevId: f.zev.id, accountId: f.account.id, date: sms.receivedAt, amount: "47.88", payerNameRaw: "ZELJKO GALIC", method: "BANK" },
    });
    await prisma.payment.create({
      data: { zevId: f.zev.id, accountId: f.account.id, date: sms.receivedAt, amount: "47.87", payerNameRaw: "ZELJKO GALIC", method: "BANK", reversedAt: new Date(), status: "REVERSED" },
    });
    expect((await getChannelReconciliation(f.accountant)).duplicates).toHaveLength(0);
    const manual = await prisma.payment.create({
      data: { zevId: f.zev.id, accountId: f.account.id, date: sms.receivedAt, amount: "47.87", payerNameRaw: "Neko drugi", method: "BANK" },
    });
    const rec = await getChannelReconciliation(f.accountant);
    expect(rec.duplicates).toHaveLength(1);
    expect(rec.duplicates[0].other).toMatchObject({ id: manual.id, source: "MANUAL" });
    expect(rec.duplicates[0].confidence).toBe("POSSIBLE"); // name differs
  });
});

describe("merging an inflow duplicate", () => {
  it("keeps the allocated SMS payment, reverses the unallocated statement one, and pays the owner once", async () => {
    const { f, token } = await setup("pm-merge-sms");
    const { party, inv } = await invoiceForZeljko(f, "47.87");
    const sms = await bookSms(f, token, PRILIV, { invoiceId: inv.id });
    const pdf = await bookFromPdf(f, today(sms));

    const res = await mergeChannelDuplicate(f.accountant, { smsId: sms.id, otherPaymentId: pdf.id });
    expect(res).toMatchObject({ survivorPaymentId: sms.paymentId, reversedPaymentId: pdf.id, moved: "0.00", notMoved: "0.00" });
    const reversed = await prisma.payment.findUniqueOrThrow({ where: { id: pdf.id }, include: { transaction: true } });
    expect(reversed.status).toBe("REVERSED");
    expect(reversed.transaction?.status).toBe("CANCELLED"); // cash is counted once
    expect((await prisma.invoice.findUniqueOrThrow({ where: { id: inv.id } })).status).toBe("PAID");
    expect((await ownerBalance(f.accountant, party.id)).balance).toBe("0.00");

    const match = await prisma.bankRecordMatch.findFirstOrThrow({ where: { smsId: sms.id } });
    expect(match).toMatchObject({ decision: "SAME", origin: "MERGE", survivorPaymentId: sms.paymentId, reversedPaymentId: pdf.id });
    expect(await prisma.auditEvent.count({ where: { action: "payment.channel_merge", zevId: f.zev.id } })).toBe(1);
    expect((await getChannelReconciliation(f.accountant)).duplicates).toHaveLength(0);
    expect(await getPaymentChannelInfo(f.accountant, pdf.id)).toMatchObject({ merge: { role: "DUPLICATE", otherPaymentId: sms.paymentId } });

    await expect(mergeChannelDuplicate(f.accountant, { smsId: sms.id, otherPaymentId: pdf.id })).rejects.toThrow(/već stornirana/);
  });

  it("keeps the statement payment when neither is allocated", async () => {
    const { f, token } = await setup("pm-merge-pdf");
    const sms = await bookSms(f, token, PRILIV);
    const pdf = await bookFromPdf(f, today(sms));
    const res = await mergeChannelDuplicate(f.accountant, { smsId: sms.id, otherPaymentId: pdf.id });
    expect(res).toMatchObject({ survivorPaymentId: pdf.id, reversedPaymentId: sms.paymentId });
  });

  it("when both are allocated, moves the duplicate's allocation to the survivor as far as its free amount allows", async () => {
    const { f, token } = await setup("pm-merge-both");
    const { inv } = await invoiceForZeljko(f, "47.87");
    const sms = await bookSms(f, token, PRILIV, { invoiceId: inv.id });
    const pdf = await bookFromPdf(f, today(sms));
    const inv2 = await prisma.invoice.create({
      data: { zevId: f.zev.id, number: `FAK-PM2-${f.t}`, unitId: f.u1.id, debtorId: f.ownerA.id, issueDate: new Date(), dueDate: new Date(), total: "20.00", status: "ISSUED" },
    });
    await allocatePayment(f.accountant, { paymentId: pdf.id, invoiceId: inv2.id, amount: "20.00" });

    const res = await mergeChannelDuplicate(f.accountant, { smsId: sms.id, otherPaymentId: pdf.id });
    expect(res).toMatchObject({ survivorPaymentId: pdf.id, reversedPaymentId: sms.paymentId, moved: "27.87", notMoved: "20.00" });
    const survivor = await prisma.payment.findUniqueOrThrow({ where: { id: pdf.id }, include: { allocations: true } });
    expect(survivor.status).toBe("APPLIED");
    expect(survivor.allocations.filter((a) => a.invoiceId === inv.id).map((a) => a.amount.toString())).toEqual(["27.87"]);
    expect((await prisma.invoice.findUniqueOrThrow({ where: { id: inv.id } })).status).toBe("ISSUED"); // 20 KM open again
    expect((await prisma.invoice.findUniqueOrThrow({ where: { id: inv2.id } })).status).toBe("PAID");
  });

  it("only the ACCOUNTANT merges, and never across ZEVs", async () => {
    const { f, token } = await setup("pm-merge-roles");
    const sms = await bookSms(f, token, PRILIV);
    const pdf = await bookFromPdf(f, today(sms));
    await expect(mergeChannelDuplicate(f.president, { smsId: sms.id, otherPaymentId: pdf.id })).rejects.toThrow(ForbiddenError);
    const other = await createFixture("pm-merge-iso");
    await expect(mergeChannelDuplicate(other.accountant, { smsId: sms.id, otherPaymentId: pdf.id })).rejects.toThrow(/nije pronađeno/);
    expect((await getChannelReconciliation(other.accountant)).duplicates).toHaveLength(0);
    expect((await prisma.payment.findUniqueOrThrow({ where: { id: pdf.id } })).status).not.toBe("REVERSED");
  });
});

describe("SMS bookings the statement never confirmed", () => {
  it("lists them after 3 days; a manual confirmation settles them", async () => {
    const { f, token } = await setup("pm-unconf");
    const sms = await bookSms(f, token, PRILIV);
    expect((await getChannelReconciliation(f.accountant)).unconfirmed).toHaveLength(0); // too fresh
    await prisma.incomingBankSms.update({ where: { id: sms.id }, data: { receivedAt: new Date(Date.now() - 5 * DAY) } });
    const rec = await getChannelReconciliation(f.accountant);
    expect(rec.unconfirmed.map((u) => u.smsId)).toEqual([sms.id]);
    expect(await getPaymentChannelInfo(f.accountant, sms.paymentId!)).toMatchObject({ fromSms: true, statementConfirmed: false });

    await expect(confirmSmsByStatement(f.president, sms.id)).rejects.toThrow(ForbiddenError);
    await confirmSmsByStatement(f.accountant, sms.id);
    const after = await getChannelReconciliation(f.accountant);
    expect(after.unconfirmed).toHaveLength(0);
    expect(after.confirmedCount).toBe(1);
  });
});

describe("outflows: detected and linked, never merged (decision P3)", () => {
  it("an SMS Odliv and a bank outflow of the same amount are a pair; linking keeps flagging a double outflow", async () => {
    const { f, token } = await setup("pm-out");
    const sms = await bookSms(f, token, ODLIV_FEE, { categoryName: `Naknade ${f.t}` });
    const t = await prisma.finTransaction.create({
      data: { zevId: f.zev.id, accountId: f.account.id, date: sms.receivedAt, type: "EXPENSE", amount: "9.00", paymentMethod: "BANK", description: "Naknada banke" },
    });
    const rec = await getChannelReconciliation(f.accountant);
    expect(rec.duplicates).toHaveLength(1);
    expect(rec.duplicates[0]).toMatchObject({ direction: "OUT", canMerge: false, linkedButBothActive: false });
    expect(rec.duplicates[0].other.id).toBe(t.id);
    await expect(mergeChannelDuplicate(f.accountant, { smsId: sms.id, otherPaymentId: t.id })).rejects.toThrow(/samo za uplate/);

    await linkChannelTransaction(f.accountant, { smsId: sms.id, otherTransactionId: t.id });
    const linked = await getChannelReconciliation(f.accountant);
    expect(linked.duplicates).toHaveLength(1);
    expect(linked.duplicates[0].linkedButBothActive).toBe(true);
    expect(await prisma.finTransaction.count({ where: { zevId: f.zev.id, type: "EXPENSE", status: "ACTIVE" } })).toBe(2); // nothing reversed
  });
});
