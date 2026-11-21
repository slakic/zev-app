// Faza B1b — nalog početnog stanja (Plans/kontni-plan-b1-nalozi-plan.md §4, §6).
import { describe, it, expect, beforeAll } from "vitest";
import { prisma } from "@/lib/prisma";
import { createFixture, createSuperAdminActor, uid, type Fixture } from "./helpers";
import type { Actor } from "@/server/auth/guards";
import * as coa from "@/server/services/chartOfAccounts";
import * as lc from "@/server/services/ledgerConfig";
import * as j from "@/server/services/journal";
import * as ob from "@/server/services/openingBalance";

const RULES = { digitsOnly: true, allowedLengths: [1, 2, 3, 5], childExtendsParent: true, maxDepth: 4 };
const CSV = [
  "2;K2;;ASSET;ne", "20;G20;2;ASSET;ne", "201;S201;20;ASSET;ne", "20101;Potraživanja održavanje;201;ASSET;da", "20102;Potraživanja rezerva;201;ASSET;da",
  "24;G24;2;ASSET;ne", "241;S241;24;ASSET;ne", "24101;Tekući račun;241;ASSET;da",
  "3;K3;;EQUITY;ne", "34;G34;3;EQUITY;ne", "340;S340;34;EQUITY;ne", "34001;Višak ranijih godina;340;EQUITY;da",
  "4;K4;;LIABILITY;ne", "43;G43;4;LIABILITY;ne", "430;S430;43;LIABILITY;ne", "43001;Avansi;430;LIABILITY;da", "43002;Neidentifikovane;430;LIABILITY;da",
  "432;S432;43;LIABILITY;ne", "43201;Dobavljači;432;LIABILITY;da",
].join("\n");

const START = "2030-01-01";
const at = (s: string) => new Date(`${s}T10:00:00Z`);

async function setup(sa: Actor, f: Fixture, tag: string, withControls = true) {
  const tpl = await coa.createTemplate(sa, { key: `b1b-${uid(tag).toLowerCase()}`, name: "B1b", jurisdiction: "RS", source: "Test", codeRules: RULES });
  expect((await coa.importTemplateAccounts(sa, tpl.id, CSV)).ok).toBe(true);
  await coa.setTemplateStatus(sa, tpl.id, "REVIEWED", { reviewedBy: "N.N.", reviewedAt: "2026-01-01" });
  await coa.assignChart(f.accountant, tpl.id);
  await coa.activateChart(f.accountant);
  await coa.openFiscalYear(f.accountant, { label: "2030", startDate: "2030-01-01", endDate: "2030-12-31", periodicity: "MONTHLY" });
  await lc.applyStarterSetup(f.accountant);
  const chart = (await coa.getZevChart(f.accountant))!;
  const acc = (code: string) => chart.accounts.find((a) => a.code === code)!.id;
  const purposes = await lc.listPurposes(f.accountant);
  const maint = purposes.find((p) => !p.isCommonReserve)!;
  const reserve = purposes.find((p) => p.isCommonReserve)!;
  if (withControls) {
    const vf = "2029-01-01";
    await lc.setControlAccount(f.accountant, { role: "MONEY_ACCOUNT", moneyAccountId: f.account.id, accountId: acc("24101"), validFrom: vf });
    await lc.setControlAccount(f.accountant, { role: "OWNER_RECEIVABLE", purposeId: maint.id, accountId: acc("20101"), validFrom: vf });
    await lc.setControlAccount(f.accountant, { role: "OWNER_RECEIVABLE", purposeId: reserve.id, accountId: acc("20102"), validFrom: vf });
    await lc.setControlAccount(f.accountant, { role: "OWNER_ADVANCE", accountId: acc("43001"), validFrom: vf });
    await lc.setControlAccount(f.accountant, { role: "UNIDENTIFIED_RECEIPTS", accountId: acc("43002"), validFrom: vf });
    await lc.setControlAccount(f.accountant, { role: "SUPPLIER_PAYABLE", accountId: acc("43201"), validFrom: vf });
  }
  return { acc, maint, reserve };
}

/** Evidencija: šta mora ući u stanje na 31.12.2029. i šta ne smije (nastalo ili raspoređeno poslije). */
async function seedRecords(f: Fixture) {
  const zevId = f.zev.id;
  const types = await prisma.chargeType.findMany({ where: { zevId } });
  const odrz = types.find((t) => t.code === "ODRZ")!;
  const rez = types.find((t) => t.code === "REZ")!;
  await prisma.moneyAccount.update({ where: { id: f.account.id }, data: { openingBalance: "1000.00", openingDate: at("2029-01-01") } });
  await prisma.finTransaction.create({ data: { zevId, accountId: f.account.id, date: at("2029-05-01"), type: "INCOME", amount: "200.00" } });

  const inv = (number: string, issue: string, total: string, lines: { amount: string; chargeTypeId?: string }[], debtorId = f.ownerA.id) =>
    prisma.invoice.create({
      data: {
        zevId, number, unitId: f.u1.id, debtorId, issueDate: at(issue), dueDate: at(issue), total, status: "ISSUED",
        lines: { create: lines.map((l, i) => ({ description: `L${i}`, calcSnapshot: {}, amount: l.amount, order: i, chargeTypeId: l.chargeTypeId ?? null })) },
      },
    });
  const invA = await inv(uid("FA"), "2029-06-01", "100.00", [{ amount: "80.00", chargeTypeId: odrz.id }, { amount: "20.00", chargeTypeId: rez.id }]);
  const invB = await inv(uid("FB"), "2029-07-01", "40.00", [{ amount: "40.00" }]); // bez vrste → podrazumijevana namjena
  await inv(uid("FC"), "2030-01-05", "500.00", [{ amount: "500.00", chargeTypeId: odrz.id }]); // poslije datuma

  const pay = (payerId: string | null, date: string, amount: string) =>
    prisma.payment.create({ data: { zevId, accountId: f.account.id, date: at(date), amount, payerId, payerNameRaw: payerId ? null : "Nepoznat" } });
  const pA = await pay(f.ownerA.id, "2029-06-10", "30.00");
  await prisma.paymentAllocation.create({ data: { paymentId: pA.id, invoiceId: invA.id, amount: "30.00", createdAt: at("2029-06-10") } });
  const pB = await pay(f.ownerB.id, "2029-07-01", "100.00");
  // Raspoređeno tek poslije datuma: na dan je to i dalje avans, a faktura B otvorena u cijelosti.
  await prisma.paymentAllocation.create({ data: { paymentId: pB.id, invoiceId: invB.id, amount: "40.00", createdAt: at("2030-02-01") } });
  await pay(null, "2029-08-01", "25.00");
  await pay(f.ownerA.id, "2030-01-10", "999.00"); // poslije datuma

  const supplier = await prisma.supplier.create({ data: { zevId, name: `Dobavljač ${uid("s")}` } });
  const exp = await prisma.expense.create({ data: { zevId, supplierId: supplier.id, invoiceNumber: "R-1", invoiceDate: at("2029-09-01"), amount: "300.00", status: "PARTIALLY_PAID", paidAmount: "100.00" } });
  await prisma.finTransaction.create({ data: { zevId, accountId: f.account.id, date: at("2029-09-15"), type: "EXPENSE", amount: "100.00", expenseId: exp.id } });
  return { supplier };
}

describe("B1b: nalog početnog stanja", () => {
  let sa: Actor;
  let f: Fixture;
  let ctx: Awaited<ReturnType<typeof setup>>;

  beforeAll(async () => {
    sa = await createSuperAdminActor("b1b-sa");
    f = await createFixture("b1b");
    ctx = await setup(sa, f, "b1b");
    await seedRecords(f);
  });

  it("evidencija na dan: ne broji ništa nastalo ili raspoređeno poslije, faktura se dijeli po namjeni", async () => {
    const items = await ob.operationalSnapshot(prisma, f.zev.id, "2029-12-31");
    const sum = (pred: (i: ob.OpeningItem) => boolean) => items.filter(pred).reduce((s, i) => s + Number(i.amount) * (i.side === "D" ? 1 : -1), 0);
    expect(sum((i) => i.sourceType === "MONEY")).toBeCloseTo(1100); // 1000 + 200 − 100
    expect(sum((i) => i.role === "OWNER_RECEIVABLE" && i.purposeId === ctx.maint.id)).toBeCloseTo(56 + 40);
    expect(sum((i) => i.role === "OWNER_RECEIVABLE" && i.purposeId === ctx.reserve.id)).toBeCloseTo(14);
    expect(sum((i) => i.sourceType === "ADVANCE")).toBeCloseTo(-100);
    expect(sum((i) => i.sourceType === "UNIDENTIFIED")).toBeCloseTo(-25);
    expect(sum((i) => i.sourceType === "SUPPLIER")).toBeCloseTo(-200);
  });

  it("predsjednik i vlasnik ne pripremaju početno stanje; predsjednik vidi status", async () => {
    await expect(ob.prepareOpening(f.president, { startDate: START })).rejects.toThrow();
    await expect(ob.prepareOpening(f.actorA, { startDate: START })).rejects.toThrow();
    expect((await ob.openingStatus(f.president)).posted).toBeNull();
  });

  it("prijedlog: stavke iz evidencije usklađene, ali nalog bez ručnih stavki nije uravnotežen i ne knjiži se", async () => {
    const e = await ob.prepareOpening(f.accountant, { startDate: START });
    expect(e.kind).toBe("OPENING");
    const r = await ob.reconcileOpening(f.accountant, e.id);
    expect(r.asOfIso).toBe("2029-12-31");
    expect(r.rows.every((x) => x.ok)).toBe(true);
    expect(r.debit).toBe("1210.00");
    expect(r.credit).toBe("325.00");
    expect(r.ready).toBe(false);
    await expect(j.postEntry(f.accountant, e.id)).rejects.toThrow(/nije uravnotežen/);
  });

  it("ručne stavke: kontrolno konto odbijeno; razlika na izabranom kontu uravnotežuje nalog", async () => {
    const { draft } = await ob.openingStatus(f.accountant);
    await expect(ob.saveOpeningManualLines(f.accountant, draft!.id, { description: "PS", lines: [{ accountId: ctx.acc("20101"), credit: "885" }] })).rejects.toThrow(/kontrolna konta dolaze samo iz evidencije/);
    await ob.saveOpeningManualLines(f.accountant, draft!.id, { description: "Početno stanje 2030", lines: [{ accountId: ctx.acc("34001"), credit: "885.00" }] });
    const r = await ob.reconcileOpening(f.accountant, draft!.id);
    expect(r.ready).toBe(true);
  });

  it("druga priprema zamjenjuje stavke iz evidencije bez dupliranja, a ručne ostaju", async () => {
    const before = await prisma.journalLine.count({ where: { entry: { zevId: f.zev.id, kind: "OPENING", status: "DRAFT" } } });
    const e = await ob.prepareOpening(f.accountant, { startDate: START });
    const lines = await prisma.journalLine.findMany({ where: { entryId: e.id } });
    expect(lines.length).toBe(before);
    expect(lines.filter((l) => !l.openingSourceType).map((l) => l.accountId)).toEqual([ctx.acc("34001")]);
    const keys = lines.filter((l) => l.openingSourceType).map((l) => `${l.openingSourceType}:${l.openingSourceId}`);
    expect(new Set(keys).size).toBe(keys.length);
    expect(e.description).toBe("Početno stanje 2030");
  });

  it("promjena evidencije poslije pripreme: neusklađeno se ne knjiži; nova priprema i knjiženje PS-2030-0001", async () => {
    const { draft } = await ob.openingStatus(f.accountant);
    await prisma.balanceCorrection.create({ data: { zevId: f.zev.id, partyId: f.ownerA.id, amount: "10.00", reason: "Test", createdAt: at("2029-12-01") } });
    const r = await ob.reconcileOpening(f.accountant, draft!.id);
    expect(r.rows.find((x) => x.code === "20101")!.ok).toBe(false);
    await expect(j.postEntry(f.accountant, draft!.id)).rejects.toThrow(/ne slažu/);

    await ob.prepareOpening(f.accountant, { startDate: START });
    await ob.saveOpeningManualLines(f.accountant, draft!.id, { description: "Početno stanje 2030", lines: [{ accountId: ctx.acc("34001"), credit: "895.00" }] });
    expect((await ob.reconcileOpening(f.accountant, draft!.id)).ready).toBe(true);
    const posted = await j.postEntry(f.accountant, draft!.id);
    expect(posted.number).toBe("PS-2030-0001");
    await expect(ob.prepareOpening(f.accountant, { startDate: START })).rejects.toThrow(/već proknjiženo/);
  });

  it("storno početnog stanja na njegov datum (i u budućnosti); zatim novo početno stanje", async () => {
    const { posted } = await ob.openingStatus(f.accountant);
    await expect(j.reverseEntry(f.accountant, posted!.id, { reason: "Test", postingDate: "2030-01-02" })).rejects.toThrow(/budućnosti/);
    const rev = await j.reverseEntry(f.accountant, posted!.id, { reason: "Ispravka", postingDate: START });
    expect(rev.kind).toBe("REVERSAL");
    expect((await ob.openingStatus(f.accountant)).posted).toBeNull();
    const again = await ob.prepareOpening(f.accountant, { startDate: START });
    expect(again.status).toBe("DRAFT");
  });

  it("poslije drugih proknjiženih naloga u godini novo početno stanje više nije moguće", async () => {
    const { draft } = await ob.openingStatus(f.accountant);
    await j.deleteDraft(f.accountant, draft!.id);
    const year = await prisma.fiscalYear.findFirstOrThrow({ where: { zevId: f.zev.id, label: "2030" }, include: { periods: true } });
    await prisma.journalEntry.create({
      data: { zevId: f.zev.id, yearId: year.id, periodId: year.periods[0].id, kind: "MANUAL", status: "DRAFT", documentDate: at(START), postingDate: at(START), description: "x", createdById: f.accountant.userId },
    }).then((e) => prisma.journalEntry.update({ where: { id: e.id }, data: { kind: "AUTO" } })).then(async (e) => {
      // Uravnotežen nalog direktno u bazi (ručni nalog ne smije u budućnost), pa knjiženje kroz servis.
      await prisma.journalLine.createMany({ data: [
        { entryId: e.id, zevId: f.zev.id, order: 0, accountId: ctx.acc("34001"), debit: "1.00" },
        { entryId: e.id, zevId: f.zev.id, order: 1, accountId: ctx.acc("43201"), credit: "1.00" },
      ] });
      await j.postEntry(f.accountant, e.id);
    });
    await expect(ob.prepareOpening(f.accountant, { startDate: START })).rejects.toThrow(/novo početno stanje više nije moguće/);
  });
});

describe("B1b: bez kontrolnih konta", () => {
  it("prijedlog traži kontrolna konta važeća na datum početka", async () => {
    const sa = await createSuperAdminActor("b1b-sa2");
    const f = await createFixture("b1b2");
    await setup(sa, f, "b1b2", false);
    await seedRecords(f);
    await expect(ob.prepareOpening(f.accountant, { startDate: START })).rejects.toThrow(/Nedostaje kontrolno konto/);
  });
});
