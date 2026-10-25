// F5a — servisni dio: avans kao izvedeno pravilo (F5-Q3 (a)), broj na početnoj = broj filtera, filter „Dospjela”,
// zbir liste faktura, troškovi koji dospijevaju, neuspjela e-pošta po seriji i izolacija po ZEV-u.
import { describe, it, expect, beforeAll } from "vitest";
import { prisma } from "@/lib/prisma";
import { createFixture, createAreaCharges, type Fixture } from "./helpers";
import { createDraftBatch, issueBatch, invoiceTotals, invoiceWhereForFilter, listInvoices, INVOICE_FILTER_OVERDUE } from "@/server/services/billing";
import {
  enterPayment, allocatePayment, listPayments, countPaymentsToMatch, advanceSummary, paymentWhereForFilter,
  PAYMENT_FILTER_ADVANCE, PAYMENT_FILTER_TO_MATCH,
} from "@/server/services/payments";
import { createExpense, expensesDueWhere, listExpenses } from "@/server/services/expenses";
import { failedInvoiceEmailsByBatch, INVOICE_EMAIL_TEMPLATE } from "@/server/services/invoiceEmail";
import { getAccountantTasks, suggestedBatchPeriod } from "@/server/services/accountantHome";
import { isInvoiceOverdue } from "@/lib/paymentInstructions";
import { toZonedDateIso } from "@/lib/i18n";
import type { Invoice } from "@/generated/prisma/client";


describe("accountant home: payments (advance rule)", () => {
  let f: Fixture;
  let other: Fixture;
  let invoicesA: Invoice[];

  beforeAll(async () => {
    f = await createFixture("ah-pay");
    other = await createFixture("ah-other");
    const ids = await createAreaCharges(f, "1.00");
    const { batch } = await createDraftBatch(f.accountant, "2033-01", undefined, ids);
    const issued = await issueBatch(f.accountant, batch.id);
    invoicesA = issued.filter((i) => i.debtorId === f.ownerA.id); // u1 50,00 + u4 20,00
  });

  const ids = async (status: string) =>
    (await listPayments(f.accountant, { status }, { page: 1 })).rows.map((r) => r.id).sort();

  it("a payer with open invoices: a free payment is 'za uparivanje', not an advance", async () => {
    const p = await enterPayment(f.accountant, { accountId: f.account.id, date: new Date(), amount: "30.00", payerId: f.ownerA.id });
    expect(await ids(PAYMENT_FILTER_TO_MATCH)).toEqual([p.id]);
    expect(await ids(PAYMENT_FILTER_ADVANCE)).toEqual([]);
  });

  it("an unknown payer always needs matching", async () => {
    const p = await enterPayment(f.accountant, { accountId: f.account.id, date: new Date(), amount: "12.00", payerNameRaw: "Nepoznat" });
    expect((await ids(PAYMENT_FILTER_TO_MATCH)).includes(p.id)).toBe(true);
    expect((await ids(PAYMENT_FILTER_ADVANCE)).includes(p.id)).toBe(false);
  });

  it("when the payer has no open invoices the surplus is an advance; a new invoice brings it back", async () => {
    // Ana plaća obje svoje fakture (70,00) — sve što ostane slobodno je avans.
    const pay = await enterPayment(f.accountant, { accountId: f.account.id, date: new Date(), amount: "100.00", payerId: f.ownerA.id });
    for (const inv of invoicesA) await allocatePayment(f.accountant, { paymentId: pay.id, invoiceId: inv.id, amount: inv.total.toString() });
    const after = await prisma.payment.findUniqueOrThrow({ where: { id: pay.id } });
    expect(after.status).toBe("PARTIALLY_APPLIED");

    // sada Ana nema otvorenih faktura: 30,00 (prva uplata) + 30,00 (ostatak) su avans, a "za uparivanje" ostaju samo nepoznati platioci
    expect((await ids(PAYMENT_FILTER_ADVANCE)).includes(pay.id)).toBe(true);
    expect((await ids(PAYMENT_FILTER_TO_MATCH)).includes(pay.id)).toBe(false);
    const adv = await advanceSummary(f.zev.id);
    expect(adv.count).toBe((await ids(PAYMENT_FILTER_ADVANCE)).length);
    expect(adv.total).toBe("60.00"); // 30,00 neraspoređeno + 30,00 ostatak uplate od 100,00

    // nova faktura (serija 2033-02) → Ana ponovo ima otvorene fakture → uplate opet čekaju uparivanje
    const chargeIds = await createAreaCharges(f, "1.00");
    const { batch } = await createDraftBatch(f.accountant, "2033-02", undefined, chargeIds);
    await issueBatch(f.accountant, batch.id);
    expect((await ids(PAYMENT_FILTER_ADVANCE)).includes(pay.id)).toBe(false);
    expect((await ids(PAYMENT_FILTER_TO_MATCH)).includes(pay.id)).toBe(true);
    expect((await advanceSummary(f.zev.id)).count).toBe(0);
  });

  it("the count on the home page is the same query as the filter, and never includes another tenant", async () => {
    await enterPayment(other.accountant, { accountId: other.account.id, date: new Date(), amount: "5.00", payerNameRaw: "Tuđi" });
    const list = await listPayments(f.accountant, { status: PAYMENT_FILTER_TO_MATCH }, { page: 1 });
    const count = await countPaymentsToMatch(f.zev.id);
    expect(count).toBe(await prisma.payment.count({ where: paymentWhereForFilter(f.zev.id, PAYMENT_FILTER_TO_MATCH) }));
    expect(count).toBe(list.rows.length); // manje od jedne stranice
    expect(list.rows.every((r) => r.zevId === f.zev.id)).toBe(true);
    const tasks = await getAccountantTasks(f.accountant);
    expect(tasks.tasks.find((t) => t.key === "payments-to-match")?.count).toBe(count);
  });

  it("the accountant task list needs the ACCOUNTANT role", async () => {
    await expect(getAccountantTasks(f.president)).rejects.toThrow();
    await expect(getAccountantTasks(f.actorA)).rejects.toThrow();
  });
});

describe("accountant home: invoices (Dospjela, totals, period)", () => {
  let f: Fixture;
  beforeAll(async () => {
    f = await createFixture("ah-inv");
    const ids = await createAreaCharges(f, "1.00");
    const { batch: past } = await createDraftBatch(f.accountant, "2020-03", undefined, ids); // rok 15.03.2020. — prošao
    await issueBatch(f.accountant, past.id);
    const { batch: future } = await createDraftBatch(f.accountant, "2098-03", undefined, ids); // rok u budućnosti
    await issueBatch(f.accountant, future.id);
  });

  it("'Dospjela' filter = ISSUED with a due date before today (calendar day, Europe/Sarajevo)", async () => {
    const overdue = await listInvoices(f.accountant, { status: INVOICE_FILTER_OVERDUE });
    expect(overdue.rows.length).toBeGreaterThan(0);
    expect(overdue.rows.every((i) => i.periodLabel === "2020-03" && i.status === "ISSUED")).toBe(true);
    expect(overdue.rows.every((i) => isInvoiceOverdue(i))).toBe(true);
    const all = await listInvoices(f.accountant, {});
    expect(all.rows.filter((i) => isInvoiceOverdue(i)).length).toBe(overdue.rows.length);
  });

  it("the overdue boundary is the due day itself", async () => {
    const where = (now: Date) => ({ AND: [invoiceWhereForFilter(f.zev.id, { status: INVOICE_FILTER_OVERDUE }, now), { periodLabel: "2020-03" }] });
    const n = (now: Date) => prisma.invoice.count({ where: where(now) });
    expect(await n(new Date("2020-03-15T12:00:00Z"))).toBe(0); // na sam dan roka
    expect(await n(new Date("2020-03-15T22:30:00Z"))).toBe(0); // 23:30 lokalno
    expect(await n(new Date("2020-03-15T23:30:00Z"))).toBeGreaterThan(0); // 00:30 sljedećeg dana
  });

  it("totals for the filter: amount, paid and open of issued and paid invoices", async () => {
    const t = await invoiceTotals(f.accountant, { status: INVOICE_FILTER_OVERDUE });
    const rows = (await listInvoices(f.accountant, { status: INVOICE_FILTER_OVERDUE })).rows;
    expect(t.count).toBe(rows.length);
    expect(Number(t.total)).toBeCloseTo(rows.reduce((a, r) => a + Number(r.total), 0), 2);
    expect(t.paid).toBe("0.00");
    expect(t.open).toBe(t.total);
    const everything = await invoiceTotals(f.accountant, {});
    expect(everything.count).toBe(rows.length * 2);
  });

  it("suggested period: the month after the last issued batch", async () => {
    expect(await suggestedBatchPeriod(f.accountant, new Date("2026-10-25T10:00:00Z"))).toBe("2098-04");
    const fresh = await createFixture("ah-per");
    expect(await suggestedBatchPeriod(fresh.accountant, new Date("2026-10-25T10:00:00Z"))).toBe("2026-10");
  });
});

describe("accountant home: expenses due and failed e-mail", () => {
  let f: Fixture;
  const iso = (offset: number) => {
    const [y, m, d] = toZonedDateIso(new Date()).split("-").map(Number);
    return new Date(Date.UTC(y, m - 1, d + offset)); // rok je UTC ponoć kalendarskog dana
  };

  beforeAll(async () => {
    f = await createFixture("ah-exp");
    const mk = (offset: number | null, tag: string) =>
      createExpense(f.accountant, { invoiceNumber: tag, amount: "10.00", dueDate: offset === null ? null : iso(offset), allowDuplicate: true });
    await mk(-3, "x-3");
    await mk(-1, "x-1");
    await mk(0, "x0");
    await mk(7, "x7");
    await mk(8, "x8");
    await mk(null, "xnull");
    const paid = await mk(1, "xpaid");
    await prisma.expense.update({ where: { id: paid.id }, data: { status: "PAID" } });
  });

  it("the count and the list filter use the same condition (today + 7 days inclusive, overdue included)", async () => {
    const now = new Date();
    const count = await prisma.expense.count({ where: expensesDueWhere(f.zev.id, now, 7) });
    const list = await listExpenses(f.accountant, { dueWithinDays: 7 });
    expect(count).toBe(4);
    expect(list.map((e) => e.invoiceNumber).sort()).toEqual(["x-1", "x-3", "x0", "x7"]);
    expect(await prisma.expense.count({ where: expensesDueWhere(f.zev.id, now, -1) })).toBe(2);
    const task = (await getAccountantTasks(f.accountant)).tasks.find((x) => x.key === "expenses-due");
    expect(task?.count).toBe(4);
    expect(task?.meta).toContain("2");
  });

  it("failed invoice e-mail is counted per batch from the LATEST message of each invoice", async () => {
    const ids = await createAreaCharges(f, "1.00");
    const { batch } = await createDraftBatch(f.accountant, "2034-05", undefined, ids);
    const invoices = await issueBatch(f.accountant, batch.id);
    const mkMsg = (invoiceId: string, status: "FAILED" | "SENT", at: number) =>
      prisma.notificationMessage.create({
        data: {
          zevId: f.zev.id, channel: "EMAIL", toAddress: "x@example.com", body: "b", status, template: INVOICE_EMAIL_TEMPLATE.ISSUED,
          relatedType: "Invoice", relatedId: invoiceId, createdAt: new Date(Date.now() + at),
        },
      });
    await mkMsg(invoices[0].id, "FAILED", 0);
    await mkMsg(invoices[1].id, "FAILED", 0);
    expect(await failedInvoiceEmailsByBatch(f.zev.id)).toEqual([{ batchId: batch.id, period: "2034-05", failed: 2 }]);
    await mkMsg(invoices[1].id, "SENT", 1000); // ponovljeno slanje uspjelo
    expect(await failedInvoiceEmailsByBatch(f.zev.id)).toEqual([{ batchId: batch.id, period: "2034-05", failed: 1 }]);
    const t = (await getAccountantTasks(f.accountant)).tasks.find((x) => x.key === `email-failed:${batch.id}`);
    expect(t?.count).toBe(1);
    expect(t?.href).toBe(`/fakture/serija/${batch.id}`);
    // druga ustanova ne vidi ništa
    const other = await createFixture("ah-exp2");
    expect(await failedInvoiceEmailsByBatch(other.zev.id)).toEqual([]);
  });
});

