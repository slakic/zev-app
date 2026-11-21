// Faza B2a — automatsko knjiženje događaja vlasnika (Plans/kontni-plan-b2-automatsko-knjizenje-plan.md §3, §6).
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
import * as billing from "@/server/services/billing";
import { toZonedDateIso } from "@/lib/i18n";

const RULES = { digitsOnly: true, allowedLengths: [1, 2, 3, 5], childExtendsParent: true, maxDepth: 4 };
const CSV = [
  "2;K2;;ASSET;ne", "20;G20;2;ASSET;ne", "201;S201;20;ASSET;ne", "20101;Potraživanja održavanje;201;ASSET;da", "20102;Potraživanja rezerva;201;ASSET;da",
  "24;G24;2;ASSET;ne", "241;S241;24;ASSET;ne", "24101;Tekući račun;241;ASSET;da", "28;G28;2;ASSET;ne", "280;S280;28;ASSET;ne", "28001;Razgraničenja;280;ASSET;da",
  "3;K3;;EQUITY;ne", "34;G34;3;EQUITY;ne", "340;S340;34;EQUITY;ne", "34001;Višak ranijih godina;340;EQUITY;da",
  "4;K4;;LIABILITY;ne", "43;G43;4;LIABILITY;ne", "430;S430;43;LIABILITY;ne", "43001;Avansi;430;LIABILITY;da", "43002;Neidentifikovane;430;LIABILITY;da",
  "432;S432;43;LIABILITY;ne", "43201;Dobavljači;432;LIABILITY;da",
  "49;G49;4;LIABILITY;ne", "499;S499;49;LIABILITY;ne", "49901;Razgraničeno održavanje;499;LIABILITY;da", "49902;Razgraničena rezerva;499;LIABILITY;da",
].join("\n");

const TODAY = toZonedDateIso(new Date());
const YEAR = TODAY.slice(0, 4);
const START = `${YEAR}-01-01`;

type Ctx = { acc: (code: string) => string; odrz: string; rez: string };

async function setup(sa: Actor, f: Fixture, tag: string): Promise<Ctx> {
  const tpl = await coa.createTemplate(sa, { key: `b2-${uid(tag).toLowerCase()}`, name: "B2", jurisdiction: "RS", source: "Test", codeRules: RULES });
  expect((await coa.importTemplateAccounts(sa, tpl.id, CSV)).ok).toBe(true);
  await coa.setTemplateStatus(sa, tpl.id, "REVIEWED", { reviewedBy: "N.N.", reviewedAt: "2026-01-01" });
  await coa.assignChart(f.accountant, tpl.id);
  await coa.activateChart(f.accountant);
  await coa.openFiscalYear(f.accountant, { label: YEAR, startDate: START, endDate: `${YEAR}-12-31`, periodicity: "MONTHLY" });
  const next = String(Number(YEAR) + 1);
  await coa.openFiscalYear(f.accountant, { label: next, startDate: `${next}-01-01`, endDate: `${next}-12-31`, periodicity: "MONTHLY" });
  await lc.applyStarterSetup(f.accountant);
  const chart = (await coa.getZevChart(f.accountant))!;
  const acc = (code: string) => chart.accounts.find((a) => a.code === code)!.id;
  const purposes = await lc.listPurposes(f.accountant);
  const maint = purposes.find((p) => !p.isCommonReserve)!;
  const reserve = purposes.find((p) => p.isCommonReserve)!;
  const vf = `${Number(YEAR) - 1}-01-01`;
  await lc.setControlAccount(f.accountant, { role: "MONEY_ACCOUNT", moneyAccountId: f.account.id, accountId: acc("24101"), validFrom: vf });
  await lc.setControlAccount(f.accountant, { role: "OWNER_RECEIVABLE", purposeId: maint.id, accountId: acc("20101"), validFrom: vf });
  await lc.setControlAccount(f.accountant, { role: "OWNER_RECEIVABLE", purposeId: reserve.id, accountId: acc("20102"), validFrom: vf });
  await lc.setControlAccount(f.accountant, { role: "OWNER_ADVANCE", accountId: acc("43001"), validFrom: vf });
  await lc.setControlAccount(f.accountant, { role: "UNIDENTIFIED_RECEIPTS", accountId: acc("43002"), validFrom: vf });
  await lc.setControlAccount(f.accountant, { role: "SUPPLIER_PAYABLE", accountId: acc("43201"), validFrom: vf });
  const types = await prisma.chargeType.findMany({ where: { zevId: f.zev.id } });
  const odrz = types.find((t) => t.code === "ODRZ")!.id;
  const rez = types.find((t) => t.code === "REZ")!.id;
  const r = await lc.createRuleDraft(f.accountant, { kind: "CHARGE_ISSUED", chargeTypeId: odrz, counterAccountId: acc("49901"), validFrom: vf, reason: "Akontacija (R-3)" });
  await lc.confirmRule(f.accountant, r.id, "N.N., računovođa");
  return { acc, odrz, rez };
}

/** Početno stanje na 1.1. tekuće godine (prazna evidencija + par ručnih stavki) — uključuje knjiženje. */
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

async function invoice(f: Fixture, lines: { amount: string; chargeTypeId: string | null }[], debtorId = f.ownerA.id) {
  const total = lines.reduce((s, l) => s + Number(l.amount), 0).toFixed(2);
  const inv = await prisma.invoice.create({
    data: {
      zevId: f.zev.id, number: uid("F"), unitId: f.u1.id, debtorId, issueDate: new Date(), dueDate: new Date(), total, status: "ISSUED",
      lines: { create: lines.map((l, i) => ({ description: `L${i}`, calcSnapshot: {}, amount: l.amount, order: i, chargeTypeId: l.chargeTypeId })) },
    },
  });
  await ev.afterLedgerChange(f.zev.id, f.accountant.userId);
  return inv;
}

const event = (zevId: string, sourceId: string, kind: string) =>
  prisma.accountingEvent.findUniqueOrThrow({ where: { zevId_sourceType_sourceId_kind: { zevId, sourceType: kind.startsWith("CHARGE") ? "Invoice" : kind.startsWith("PAYMENT_R") ? "Payment" : "PaymentAllocation", sourceId, kind: kind as never } } });

async function entryLines(entryId: string) {
  const rows = await prisma.journalLine.findMany({ where: { entryId }, include: { account: { select: { code: true } } }, orderBy: { order: "asc" } });
  return rows.map((l) => ({ code: l.account.code, d: Number(l.debit), p: Number(l.credit), party: l.partyId, purpose: l.purposeId, rule: l.ruleId }));
}

/** Saldo konta u knjizi (sve proknjiženo, D − P). */
async function ledger(zevId: string, accountId: string, partyId?: string) {
  const rows = await prisma.journalLine.findMany({ where: { zevId, accountId, entry: { status: "POSTED" }, ...(partyId ? { partyId } : {}) } });
  return rows.reduce((s, l) => s + Number(l.debit) - Number(l.credit), 0);
}

describe("B2a: automatsko knjiženje događaja vlasnika", () => {
  let sa: Actor;
  let f: Fixture;
  let ctx: Ctx;

  beforeAll(async () => {
    sa = await createSuperAdminActor("b2-sa");
    f = await createFixture("b2");
    ctx = await setup(sa, f, "b2");
  });

  it("bez proknjiženog početnog stanja knjiženje nije aktivno — nema događaja", async () => {
    await pay.enterPayment(f.accountant, { accountId: f.account.id, date: new Date(), amount: "5.00", payerId: f.ownerC.id });
    expect(await ev.ledgerStart(prisma, f.zev.id)).toBeNull();
    expect(await prisma.accountingEvent.count({ where: { zevId: f.zev.id } })).toBe(0);
  });

  it("proknjiženo početno stanje uključuje knjiženje; ranija uplata ide u događaje od datuma početka", async () => {
    await postOpening(f, ctx);
    expect(toZonedDateIso((await ev.ledgerStart(prisma, f.zev.id))!)).toBe(START);
    // Uplata od 5 KM iz prvog testa je od danas (≥ početak) — upisana i proknjižena odmah po početnom stanju.
    const e = await prisma.accountingEvent.findFirstOrThrow({ where: { zevId: f.zev.id, kind: "PAYMENT_RECEIVED" } });
    expect(e.status).toBe("POSTED");
  });

  it("zaduženje: D potraživanja (vlasnik, namjena) / P protivkonto pravila, sa ruleId", async () => {
    const inv = await invoice(f, [{ amount: "50.00", chargeTypeId: ctx.odrz }]);
    const e = await event(f.zev.id, inv.id, "CHARGE_ISSUED");
    expect(e.status).toBe("POSTED");
    const lines = await entryLines(e.journalEntryId!);
    expect(lines.find((l) => l.code === "20101")).toMatchObject({ d: 50, party: f.ownerA.id });
    expect(lines.find((l) => l.code === "49901")!.p).toBe(50);
    expect(lines.find((l) => l.code === "49901")!.rule).toBeTruthy();
    const entry = await prisma.journalEntry.findUniqueOrThrow({ where: { id: e.journalEntryId! } });
    expect(entry.kind).toBe("AUTO");
    expect(entry.number).toMatch(/^NK-/);
  });

  it("stavka bez vrste i rezerva bez kapije čekaju sa razlogom; faktura je izdata normalno", async () => {
    const noType = await invoice(f, [{ amount: "10.00", chargeTypeId: null }]);
    expect(await event(f.zev.id, noType.id, "CHARGE_ISSUED")).toMatchObject({ status: "WAITING_RULE" });
    const reserve = await invoice(f, [{ amount: "20.00", chargeTypeId: ctx.rez }]);
    const e = await event(f.zev.id, reserve.id, "CHARGE_ISSUED");
    expect(e.status).toBe("WAITING_SCHEMA");
    expect(e.statusDetail).toMatch(/rezerv/);
    // Storno fakture bez vrste: prethodnik nije proknjižen → čeka.
    await billing.cancelInvoice(f.accountant, noType.id, "Test");
    expect(await event(f.zev.id, noType.id, "CHARGE_CANCELLED")).toMatchObject({ status: "WAITING_PREDECESSOR" });
  });

  it("uplata → avans; raspored → D avans / P potraživanja; storno rasporeda je tačna suprotnost sa vezom", async () => {
    const inv = await invoice(f, [{ amount: "40.00", chargeTypeId: ctx.odrz }], f.ownerB.id);
    const p = await pay.enterPayment(f.accountant, { accountId: f.account.id, date: new Date(), amount: "40.00", payerId: f.ownerB.id });
    const rec = await event(f.zev.id, p.id, "PAYMENT_RECEIVED");
    expect(await entryLines(rec.journalEntryId!)).toEqual(expect.arrayContaining([expect.objectContaining({ code: "24101", d: 40 }), expect.objectContaining({ code: "43001", p: 40, party: f.ownerB.id })]));
    const a = await pay.allocatePayment(f.accountant, { paymentId: p.id, invoiceId: inv.id });
    const al = await event(f.zev.id, a.id, "PAYMENT_ALLOCATED");
    expect(await entryLines(al.journalEntryId!)).toEqual(expect.arrayContaining([expect.objectContaining({ code: "43001", d: 40 }), expect.objectContaining({ code: "20101", p: 40, party: f.ownerB.id })]));
    const r = await pay.reverseAllocation(f.accountant, a.id, "Greška");
    const rev = await event(f.zev.id, r.id, "ALLOCATION_REVERSED");
    expect(rev.status).toBe("POSTED");
    const revEntry = await prisma.journalEntry.findUniqueOrThrow({ where: { id: rev.journalEntryId! } });
    expect(revEntry.reversalOfId).toBe(al.journalEntryId);
    expect(await entryLines(rev.journalEntryId!)).toEqual(expect.arrayContaining([expect.objectContaining({ code: "43001", p: 40 }), expect.objectContaining({ code: "20101", d: 40 })]));
    await expect(j.reverseEntry(f.accountant, al.journalEntryId!, { reason: "x", postingDate: TODAY })).rejects.toThrow(/Automatski nalog/);
  });

  it("neidentifikovana uplata na fakturu: identifikacija pa raspored; storno uplate vraća sve na neidentifikovane", async () => {
    const inv = await invoice(f, [{ amount: "30.00", chargeTypeId: ctx.odrz }], f.ownerC.id);
    const p = await pay.enterPayment(f.accountant, { accountId: f.account.id, date: new Date(), amount: "30.00", payerNameRaw: "Nepoznat" });
    const a = await pay.allocatePayment(f.accountant, { paymentId: p.id, invoiceId: inv.id });
    const id = await event(f.zev.id, a.id, "PAYMENT_IDENTIFIED");
    expect(await entryLines(id.journalEntryId!)).toEqual(expect.arrayContaining([expect.objectContaining({ code: "43002", d: 30 }), expect.objectContaining({ code: "43001", p: 30, party: f.ownerC.id })]));
    expect((await event(f.zev.id, a.id, "PAYMENT_ALLOCATED")).status).toBe("POSTED");

    await pay.reversePayment(f.accountant, p.id, "Duplikat");
    expect((await event(f.zev.id, p.id, "PAYMENT_REVERSED")).status).toBe("POSTED");
    const negative = await prisma.paymentAllocation.findFirstOrThrow({ where: { paymentId: p.id, amount: { lt: 0 } } });
    expect((await event(f.zev.id, negative.id, "ALLOCATION_REVERSED")).status).toBe("POSTED");
    // Ova uplata više ne ostavlja ništa ni na avansu vlasnika C ni na neidentifikovanim.
    const [rows] = [await prisma.journalLine.findMany({ where: { zevId: f.zev.id, entry: { status: "POSTED", sourceId: { in: [p.id, a.id, negative.id] } } } })];
    const byAcc = new Map<string, number>();
    for (const l of rows) byAcc.set(l.accountId, (byAcc.get(l.accountId) ?? 0) + Number(l.debit) - Number(l.credit));
    expect(byAcc.get(ctx.acc("43002")) ?? 0).toBeCloseTo(0);
    expect(byAcc.get(ctx.acc("43001")) ?? 0).toBeCloseTo(0);
  });

  it("djelimičan raspored na fakturu sa više namjena čeka pravilo raspodjele; srazmjerno ga knjiži", async () => {
    await lc.recordSchemaApproval(f.accountant, { schema: "COMMON_RESERVE_CLASSIFICATION", description: "D 201.02 / P 499.02", expertName: "N.N.", approvedAt: TODAY });
    const rr = await lc.createRuleDraft(f.accountant, { kind: "CHARGE_ISSUED", chargeTypeId: ctx.rez, counterAccountId: ctx.acc("49902"), validFrom: `${Number(YEAR) - 1}-01-01`, reason: "Rezerva" });
    await lc.confirmRule(f.accountant, rr.id, "N.N.");
    const inv = await invoice(f, [{ amount: "80.00", chargeTypeId: ctx.odrz }, { amount: "20.00", chargeTypeId: ctx.rez }]);
    expect((await event(f.zev.id, inv.id, "CHARGE_ISSUED")).status).toBe("POSTED");
    const p = await pay.enterPayment(f.accountant, { accountId: f.account.id, date: new Date(), amount: "50.00", payerId: f.ownerA.id });
    const a = await pay.allocatePayment(f.accountant, { paymentId: p.id, invoiceId: inv.id, amount: "50.00" });
    expect((await event(f.zev.id, a.id, "PAYMENT_ALLOCATED")).status).toBe("WAITING_SCHEMA");
    await lc.setAllocationRule(f.accountant, "PROPORTIONAL");
    await ev.processEvents(f.zev.id, f.accountant.userId);
    const al = await event(f.zev.id, a.id, "PAYMENT_ALLOCATED");
    expect(al.status).toBe("POSTED");
    const lines = await entryLines(al.journalEntryId!);
    expect(lines.find((l) => l.code === "20101")!.p).toBe(40);
    expect(lines.find((l) => l.code === "20102")!.p).toBe(10);
    // Rezerva iz prethodnog testa (čekala kapiju) sada se knjiži na „Obradi”.
    expect(await prisma.accountingEvent.count({ where: { zevId: f.zev.id, kind: "CHARGE_ISSUED", status: "WAITING_SCHEMA" } })).toBe(0);
  });

  it("idempotentno: ponovni sync ne dodaje, istovremena obrada ne duplira naloge", async () => {
    expect(await ev.syncEvents(f.zev.id)).toBe(0);
    const inv = await prisma.invoice.create({
      data: { zevId: f.zev.id, number: uid("F"), unitId: f.u1.id, debtorId: f.ownerA.id, issueDate: new Date(), dueDate: new Date(), total: "7.00", status: "ISSUED", lines: { create: [{ description: "x", calcSnapshot: {}, amount: "7.00", chargeTypeId: ctx.odrz }] } },
    });
    await Promise.all([ev.afterLedgerChange(f.zev.id, f.accountant.userId), ev.afterLedgerChange(f.zev.id, f.accountant.userId)]);
    expect(await prisma.journalEntry.count({ where: { zevId: f.zev.id, sourceId: inv.id } })).toBe(1);
  });

  it("zatvoren period: događaj čeka; „Proknjiži u tekući period” zadržava datum dokumenta", async () => {
    const period = await prisma.fiscalPeriod.findFirstOrThrow({ where: { zevId: f.zev.id, startDate: { lte: new Date(`${TODAY}T00:00:00Z`) }, endDate: { gte: new Date(`${TODAY}T00:00:00Z`) } } });
    // Zatvaranje traži da u periodu nema nacrta; zatvaramo direktno (test pravila obrade, ne zatvaranja).
    await prisma.fiscalPeriod.update({ where: { id: period.id }, data: { status: "CLOSED" } });
    try {
      const p = await pay.enterPayment(f.accountant, { accountId: f.account.id, date: new Date(), amount: "3.00", payerId: f.ownerA.id });
      const e = await event(f.zev.id, p.id, "PAYMENT_RECEIVED");
      expect(e.status).toBe("WAITING_PERIOD");
      const done = await ev.processEvent(f.zev.id, e.id, f.accountant.userId, { intoOpenPeriod: true });
      expect(done?.status).toBe("POSTED");
      const entry = await prisma.journalEntry.findUniqueOrThrow({ where: { id: done!.journalEntryId! } });
      expect(toZonedDateIso(entry.documentDate)).toBe(TODAY);
      expect(entry.postingDate > entry.documentDate).toBe(true);
    } finally {
      await prisma.fiscalPeriod.update({ where: { id: period.id }, data: { status: "OPEN" } });
    }
  });

  it("knjiga = evidencija: saldo kontrolnih konta posle svih radnji odgovara stanju iz evidencije", async () => {
    await ev.processEvents(f.zev.id, f.accountant.userId);
    // Faktura bez vrste (storno čeka) je jedini neproknjižen događaj — isključujemo je iz poređenja preko vrste.
    const waiting = await prisma.accountingEvent.findMany({ where: { zevId: f.zev.id, status: { not: "POSTED" } } });
    expect(waiting.every((w) => w.kind === "CHARGE_ISSUED" || w.kind === "CHARGE_CANCELLED")).toBe(true);
    const items = await ob.operationalSnapshot(prisma, f.zev.id, TODAY);
    const op = (role: string, purposeId?: string) => items.filter((i) => i.role === role && (purposeId === undefined || i.purposeId === purposeId)).reduce((s, i) => s + Number(i.amount) * (i.side === "D" ? 1 : -1), 0);
    expect(await ledger(f.zev.id, ctx.acc("24101"))).toBeCloseTo(op("MONEY_ACCOUNT"));
    expect(await ledger(f.zev.id, ctx.acc("43001"))).toBeCloseTo(op("OWNER_ADVANCE"));
    expect(await ledger(f.zev.id, ctx.acc("43002"))).toBeCloseTo(op("UNIDENTIFIED_RECEIPTS"));
    const reserve = (await lc.listPurposes(f.accountant)).find((p) => p.isCommonReserve)!;
    expect(await ledger(f.zev.id, ctx.acc("20102"))).toBeCloseTo(op("OWNER_RECEIVABLE", reserve.id));
  });
});
