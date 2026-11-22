// Faza B2b — dobavljači, ručni promet i korekcije salda (Plans/kontni-plan-b2-automatsko-knjizenje-plan.md §3, B2-Q5/Q8/Q9).
import { describe, it, expect, beforeAll } from "vitest";
import { prisma } from "@/lib/prisma";
import { createFixture, createSuperAdminActor, uid, type Fixture } from "./helpers";
import type { Actor } from "@/server/auth/guards";
import * as coa from "@/server/services/chartOfAccounts";
import * as lc from "@/server/services/ledgerConfig";
import * as j from "@/server/services/journal";
import * as ob from "@/server/services/openingBalance";
import * as ev from "@/server/services/ledgerEvents";
import * as pay from "@/server/services/payments";
import * as exp from "@/server/services/expenses";
import * as fin from "@/server/services/finance";
import { toZonedDateIso } from "@/lib/i18n";

const RULES = { digitsOnly: true, allowedLengths: [1, 2, 3, 5], childExtendsParent: true, maxDepth: 4 };
const CSV = [
  "2;K2;;ASSET;ne", "20;G20;2;ASSET;ne", "201;S201;20;ASSET;ne", "20101;Potraživanja održavanje;201;ASSET;da", "20102;Potraživanja rezerva;201;ASSET;da",
  "24;G24;2;ASSET;ne", "241;S241;24;ASSET;ne", "24101;Tekući račun;241;ASSET;da", "28;G28;2;ASSET;ne", "280;S280;28;ASSET;ne", "28001;Razgraničenja;280;ASSET;da",
  "3;K3;;EQUITY;ne", "34;G34;3;EQUITY;ne", "340;S340;34;EQUITY;ne", "34001;Višak ranijih godina;340;EQUITY;da",
  "4;K4;;LIABILITY;ne", "43;G43;4;LIABILITY;ne", "430;S430;43;LIABILITY;ne", "43001;Avansi;430;LIABILITY;da", "43002;Neidentifikovane;430;LIABILITY;da",
  "432;S432;43;LIABILITY;ne", "43201;Dobavljači;432;LIABILITY;da",
  "49;G49;4;LIABILITY;ne", "499;S499;49;LIABILITY;ne", "49901;Razgraničeno održavanje;499;LIABILITY;da", "49903;Korekcije salda;499;LIABILITY;da",
  "5;K5;;EXPENSE;ne", "55;G55;5;EXPENSE;ne", "550;S550;55;EXPENSE;ne", "55001;Troškovi održavanja;550;EXPENSE;da", "55002;Bankarske provizije;550;EXPENSE;da",
  "6;K6;;INCOME;ne", "66;G66;6;INCOME;ne", "660;S660;66;INCOME;ne", "66001;Prihod od kamata;660;INCOME;da",
].join("\n");

const TODAY = toZonedDateIso(new Date());
const YEAR = TODAY.slice(0, 4);
const START = `${YEAR}-01-01`;
const VF = `${Number(YEAR) - 1}-01-01`;

type Ctx = { acc: (code: string) => string; maint: string };

async function setup(sa: Actor, f: Fixture, tag: string): Promise<Ctx> {
  const tpl = await coa.createTemplate(sa, { key: `b2b-${uid(tag).toLowerCase()}`, name: "B2b", jurisdiction: "RS", source: "Test", codeRules: RULES });
  expect((await coa.importTemplateAccounts(sa, tpl.id, CSV)).ok).toBe(true);
  await coa.setTemplateStatus(sa, tpl.id, "REVIEWED", { reviewedBy: "N.N.", reviewedAt: "2026-01-01" });
  await coa.assignChart(f.accountant, tpl.id);
  await coa.activateChart(f.accountant);
  await coa.openFiscalYear(f.accountant, { label: YEAR, startDate: START, endDate: `${YEAR}-12-31`, periodicity: "MONTHLY" });
  await lc.applyStarterSetup(f.accountant);
  const chart = (await coa.getZevChart(f.accountant))!;
  const acc = (code: string) => chart.accounts.find((a) => a.code === code)!.id;
  const purposes = await lc.listPurposes(f.accountant);
  const maint = purposes.find((p) => !p.isCommonReserve)!;
  const reserve = purposes.find((p) => p.isCommonReserve)!;
  await lc.setControlAccount(f.accountant, { role: "MONEY_ACCOUNT", moneyAccountId: f.account.id, accountId: acc("24101"), validFrom: VF });
  await lc.setControlAccount(f.accountant, { role: "OWNER_RECEIVABLE", purposeId: maint.id, accountId: acc("20101"), validFrom: VF });
  await lc.setControlAccount(f.accountant, { role: "OWNER_RECEIVABLE", purposeId: reserve.id, accountId: acc("20102"), validFrom: VF });
  await lc.setControlAccount(f.accountant, { role: "OWNER_ADVANCE", accountId: acc("43001"), validFrom: VF });
  await lc.setControlAccount(f.accountant, { role: "UNIDENTIFIED_RECEIPTS", accountId: acc("43002"), validFrom: VF });
  await lc.setControlAccount(f.accountant, { role: "SUPPLIER_PAYABLE", accountId: acc("43201"), validFrom: VF });
  return { acc, maint: maint.id };
}

async function postOpening(f: Fixture, ctx: Ctx) {
  const d = await ob.prepareOpening(f.accountant, { startDate: START });
  const r = await ob.reconcileOpening(f.accountant, d.id);
  const diff = Number(r.debit) - Number(r.credit);
  const lines = [{ accountId: ctx.acc("28001"), debit: "1.00" }, { accountId: ctx.acc("34001"), credit: "1.00" }];
  if (diff > 0) lines.push({ accountId: ctx.acc("34001"), credit: diff.toFixed(2) });
  if (diff < 0) lines.push({ accountId: ctx.acc("34001"), debit: (-diff).toFixed(2) } as never);
  await ob.saveOpeningManualLines(f.accountant, d.id, { description: "PS", lines });
  return j.postEntry(f.accountant, d.id);
}

async function rule(f: Fixture, kind: string, counterAccountId: string, categoryId: string | null = null) {
  const r = await lc.createRuleDraft(f.accountant, { kind, categoryId, counterAccountId, validFrom: VF, reason: "Test" });
  return lc.confirmRule(f.accountant, r.id, "N.N., računovođa");
}

const event = (zevId: string, sourceType: string, sourceId: string, kind: string) =>
  prisma.accountingEvent.findUnique({ where: { zevId_sourceType_sourceId_kind: { zevId, sourceType, sourceId, kind: kind as never } } });

async function entryLines(entryId: string) {
  const rows = await prisma.journalLine.findMany({ where: { entryId }, include: { account: { select: { code: true } } }, orderBy: { order: "asc" } });
  return rows.map((l) => ({ code: l.account.code, d: Number(l.debit), p: Number(l.credit), party: l.partyId, supplier: l.supplierId, purpose: l.purposeId, rule: l.ruleId }));
}

async function ledger(zevId: string, accountId: string, filter: { supplierId?: string; partyId?: string } = {}) {
  const rows = await prisma.journalLine.findMany({ where: { zevId, accountId, entry: { status: "POSTED" }, ...filter } });
  return rows.reduce((s, l) => s + Number(l.debit) - Number(l.credit), 0);
}

describe("B2b: dobavljači, ručni promet i korekcije salda", () => {
  let sa: Actor;
  let f: Fixture;
  let ctx: Ctx;
  let supplierId: string;
  let maintCat: string;
  let feeCat: string;

  beforeAll(async () => {
    sa = await createSuperAdminActor("b2b-sa");
    f = await createFixture("b2b");
    ctx = await setup(sa, f, "b2b");
    supplierId = (await exp.createSupplier(f.accountant, { name: `Dobavljač-${f.t}` })).id;
    maintCat = (await fin.ensureCategory(f.accountant, `Održavanje-${f.t}`, "EXPENSE")).id;
    feeCat = (await fin.ensureCategory(f.accountant, `Provizija-${f.t}`, "EXPENSE")).id;
  });

  it("prije aktivnog knjiženja kategorija nije obavezna; poslije jeste (B2-Q9)", async () => {
    const before = await exp.createExpense(f.accountant, { supplierId, amount: "5.00", invoiceDate: new Date(`${VF}T00:00:00Z`) });
    expect(before.categoryId).toBeNull();
    await postOpening(f, ctx);
    await expect(exp.createExpense(f.accountant, { supplierId, amount: "5.00", invoiceDate: new Date() })).rejects.toThrow(/kategoriju/);
    await expect(fin.enterTransaction(f.accountant, { accountId: f.account.id, date: new Date(), type: "EXPENSE", amount: "1.00" })).rejects.toThrow(/kategoriju/);
    await expect(pay.assertStatementRowsCommittable(f.zev.id, [
      { direction: "OUT", date: TODAY, amount: "2.00", payerNameRaw: "Banka", purposeRaw: "", reference: "", invoiceId: null, expenseId: null, categoryName: "" } as never,
    ])).rejects.toThrow(/kategoriju/);
    // Trošak iz ranije godine (prije početka) nema događaj — sadržan je u početnom stanju.
    expect(await event(f.zev.id, "Expense", before.id, "SUPPLIER_INVOICE")).toBeNull();
  });

  it("račun dobavljača bez pravila čeka; plaćanje čeka račun; poslije potvrde pravila oba se knjiže", async () => {
    const e = await exp.createExpense(f.accountant, { supplierId, categoryId: maintCat, amount: "100.00", invoiceDate: new Date(), invoiceNumber: uid("R") });
    const ev1 = await event(f.zev.id, "Expense", e.id, "SUPPLIER_INVOICE");
    expect(ev1).toMatchObject({ status: "WAITING_RULE" });
    expect(ev1!.statusDetail).toMatch(/nema potvrđeno pravilo/);

    await exp.payExpense(f.accountant, { expenseId: e.id, accountId: f.account.id, date: new Date(), amount: "40.00" });
    const t = await prisma.finTransaction.findFirstOrThrow({ where: { expenseId: e.id } });
    expect(await event(f.zev.id, "FinTransaction", t.id, "SUPPLIER_PAYMENT")).toMatchObject({ status: "WAITING_PREDECESSOR" });
    // K-2: plaćanje troška nije ručni rashod.
    expect(await event(f.zev.id, "FinTransaction", t.id, "CASH_EXPENSE")).toBeNull();

    await rule(f, "SUPPLIER_INVOICE", ctx.acc("55001"), maintCat);
    await ev.processPending(f.accountant);
    const inv = (await event(f.zev.id, "Expense", e.id, "SUPPLIER_INVOICE"))!;
    expect(inv.status).toBe("POSTED");
    const lines = await entryLines(inv.journalEntryId!);
    expect(lines.find((l) => l.code === "55001")).toMatchObject({ d: 100, purpose: ctx.maint });
    expect(lines.find((l) => l.code === "55001")!.rule).toBeTruthy();
    expect(lines.find((l) => l.code === "43201")).toMatchObject({ p: 100, supplier: supplierId });

    const paid = (await event(f.zev.id, "FinTransaction", t.id, "SUPPLIER_PAYMENT"))!;
    expect(paid.status).toBe("POSTED");
    const pl = await entryLines(paid.journalEntryId!);
    expect(pl.find((l) => l.code === "43201")).toMatchObject({ d: 40, supplier: supplierId });
    expect(pl.find((l) => l.code === "24101")!.p).toBe(40);
    // 100 − 40 otvoreno + raniji račun od 5 KM iz početnog stanja.
    expect(await ledger(f.zev.id, ctx.acc("43201"), { supplierId })).toBe(-65);
  });

  it("proknjižen račun: iznos, dobavljač, kategorija i datum se ne mijenjaju; opis da (B2-Q5)", async () => {
    const e = await exp.createExpense(f.accountant, { supplierId, categoryId: maintCat, amount: "30.00", invoiceDate: new Date() });
    expect((await event(f.zev.id, "Expense", e.id, "SUPPLIER_INVOICE"))!.status).toBe("POSTED");
    await expect(exp.updateExpense(f.accountant, e.id, { amount: "31.00" })).rejects.toThrow(/proknjižen.*stornirajte/);
    await expect(exp.updateExpense(f.accountant, e.id, { categoryId: feeCat })).rejects.toThrow(/proknjižen/);
    await exp.updateExpense(f.accountant, e.id, { amount: "30.00", description: "Novi opis" });
    expect((await prisma.expense.findUniqueOrThrow({ where: { id: e.id } })).description).toBe("Novi opis");

    // Storno troška knjiži tačnu suprotnost i veže se na original.
    await exp.cancelExpense(f.accountant, e.id, "Pogrešan unos");
    const c = (await event(f.zev.id, "Expense", e.id, "SUPPLIER_INVOICE_CANCELLED"))!;
    expect(c.status).toBe("POSTED");
    const orig = (await event(f.zev.id, "Expense", e.id, "SUPPLIER_INVOICE"))!;
    const rev = await prisma.journalEntry.findUniqueOrThrow({ where: { id: c.journalEntryId! } });
    expect(rev.reversalOfId).toBe(orig.journalEntryId);
    expect((await entryLines(c.journalEntryId!)).find((l) => l.code === "43201")).toMatchObject({ d: 30 });
  });

  it("neproknjižen račun se smije izmijeniti — događaj se izvodi ponovo sa novim iznosom", async () => {
    const other = (await fin.ensureCategory(f.accountant, `Ostalo-${f.t}`, "EXPENSE")).id;
    const e = await exp.createExpense(f.accountant, { supplierId, categoryId: other, amount: "12.00", invoiceDate: new Date() });
    expect((await event(f.zev.id, "Expense", e.id, "SUPPLIER_INVOICE"))!.status).toBe("WAITING_RULE");
    await exp.updateExpense(f.accountant, e.id, { amount: "13.00", categoryId: maintCat });
    const after = (await event(f.zev.id, "Expense", e.id, "SUPPLIER_INVOICE"))!;
    expect(after).toMatchObject({ status: "POSTED" });
    expect(after.amount.toFixed(2)).toBe("13.00");
  });

  it("ručni rashod i prihod po pravilu kategorije; storno transakcije je suprotnost", async () => {
    await rule(f, "CASH_EXPENSE", ctx.acc("55002"), feeCat);
    const fee = await fin.enterTransaction(f.accountant, { accountId: f.account.id, date: new Date(), type: "EXPENSE", amount: "3.50", categoryId: feeCat, counterpartyName: "Banka" });
    const fe = (await event(f.zev.id, "FinTransaction", fee.id, "CASH_EXPENSE"))!;
    expect(fe.status).toBe("POSTED");
    const fl = await entryLines(fe.journalEntryId!);
    expect(fl.find((l) => l.code === "55002")!.d).toBe(3.5);
    expect(fl.find((l) => l.code === "24101")!.p).toBe(3.5);

    const interest = (await fin.ensureCategory(f.accountant, `Kamata-${f.t}`, "INCOME")).id;
    await rule(f, "CASH_INCOME", ctx.acc("66001"), interest);
    const inc = await fin.enterTransaction(f.accountant, { accountId: f.account.id, date: new Date(), type: "INCOME", amount: "0.80", categoryId: interest });
    const ie = (await event(f.zev.id, "FinTransaction", inc.id, "CASH_INCOME"))!;
    expect(ie.status).toBe("POSTED");
    const il = await entryLines(ie.journalEntryId!);
    expect(il.find((l) => l.code === "24101")!.d).toBe(0.8);
    expect(il.find((l) => l.code === "66001")!.p).toBe(0.8);

    await fin.cancelTransaction(f.accountant, fee.id, "Greška banke");
    const ce = (await event(f.zev.id, "FinTransaction", fee.id, "TRANSACTION_CANCELLED"))!;
    expect(ce.status).toBe("POSTED");
    const cl = await entryLines(ce.journalEntryId!);
    expect(cl.find((l) => l.code === "55002")!.p).toBe(3.5);
    expect(cl.find((l) => l.code === "24101")!.d).toBe(3.5);
  });

  it("K-2: uplata vlasnika ne pravi ručni prihod, a njen promet se ne stornira kao transakcija", async () => {
    const p = await pay.enterPayment(f.accountant, { accountId: f.account.id, date: new Date(), amount: "7.00", payerId: f.ownerA.id });
    const t = await prisma.finTransaction.findFirstOrThrow({ where: { paymentId: p.id } });
    expect(await event(f.zev.id, "FinTransaction", t.id, "CASH_INCOME")).toBeNull();
    await expect(fin.cancelTransaction(f.accountant, t.id, "x")).rejects.toThrow(/stornom uplate/);
  });

  it("korekcija salda čeka pravilo „Korekcija salda”, pa knjiži potraživanja ↔ protivkonto (B2-Q8)", async () => {
    const up = await prisma.balanceCorrection.create({ data: { zevId: f.zev.id, partyId: f.ownerB.id, unitId: f.u2.id, amount: "15.00", reason: "Prenos duga" } });
    await ev.afterLedgerChange(f.zev.id, f.accountant.userId);
    expect(await event(f.zev.id, "BalanceCorrection", up.id, "BALANCE_CORRECTION")).toMatchObject({ status: "WAITING_RULE" });
    const cov = await lc.getCoverage(f.accountant);
    expect(cov.ruleRows.find((r) => r.kind === "BALANCE_CORRECTION")).toMatchObject({ status: "MISSING" });

    await rule(f, "BALANCE_CORRECTION", ctx.acc("49903"));
    expect((await lc.getCoverage(f.accountant)).ruleRows.find((r) => r.kind === "BALANCE_CORRECTION")).toMatchObject({ status: "OK" });
    const down = await prisma.balanceCorrection.create({ data: { zevId: f.zev.id, partyId: f.ownerB.id, unitId: f.u2.id, amount: "-5.00", reason: "Otpis" } });
    await ev.processPending(f.accountant);
    const e1 = (await event(f.zev.id, "BalanceCorrection", up.id, "BALANCE_CORRECTION"))!;
    expect(e1.status).toBe("POSTED");
    expect((await entryLines(e1.journalEntryId!)).find((l) => l.code === "20101")).toMatchObject({ d: 15, party: f.ownerB.id, purpose: ctx.maint });
    const e2 = (await event(f.zev.id, "BalanceCorrection", down.id, "BALANCE_CORRECTION"))!;
    expect((await entryLines(e2.journalEntryId!)).find((l) => l.code === "20101")).toMatchObject({ p: 5 });
    expect(await ledger(f.zev.id, ctx.acc("20101"), { partyId: f.ownerB.id })).toBe(10);
  });

  it("oznaka stanja knjiženja: trošak nosi i svoja plaćanja; vlasnik je ne vidi", async () => {
    const e = await exp.createExpense(f.accountant, { supplierId, categoryId: maintCat, amount: "20.00", invoiceDate: new Date() });
    await exp.payExpense(f.accountant, { expenseId: e.id, accountId: f.account.id, date: new Date() });
    const notes = (await ev.postingNotes(f.accountant, "Expense", [e.id]))!.get(e.id)!;
    expect(notes.map((n) => [n.kind, n.status])).toEqual([["SUPPLIER_INVOICE", "POSTED"], ["SUPPLIER_PAYMENT", "POSTED"]]);
    expect(notes[0].entryNumber).toMatch(/^NK-/);
    expect(await ev.postingNotes(f.actorA, "Expense", [e.id])).toBeNull();
  });

  it("usklađenost: saldo dobavljača u knjizi = otvoreni računi iz evidencije", async () => {
    const snapshot = await ob.operationalSnapshot(prisma, f.zev.id, TODAY);
    const open = snapshot.filter((i) => i.role === "SUPPLIER_PAYABLE").reduce((s, i) => s + Number(i.amount), 0);
    // Raniji trošak od 5 KM (prije početka) je u početnom stanju; ostalo kroz automatske naloge.
    expect(-(await ledger(f.zev.id, ctx.acc("43201")))).toBeCloseTo(open, 2);
  });
});
