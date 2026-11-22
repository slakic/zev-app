// Faza B4 §6 — cijeli tok knjiženja jednog ZEV-a: proba, aktivacija, rad svim vrstama događaja, kasno unesen
// dokument, zatvoren period, pa izvještaji koji se slažu (Plans/kontni-plan-b4-proba-i-aktivacija-plan.md §6).
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
import * as billing from "@/server/services/billing";
import * as dr from "@/server/services/ledgerDryRun";
import * as rep from "@/server/services/ledgerReports";
import * as rc from "@/server/services/ledgerReconciliation";
import { toZonedDateIso } from "@/lib/i18n";

const RULES = { digitsOnly: true, allowedLengths: [1, 2, 3, 5], childExtendsParent: true, maxDepth: 4 };
const CSV = [
  "2;K2;;ASSET;ne", "20;G20;2;ASSET;ne", "201;S201;20;ASSET;ne", "20101;Potraživanja održavanje;201;ASSET;da", "20102;Potraživanja rezerva;201;ASSET;da",
  "24;G24;2;ASSET;ne", "241;S241;24;ASSET;ne", "24101;Tekući račun;241;ASSET;da",
  "3;K3;;EQUITY;ne", "34;G34;3;EQUITY;ne", "340;S340;34;EQUITY;ne", "34001;Višak ranijih godina;340;EQUITY;da",
  "4;K4;;LIABILITY;ne", "43;G43;4;LIABILITY;ne", "430;S430;43;LIABILITY;ne", "43001;Avansi;430;LIABILITY;da", "43002;Neidentifikovane;430;LIABILITY;da",
  "432;S432;43;LIABILITY;ne", "43201;Dobavljači;432;LIABILITY;da",
  "49;G49;4;LIABILITY;ne", "499;S499;49;LIABILITY;ne", "49901;Razgraničeno održavanje;499;LIABILITY;da", "49902;Rezerva;499;LIABILITY;da",
  "5;K5;;EXPENSE;ne", "55;G55;5;EXPENSE;ne", "550;S550;55;EXPENSE;ne", "55001;Troškovi održavanja;550;EXPENSE;da", "55002;Bankarske provizije;550;EXPENSE;da",
].join("\n");

const TODAY = toZonedDateIso(new Date());
const YEAR = TODAY.slice(0, 4);
const START = `${YEAR}-01-01`;
const PREV = `${Number(YEAR) - 1}-12-15`;
const VF = `${Number(YEAR) - 1}-01-01`;
const at = (iso: string) => new Date(`${iso}T10:00:00Z`);

describe("B4: cijeli tok knjiženja", () => {
  let sa: Actor;
  let f: Fixture;
  let acc: (code: string) => string;
  let odrz: string;
  let rez: string;
  let reserve: string;

  async function invoice(amount: string, chargeTypeId: string, debtorId = f.ownerA.id, issueDate = new Date()) {
    const inv = await prisma.invoice.create({
      data: {
        zevId: f.zev.id, number: uid("F"), unitId: f.u1.id, debtorId, issueDate, dueDate: issueDate, total: amount, status: "ISSUED",
        lines: { create: [{ description: "L", calcSnapshot: {}, amount, order: 0, chargeTypeId }] },
      },
    });
    await ev.afterLedgerChange(f.zev.id, f.accountant.userId);
    return inv;
  }

  beforeAll(async () => {
    sa = await createSuperAdminActor("e2e-sa");
    f = await createFixture("e2e");
    const tpl = await coa.createTemplate(sa, { key: `e2e-${uid("t").toLowerCase()}`, name: "E2E", jurisdiction: "RS", source: "Test", codeRules: RULES });
    expect((await coa.importTemplateAccounts(sa, tpl.id, CSV)).ok).toBe(true);
    await coa.setTemplateStatus(sa, tpl.id, "REVIEWED", { reviewedBy: "N.N.", reviewedAt: "2026-01-01" });
    await coa.assignChart(f.accountant, tpl.id);
    await coa.activateChart(f.accountant);
    await coa.openFiscalYear(f.accountant, { label: YEAR, startDate: START, endDate: `${YEAR}-12-31`, periodicity: "MONTHLY" });
    await lc.applyStarterSetup(f.accountant);
    const chart = (await coa.getZevChart(f.accountant))!;
    acc = (code: string) => chart.accounts.find((a) => a.code === code)!.id;
    const purposes = await lc.listPurposes(f.accountant);
    reserve = purposes.find((p) => p.isCommonReserve)!.id;
    await lc.setControlAccount(f.accountant, { role: "MONEY_ACCOUNT", moneyAccountId: f.account.id, accountId: acc("24101"), validFrom: VF });
    await lc.setControlAccount(f.accountant, { role: "OWNER_RECEIVABLE", purposeId: purposes.find((p) => !p.isCommonReserve)!.id, accountId: acc("20101"), validFrom: VF });
    await lc.setControlAccount(f.accountant, { role: "OWNER_RECEIVABLE", purposeId: reserve, accountId: acc("20102"), validFrom: VF });
    await lc.setControlAccount(f.accountant, { role: "OWNER_ADVANCE", accountId: acc("43001"), validFrom: VF });
    await lc.setControlAccount(f.accountant, { role: "UNIDENTIFIED_RECEIPTS", accountId: acc("43002"), validFrom: VF });
    await lc.setControlAccount(f.accountant, { role: "SUPPLIER_PAYABLE", accountId: acc("43201"), validFrom: VF });
    const types = await prisma.chargeType.findMany({ where: { zevId: f.zev.id } });
    odrz = types.find((t) => t.code === "ODRZ")!.id;
    rez = types.find((t) => t.code === "REZ")!.id;
    const r = await lc.createRuleDraft(f.accountant, { kind: "CHARGE_ISSUED", chargeTypeId: odrz, counterAccountId: acc("49901"), validFrom: VF, reason: "Akontacija" });
    await lc.confirmRule(f.accountant, r.id, "N.N., računovođa");

    // Evidencija prethodne godine — ide u početno stanje.
    await invoice("80.00", odrz, f.ownerA.id, at(PREV));
    const oldPay = await pay.enterPayment(f.accountant, { accountId: f.account.id, date: at(PREV), amount: "30.00", payerId: f.ownerA.id });
    await pay.enterPayment(f.accountant, { accountId: f.account.id, date: at(PREV), amount: "12.00", payerNameRaw: "Nepoznat" });
    const supplierId = (await exp.createSupplier(f.accountant, { name: `Lift-${f.t}` })).id;
    await exp.createExpense(f.accountant, { supplierId, amount: "70.00", invoiceDate: at(PREV), invoiceNumber: uid("R") });
    void oldPay;
  });

  it("proba, pa aktivacija sa istim ishodom", async () => {
    const before = await prisma.journalLine.count({ where: { zevId: f.zev.id } });
    const dry = (await dr.runDryRun(f.accountant, { startDate: START }))!;
    expect(await prisma.journalLine.count({ where: { zevId: f.zev.id } })).toBe(before);
    expect(dry.opening.ok).toBe(true);
    expect(dry.recon!.ok).toBe(true);

    const d = await ob.prepareOpening(f.accountant, { startDate: START });
    const r = await ob.reconcileOpening(f.accountant, d.id);
    const diff = Number(r.debit) - Number(r.credit);
    await ob.saveOpeningManualLines(f.accountant, d.id, {
      description: "PS", lines: [diff > 0 ? { accountId: acc("34001"), credit: diff.toFixed(2) } : { accountId: acc("34001"), debit: (-diff).toFixed(2) }],
    });
    await j.postEntry(f.accountant, d.id);
    expect(toZonedDateIso((await ev.ledgerStart(prisma, f.zev.id))!)).toBe(START);
  });

  it("rad svim vrstama događaja, čekanja koja se kasnije razriješe, kasno unesena uplata, zatvoren period", async () => {
    // Vlasnici: zaduženje, uplata, raspored; rezerva čeka dok šema i pravilo nisu potvrđeni.
    const a = await invoice("100.00", odrz);
    const z = await invoice("40.00", rez, f.ownerB.id);
    const p1 = await pay.enterPayment(f.accountant, { accountId: f.account.id, date: new Date(), amount: "60.00", payerId: f.ownerA.id });
    await pay.allocatePayment(f.accountant, { paymentId: p1.id, invoiceId: a.id });
    const p2 = await pay.enterPayment(f.accountant, { accountId: f.account.id, date: new Date(), amount: "25.00", payerNameRaw: "Bez imena" });
    await pay.allocatePayment(f.accountant, { paymentId: p2.id, invoiceId: a.id }); // identifikacija + raspored
    expect((await prisma.accountingEvent.findFirstOrThrow({ where: { sourceId: z.id, kind: "CHARGE_ISSUED" } })).status).not.toBe("POSTED");

    await lc.recordSchemaApproval(f.accountant, { schema: "COMMON_RESERVE_CLASSIFICATION", description: "D 20102 / P 49902", expertName: "N.N., ovlašćeni računovođa", approvedAt: START });
    const rr = await lc.createRuleDraft(f.accountant, { kind: "CHARGE_ISSUED", chargeTypeId: rez, counterAccountId: acc("49902"), validFrom: VF, reason: "Rezerva" });
    await lc.confirmRule(f.accountant, rr.id, "N.N., računovođa");
    await ev.processPending(f.accountant);
    expect((await prisma.accountingEvent.findFirstOrThrow({ where: { sourceId: z.id, kind: "CHARGE_ISSUED" } })).status).toBe("POSTED");

    // Storna: faktura i uplata.
    const c = await invoice("15.00", odrz, f.ownerC.id);
    await billing.cancelInvoice(f.accountant, c.id, "Greška");
    const p3 = await pay.enterPayment(f.accountant, { accountId: f.account.id, date: new Date(), amount: "9.00", payerId: f.ownerC.id });
    await pay.reversePayment(f.accountant, p3.id, "Duplikat");

    // Dobavljač i ručni rashod po pravilu kategorije.
    const supplierId = (await prisma.supplier.findFirstOrThrow({ where: { zevId: f.zev.id } })).id;
    const cat = (await fin.ensureCategory(f.accountant, `Održavanje-${f.t}`, "EXPENSE")).id;
    const fee = (await fin.ensureCategory(f.accountant, `Provizija-${f.t}`, "EXPENSE")).id;
    for (const [kind, category, account] of [["SUPPLIER_INVOICE", cat, "55001"], ["CASH_EXPENSE", fee, "55002"]] as const) {
      const d = await lc.createRuleDraft(f.accountant, { kind, categoryId: category, counterAccountId: acc(account), validFrom: VF, reason: "Test" });
      await lc.confirmRule(f.accountant, d.id, "N.N., računovođa");
    }
    const e = await exp.createExpense(f.accountant, { supplierId, categoryId: cat, amount: "45.00", invoiceDate: new Date(), invoiceNumber: uid("R") });
    await exp.payExpense(f.accountant, { expenseId: e.id, accountId: f.account.id, date: new Date(), amount: "45.00" });
    await fin.enterTransaction(f.accountant, { accountId: f.account.id, date: new Date(), type: "EXPENSE", amount: "2.50", categoryId: fee, counterpartyName: "Banka" });

    // Kasno unesena uplata iz prethodne godine (B4-Q5 (a)).
    const late = await pay.enterPayment(f.accountant, { accountId: f.account.id, date: at(PREV), amount: "18.00", payerId: f.ownerB.id });
    const le = await prisma.accountingEvent.findFirstOrThrow({ where: { sourceId: late.id, kind: "PAYMENT_RECEIVED" }, include: { journalEntry: true } });
    expect(le.status).toBe("POSTED");
    expect(toZonedDateIso(le.journalEntry!.postingDate)).toBe(START);

    // Zatvoren period (ako tekući mjesec nije januar): uplata sa datumom u januaru čeka, pa ide u tekući period.
    if (TODAY.slice(5, 7) !== "01") {
      const jan = await prisma.fiscalPeriod.findFirstOrThrow({ where: { zevId: f.zev.id, startDate: new Date(`${START}T00:00:00Z`) } });
      await j.closePeriod(f.accountant, jan.id);
      const pj = await pay.enterPayment(f.accountant, { accountId: f.account.id, date: at(`${YEAR}-01-20`), amount: "7.00", payerId: f.ownerC.id });
      const ej = await prisma.accountingEvent.findFirstOrThrow({ where: { sourceId: pj.id, kind: "PAYMENT_RECEIVED" } });
      expect(ej.status).toBe("WAITING_PERIOD");
      expect((await rc.reconcileAt(f.accountant, TODAY)).ok).toBe(true); // čeka — objašnjeno
      await ev.postEventIntoOpenPeriod(f.accountant, ej.id);
      expect((await prisma.accountingEvent.findUniqueOrThrow({ where: { id: ej.id } })).status).toBe("POSTED");
    }
  });

  it("na kraju: bruto bilans uravnotežen, usklađivanje bez razlike, kartica vlasnika = dug iz evidencije, dnevnik uravnotežen", async () => {
    const range = { from: START, to: `${YEAR}-12-31` };
    const tb = await rep.trialBalance(f.accountant, range);
    expect(tb.balanced).toBe(true);
    const recon = await rc.reconcileAt(f.accountant, TODAY);
    expect(recon.ok).toBe(true);
    expect(recon.rows.every((r) => r.ledger === r.analytics)).toBe(true);
    const book = await rep.journalBook(f.accountant, range);
    expect(book.debit).toBe(book.credit);

    // Kartica vlasnika A na kontu potraživanja = otvoreno po fakturama iz evidencije (80 iz prošle godine + 100 − 85).
    const cards = await rep.dimensionCard(f.accountant, { ...range, dim: "party", id: f.ownerA.id });
    const receivable = cards.find((c) => c.account.code === "20101")!;
    const open = await rc.openItemsAt(f.accountant, TODAY);
    expect(receivable.closing).toBe(open.owners.find((g) => g.id === f.ownerA.id)!.total);
    expect(receivable.closing).toBe("95.00");
  });
});
