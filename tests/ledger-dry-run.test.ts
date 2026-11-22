// Faza B4 — probno knjiženje i kasno uneseni dokumenti (Plans/kontni-plan-b4-proba-i-aktivacija-plan.md §2, §4).
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
import * as dr from "@/server/services/ledgerDryRun";
import * as rc from "@/server/services/ledgerReconciliation";
import { toZonedDateIso } from "@/lib/i18n";

const RULES = { digitsOnly: true, allowedLengths: [1, 2, 3, 5], childExtendsParent: true, maxDepth: 4 };
const CSV = [
  "2;K2;;ASSET;ne", "20;G20;2;ASSET;ne", "201;S201;20;ASSET;ne", "20101;Potraživanja održavanje;201;ASSET;da", "20102;Potraživanja rezerva;201;ASSET;da",
  "24;G24;2;ASSET;ne", "241;S241;24;ASSET;ne", "24101;Tekući račun;241;ASSET;da",
  "3;K3;;EQUITY;ne", "34;G34;3;EQUITY;ne", "340;S340;34;EQUITY;ne", "34001;Višak ranijih godina;340;EQUITY;da",
  "4;K4;;LIABILITY;ne", "43;G43;4;LIABILITY;ne", "430;S430;43;LIABILITY;ne", "43001;Avansi;430;LIABILITY;da", "43002;Neidentifikovane;430;LIABILITY;da",
  "432;S432;43;LIABILITY;ne", "43201;Dobavljači;432;LIABILITY;da",
  "49;G49;4;LIABILITY;ne", "499;S499;49;LIABILITY;ne", "49901;Razgraničeno održavanje;499;LIABILITY;da",
].join("\n");

const TODAY = toZonedDateIso(new Date());
const YEAR = TODAY.slice(0, 4);
const START = `${YEAR}-01-01`;
const PREV = `${Number(YEAR) - 1}-12-30`;
const VF = `${Number(YEAR) - 1}-01-01`;

type Ctx = { acc: (code: string) => string; odrz: string; rez: string };

async function setup(sa: Actor, f: Fixture, tag: string): Promise<Ctx> {
  const tpl = await coa.createTemplate(sa, { key: `b4-${uid(tag).toLowerCase()}`, name: "B4", jurisdiction: "RS", source: "Test", codeRules: RULES });
  expect((await coa.importTemplateAccounts(sa, tpl.id, CSV)).ok).toBe(true);
  await coa.setTemplateStatus(sa, tpl.id, "REVIEWED", { reviewedBy: "N.N.", reviewedAt: "2026-01-01" });
  await coa.assignChart(f.accountant, tpl.id);
  await coa.activateChart(f.accountant);
  await coa.openFiscalYear(f.accountant, { label: YEAR, startDate: START, endDate: `${YEAR}-12-31`, periodicity: "MONTHLY" });
  await lc.applyStarterSetup(f.accountant);
  const chart = (await coa.getZevChart(f.accountant))!;
  const acc = (code: string) => chart.accounts.find((a) => a.code === code)!.id;
  const purposes = await lc.listPurposes(f.accountant);
  await lc.setControlAccount(f.accountant, { role: "MONEY_ACCOUNT", moneyAccountId: f.account.id, accountId: acc("24101"), validFrom: VF });
  await lc.setControlAccount(f.accountant, { role: "OWNER_RECEIVABLE", purposeId: purposes.find((p) => !p.isCommonReserve)!.id, accountId: acc("20101"), validFrom: VF });
  await lc.setControlAccount(f.accountant, { role: "OWNER_RECEIVABLE", purposeId: purposes.find((p) => p.isCommonReserve)!.id, accountId: acc("20102"), validFrom: VF });
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

async function invoice(f: Fixture, amount: string, chargeTypeId: string, issueDate = new Date()) {
  return prisma.invoice.create({
    data: {
      zevId: f.zev.id, number: uid("F"), unitId: f.u1.id, debtorId: f.ownerA.id, issueDate, dueDate: issueDate,
      total: amount, status: "ISSUED", lines: { create: [{ description: "L", calcSnapshot: {}, amount, order: 0, chargeTypeId }] },
    },
  });
}

const counts = async (zevId: string) => ({
  entries: await prisma.journalEntry.count({ where: { zevId } }),
  lines: await prisma.journalLine.count({ where: { zevId } }),
  events: await prisma.accountingEvent.count({ where: { zevId } }),
  counters: await prisma.journalCounter.count({ where: { zevId } }),
});

describe("B4: probno knjiženje i kasno uneseni dokumenti", () => {
  let sa: Actor;
  let f: Fixture;
  let ctx: Ctx;
  let dry: dr.DryRunResult;

  beforeAll(async () => {
    sa = await createSuperAdminActor("b4-sa");
    f = await createFixture("b4");
    ctx = await setup(sa, f, "b4");
    // Evidencija prije početka (ulazi u početno stanje) i poslije (događaji).
    await invoice(f, "40.00", ctx.odrz, new Date(`${PREV}T10:00:00Z`));
    await pay.enterPayment(f.accountant, { accountId: f.account.id, date: new Date(`${PREV}T10:00:00Z`), amount: "15.00", payerId: f.ownerB.id });
    const inv = await invoice(f, "50.00", ctx.odrz);
    await invoice(f, "20.00", ctx.rez);
    const p = await pay.enterPayment(f.accountant, { accountId: f.account.id, date: new Date(), amount: "50.00", payerId: f.ownerA.id });
    await pay.allocatePayment(f.accountant, { paymentId: p.id, invoiceId: inv.id });
  });

  it("proba ne upisuje ništa osim reda u revizorskom tragu", async () => {
    const before = await counts(f.zev.id);
    dry = (await dr.runDryRun(f.accountant, { startDate: START }))!;
    expect(await counts(f.zev.id)).toEqual(before);
    expect(await ev.ledgerStart(prisma, f.zev.id)).toBeNull();
    expect(await prisma.journalEntry.count({ where: { zevId: f.zev.id, kind: "OPENING" } })).toBe(0);
    expect(await dr.lastDryRun(f.accountant)).toMatchObject({ startDate: START });
  });

  it("proba prikazuje spremnost, početno stanje, događaje, bruto bilans i usklađivanje", async () => {
    expect(dry.checks.find((c) => c.key === "chart")!.level).toBe("ok");
    expect(dry.checks.find((c) => c.key === "rules")!.level).toBe("warn");
    expect(dry.opening).toMatchObject({ ok: true, error: null });
    expect(dry.opening.balancing).not.toBeNull(); // evidencija nije uravnotežena sama po sebi — razlika privremeno
    expect(dry.events).toMatchObject({ total: 4, posted: 3, waiting: 1 }); // dvije fakture, uplata, raspored; REZ čeka
    expect(dry.events!.groups[0]).toMatchObject({ count: 1, amount: "20.00" });
    expect(dry.events!.groups[0].examples[0].label).toMatch(/^Faktura /);
    expect(dry.trial!.balanced).toBe(true);
    expect(dry.recon!.ok).toBe(true);
  });

  it("prava aktivacija za isti datum daje isti ishod kao proba", async () => {
    const d = await ob.prepareOpening(f.accountant, { startDate: START });
    const r = await ob.reconcileOpening(f.accountant, d.id);
    const diff = Number(r.debit) - Number(r.credit);
    await ob.saveOpeningManualLines(f.accountant, d.id, {
      description: "PS", lines: [diff > 0 ? { accountId: ctx.acc("34001"), credit: diff.toFixed(2) } : { accountId: ctx.acc("34001"), debit: (-diff).toFixed(2) }],
    });
    await j.postEntry(f.accountant, d.id);
    const real = await prisma.accountingEvent.groupBy({ by: ["status"], where: { zevId: f.zev.id }, _count: { _all: true } });
    const posted = real.find((g) => g.status === "POSTED")?._count._all ?? 0;
    expect(posted).toBe(dry.events!.posted);
    expect(real.reduce((s, g) => s + g._count._all, 0) - posted).toBe(dry.events!.waiting);
    expect(await dr.runDryRun(f.accountant, { startDate: START })).toBeNull(); // poslije aktivacije proba nema smisla
  });

  it("kasno unesena uplata iz prethodne godine knjiži se na datum početka; usklađivanje ostaje bez razlike", async () => {
    const p = await pay.enterPayment(f.accountant, { accountId: f.account.id, date: new Date(`${PREV}T09:00:00Z`), amount: "33.00", payerId: f.ownerC.id });
    const e = await prisma.accountingEvent.findUniqueOrThrow({ where: { zevId_sourceType_sourceId_kind: { zevId: f.zev.id, sourceType: "Payment", sourceId: p.id, kind: "PAYMENT_RECEIVED" } } });
    expect(e.status).toBe("POSTED");
    const entry = await prisma.journalEntry.findUniqueOrThrow({ where: { id: e.journalEntryId! } });
    expect(toZonedDateIso(entry.postingDate)).toBe(START);
    expect(entry.documentDate.toISOString().slice(0, 10)).toBe(PREV);
    expect(entry.description).toContain(ev.LATE_ENTRY_LABEL);
    const r = await rc.reconcileAt(f.accountant, TODAY);
    expect(r.ok).toBe(true);
    expect(r.rows.find((x) => x.role === "MONEY_ACCOUNT")).toMatchObject({ difference: "0.00" });
  });

  it("zapis prije početka unesen PRIJE knjiženja početnog stanja nema događaj (sadržan je u početnom stanju)", async () => {
    const old = await prisma.payment.findFirstOrThrow({ where: { zevId: f.zev.id, amount: "15.00" } });
    expect(await prisma.accountingEvent.count({ where: { zevId: f.zev.id, sourceId: old.id } })).toBe(0);
  });
});
