// Faza B3b — usklađivanje i pregledi (Plans/kontni-plan-b3-izvjestaji-plan.md §4, §7).
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
import * as rc from "@/server/services/ledgerReconciliation";
import { toZonedDateIso } from "@/lib/i18n";

const RULES = { digitsOnly: true, allowedLengths: [1, 2, 3, 5], childExtendsParent: true, maxDepth: 4 };
const CSV = [
  "2;K2;;ASSET;ne", "20;G20;2;ASSET;ne", "201;S201;20;ASSET;ne", "20101;Potraživanja održavanje;201;ASSET;da", "20102;Potraživanja rezerva;201;ASSET;da",
  "24;G24;2;ASSET;ne", "241;S241;24;ASSET;ne", "24101;Tekući račun;241;ASSET;da", "28;G28;2;ASSET;ne", "280;S280;28;ASSET;ne", "28001;Razgraničenja;280;ASSET;da",
  "3;K3;;EQUITY;ne", "34;G34;3;EQUITY;ne", "340;S340;34;EQUITY;ne", "34001;Višak ranijih godina;340;EQUITY;da",
  "4;K4;;LIABILITY;ne", "43;G43;4;LIABILITY;ne", "430;S430;43;LIABILITY;ne", "43001;Avansi;430;LIABILITY;da", "43002;Neidentifikovane;430;LIABILITY;da",
  "432;S432;43;LIABILITY;ne", "43201;Dobavljači;432;LIABILITY;da",
  "49;G49;4;LIABILITY;ne", "499;S499;49;LIABILITY;ne", "49901;Razgraničeno održavanje;499;LIABILITY;da",
  "5;K5;;EXPENSE;ne", "55;G55;5;EXPENSE;ne", "550;S550;55;EXPENSE;ne", "55002;Bankarske provizije;550;EXPENSE;da",
  "6;K6;;INCOME;ne", "66;G66;6;INCOME;ne", "660;S660;66;INCOME;ne", "66001;Prihod od kamata;660;INCOME;da",
].join("\n");

const TODAY = toZonedDateIso(new Date());
const YEAR = TODAY.slice(0, 4);
const START = `${YEAR}-01-01`;
const VF = `${Number(YEAR) - 1}-01-01`;
const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000);

type Ctx = { acc: (code: string) => string; odrz: string; rez: string };

async function setup(sa: Actor, f: Fixture, tag: string): Promise<Ctx> {
  const tpl = await coa.createTemplate(sa, { key: `b3b-${uid(tag).toLowerCase()}`, name: "B3b", jurisdiction: "RS", source: "Test", codeRules: RULES });
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
  const types = await prisma.chargeType.findMany({ where: { zevId: f.zev.id } });
  const odrz = types.find((t) => t.code === "ODRZ")!.id;
  const rez = types.find((t) => t.code === "REZ")!.id;
  const r = await lc.createRuleDraft(f.accountant, { kind: "CHARGE_ISSUED", chargeTypeId: odrz, counterAccountId: acc("49901"), validFrom: VF, reason: "Akontacija" });
  await lc.confirmRule(f.accountant, r.id, "N.N., računovođa");
  return { acc, odrz, rez };
}

async function postOpening(f: Fixture, ctx: Ctx) {
  const d = await ob.prepareOpening(f.accountant, { startDate: START });
  const r = await ob.reconcileOpening(f.accountant, d.id);
  const diff = Number(r.debit) - Number(r.credit);
  const lines: j.JournalLineInput[] = [{ accountId: ctx.acc("28001"), debit: "100.00" }, { accountId: ctx.acc("34001"), credit: "100.00" }];
  if (diff > 0) lines.push({ accountId: ctx.acc("34001"), credit: diff.toFixed(2) });
  if (diff < 0) lines.push({ accountId: ctx.acc("34001"), debit: (-diff).toFixed(2) });
  await ob.saveOpeningManualLines(f.accountant, d.id, { description: "PS", lines });
  return j.postEntry(f.accountant, d.id);
}

async function invoice(f: Fixture, amount: string, chargeTypeId: string, opts: { debtorId?: string; dueDate?: Date } = {}) {
  const inv = await prisma.invoice.create({
    data: {
      zevId: f.zev.id, number: uid("F"), unitId: f.u1.id, debtorId: opts.debtorId ?? f.ownerA.id, issueDate: new Date(), dueDate: opts.dueDate ?? new Date(),
      total: amount, status: "ISSUED", lines: { create: [{ description: "L", calcSnapshot: {}, amount, order: 0, chargeTypeId }] },
    },
  });
  await ev.afterLedgerChange(f.zev.id, f.accountant.userId);
  return inv;
}

const row = (r: Awaited<ReturnType<typeof rc.reconcileAt>>, role: string) => r.rows.find((x) => x.role === role)!;

describe("B3b: usklađivanje i pregledi", () => {
  let sa: Actor;
  let f: Fixture;
  let ctx: Ctx;

  beforeAll(async () => {
    sa = await createSuperAdminActor("b3b-sa");
    f = await createFixture("b3b");
    ctx = await setup(sa, f, "b3b");
  });

  it("bez početnog stanja usklađivanje nije aktivno", async () => {
    const r = await rc.reconcileAt(f.accountant, TODAY);
    expect(r).toMatchObject({ active: false, start: null, rows: [] });
  });

  it("poslije početnog stanja i proknjiženih događaja sve je usklađeno", async () => {
    await postOpening(f, ctx);
    const inv = await invoice(f, "50.00", ctx.odrz);
    const p = await pay.enterPayment(f.accountant, { accountId: f.account.id, date: new Date(), amount: "60.00", payerId: f.ownerA.id });
    await pay.allocatePayment(f.accountant, { paymentId: p.id, invoiceId: inv.id });
    await pay.enterPayment(f.accountant, { accountId: f.account.id, date: new Date(), amount: "7.00", payerNameRaw: "Nepoznat platilac" });
    const r = await rc.reconcileAt(f.accountant, TODAY);
    expect(r.active).toBe(true);
    expect(r.ok).toBe(true);
    expect(row(r, "MONEY_ACCOUNT")).toMatchObject({ ledger: "1067.00", operational: "1067.00", difference: "0.00", accounts: ["24101"] }) // 1.000 početno stanje računa + 67;
    expect(row(r, "OWNER_ADVANCE")).toMatchObject({ ledger: "10.00", analytics: "10.00", operational: "10.00" });
    expect(row(r, "UNIDENTIFIED_RECEIPTS")).toMatchObject({ ledger: "7.00", operational: "7.00" });
  });

  it("događaj koji čeka objašnjava razliku; neobjašnjen ostatak je nula", async () => {
    // Rezerva bez pravila (i kapije) — zaduženje čeka, faktura je izdata.
    const inv = await invoice(f, "20.00", ctx.rez, { dueDate: daysAgo(45) });
    expect((await prisma.accountingEvent.findFirstOrThrow({ where: { sourceId: inv.id, kind: "CHARGE_ISSUED" } })).status).not.toBe("POSTED");
    const r = await rc.reconcileAt(f.accountant, TODAY);
    expect(row(r, "OWNER_RECEIVABLE")).toMatchObject({ difference: "20.00", waiting: "20.00", waitingCount: 1, unexplained: "0.00", ok: true });
    expect(r.ok).toBe(true);
  });

  it("avansi po vlasniku i neidentifikovane po uplati; raspored koji čeka objašnjava razliku vlasnika", async () => {
    // Raspored na fakturu čije zaduženje čeka (rezerva) i sam čeka: avans je u knjizi, a u evidenciji je raspoređen.
    const inv = await invoice(f, "25.00", ctx.rez, { debtorId: f.ownerB.id });
    const p = await pay.enterPayment(f.accountant, { accountId: f.account.id, date: new Date(), amount: "25.00", payerId: f.ownerB.id });
    await pay.allocatePayment(f.accountant, { paymentId: p.id, invoiceId: inv.id });
    const a = await rc.advancesAt(f.accountant, TODAY);
    expect(a.advances.find((x) => x.partyId === f.ownerA.id)).toMatchObject({ ledger: "10.00", operational: "10.00", waiting: "0.00", ok: true });
    expect(a.advances.find((x) => x.partyId === f.ownerB.id)).toMatchObject({ ledger: "25.00", operational: "0.00", waiting: "-25.00", unexplained: "0.00", ok: true });
    expect((await rc.reconcileAt(f.accountant, TODAY)).ok).toBe(true);
    expect(a.unidentified).toEqual([expect.objectContaining({ payer: "Nepoznat platilac", ledger: "7.00", operational: "7.00", ok: true })]);
    expect(a.unidentified[0].paymentId).toBeTruthy();
    expect(a.unidentifiedTotal).toEqual({ ledger: "7.00", operational: "7.00" });
  });

  it("otvorene stavke po starosti dospijeća, sa nalogom proknjižene fakture i kontrolnim zbirom", async () => {
    const posted = await invoice(f, "30.00", ctx.odrz, { debtorId: f.ownerB.id, dueDate: daysAgo(100) });
    const o = await rc.openItemsAt(f.accountant, TODAY);
    const a = o.owners.find((g) => g.id === f.ownerA.id)!;
    expect(a.buckets).toMatchObject({ d60: "20.00", over90: "0.00" });
    expect(a.items[0].entryNumber).toBeNull(); // rezerva čeka — nema naloga
    const b = o.owners.find((g) => g.id === f.ownerB.id)!;
    expect(b.buckets.over90).toBe("30.00");
    expect(b.items[0]).toMatchObject({ id: posted.id, days: 100 });
    expect(b.items[0].entryNumber).toMatch(/^NK-/);
    expect(o.ownersTotal.total).toBe("50.00");
    // Knjiga ima samo proknjiženo (30); razliku (20) objašnjava usklađivanje.
    expect(o.control).toMatchObject({ receivableLedger: "30.00", receivableCorrections: "0.00" });
  });

  it("godišnji pregled iz knjige: prihodi, rashodi, rezultat i namjene", async () => {
    const d1 = await j.saveDraft(f.accountant, { documentDate: TODAY, postingDate: TODAY, description: "Kamata", lines: [{ accountId: ctx.acc("28001"), debit: "15.00" }, { accountId: ctx.acc("66001"), credit: "15.00" }] });
    await j.postEntry(f.accountant, d1.id);
    const d2 = await j.saveDraft(f.accountant, { documentDate: TODAY, postingDate: TODAY, description: "Provizija", lines: [{ accountId: ctx.acc("55002"), debit: "4.00" }, { accountId: ctx.acc("28001"), credit: "4.00" }] });
    await j.postEntry(f.accountant, d2.id);
    const y = await rc.annualOverview(f.accountant, YEAR);
    expect(y.year).toMatchObject({ label: YEAR, from: START });
    expect(y.income).toEqual([expect.objectContaining({ code: "66001", amount: "15.00", group: "660 S660" })]);
    expect(y.expense).toEqual([expect.objectContaining({ code: "55002", amount: "4.00" })]);
    expect(y.result).toBe("11.00");
    expect(y.purposes.length).toBeGreaterThan(0);
  });

  it("promjena evidencije bez događaja je neobjašnjena razlika", async () => {
    // Zaobilazi servis (nema afterLedgerChange) — kao greška u evidenciji koju knjiga ne zna.
    await prisma.finTransaction.create({ data: { zevId: f.zev.id, accountId: f.account.id, date: new Date(), type: "INCOME", amount: "3.00" } });
    const r = await rc.reconcileAt(f.accountant, TODAY);
    expect(row(r, "MONEY_ACCOUNT")).toMatchObject({ difference: "3.00", waiting: "0.00", unexplained: "3.00", ok: false });
    expect(r.ok).toBe(false);
    // Kad se događaj izvede (čeka kategoriju/pravilo), razlika postaje objašnjena.
    await ev.afterLedgerChange(f.zev.id, f.accountant.userId);
    expect(row(await rc.reconcileAt(f.accountant, TODAY), "MONEY_ACCOUNT")).toMatchObject({ waiting: "3.00", unexplained: "0.00", ok: true });
  });

  it("CSV usklađivanja u auditu; vlasnik nema pristup; tuđi ZEV ne vidi ništa", async () => {
    const csv = await rc.reconciliationCsv(f.accountant, "uskladjivanje", { asOf: TODAY });
    expect(csv.split("\r\n")[0]).toContain("Neobjašnjeno");
    expect(await prisma.auditEvent.findFirst({ where: { zevId: f.zev.id, action: "ledger.report.export", targetId: "uskladjivanje" } })).toBeTruthy();
    await expect(rc.reconcileAt(f.actorA, TODAY)).rejects.toThrow();
    const other = await createFixture("b3b-o");
    expect((await rc.reconcileAt(other.accountant, TODAY)).active).toBe(false);
    expect((await rc.advancesAt(other.accountant, TODAY)).advances).toEqual([]);
  });
});
