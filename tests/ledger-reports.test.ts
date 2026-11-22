// Faza B3a — izvještaji iz knjige (Plans/kontni-plan-b3-izvjestaji-plan.md §3, §7).
import { describe, it, expect, beforeAll } from "vitest";
import { prisma } from "@/lib/prisma";
import { createFixture, createSuperAdminActor, uid, type Fixture } from "./helpers";
import type { Actor } from "@/server/auth/guards";
import * as coa from "@/server/services/chartOfAccounts";
import * as lc from "@/server/services/ledgerConfig";
import * as j from "@/server/services/journal";
import * as ob from "@/server/services/openingBalance";
import * as exp from "@/server/services/expenses";
import * as fin from "@/server/services/finance";
import * as rep from "@/server/services/ledgerReports";
import { toZonedDateIso } from "@/lib/i18n";

const RULES = { digitsOnly: true, allowedLengths: [1, 2, 3, 5], childExtendsParent: true, maxDepth: 4 };
const CSV = [
  "2;K2;;ASSET;ne", "20;G20;2;ASSET;ne", "201;S201;20;ASSET;ne", "20101;Potraživanja održavanje;201;ASSET;da", "20102;Potraživanja rezerva;201;ASSET;da",
  "24;G24;2;ASSET;ne", "241;S241;24;ASSET;ne", "24101;Tekući račun;241;ASSET;da", "28;G28;2;ASSET;ne", "280;S280;28;ASSET;ne", "28001;Razgraničenja;280;ASSET;da",
  "3;K3;;EQUITY;ne", "34;G34;3;EQUITY;ne", "340;S340;34;EQUITY;ne", "34001;Višak ranijih godina;340;EQUITY;da",
  "4;K4;;LIABILITY;ne", "43;G43;4;LIABILITY;ne", "430;S430;43;LIABILITY;ne", "43001;Avansi;430;LIABILITY;da", "43002;Neidentifikovane;430;LIABILITY;da",
  "432;S432;43;LIABILITY;ne", "43201;Dobavljači;432;LIABILITY;da",
  "5;K5;;EXPENSE;ne", "55;G55;5;EXPENSE;ne", "550;S550;55;EXPENSE;ne", "55001;Troškovi održavanja;550;EXPENSE;da", "55002;Bankarske provizije;550;EXPENSE;da",
  "6;K6;;INCOME;ne", "66;G66;6;INCOME;ne", "660;S660;66;INCOME;ne", "66001;Prihod od kamata;660;INCOME;da",
].join("\n");

const TODAY = toZonedDateIso(new Date());
const YEAR = TODAY.slice(0, 4);
const START = `${YEAR}-01-01`;
const END = `${YEAR}-12-31`;
const VF = `${Number(YEAR) - 1}-01-01`;
const nextDay = (iso: string) => new Date(Date.parse(`${iso}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10);

async function setup(sa: Actor, f: Fixture, tag: string) {
  const tpl = await coa.createTemplate(sa, { key: `b3-${uid(tag).toLowerCase()}`, name: "B3", jurisdiction: "RS", source: "Test", codeRules: RULES });
  expect((await coa.importTemplateAccounts(sa, tpl.id, CSV)).ok).toBe(true);
  await coa.setTemplateStatus(sa, tpl.id, "REVIEWED", { reviewedBy: "N.N.", reviewedAt: "2026-01-01" });
  await coa.assignChart(f.accountant, tpl.id);
  await coa.activateChart(f.accountant);
  await coa.openFiscalYear(f.accountant, { label: YEAR, startDate: START, endDate: END, periodicity: "MONTHLY" });
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
  // Početno stanje: evidencija + ručni par 28001/34001 (100,00), da PS kolona ima šta da pokaže.
  const d = await ob.prepareOpening(f.accountant, { startDate: START });
  const r = await ob.reconcileOpening(f.accountant, d.id);
  const diff = Number(r.debit) - Number(r.credit);
  const lines: j.JournalLineInput[] = [{ accountId: acc("28001"), debit: "100.00" }, { accountId: acc("34001"), credit: "100.00" }];
  if (diff > 0) lines.push({ accountId: acc("34001"), credit: diff.toFixed(2) });
  if (diff < 0) lines.push({ accountId: acc("34001"), debit: (-diff).toFixed(2) });
  await ob.saveOpeningManualLines(f.accountant, d.id, { description: "PS", lines });
  const opening = await j.postEntry(f.accountant, d.id);
  return { acc, maint: maint.id, opening };
}

const manual = (lines: j.JournalLineInput[], description = "Test nalog", postingDate = TODAY) => ({ documentDate: postingDate, postingDate, description, lines });

describe("B3a: izvještaji iz knjige", () => {
  let sa: Actor;
  let f: Fixture;
  let other: Fixture;
  let ctx: Awaited<ReturnType<typeof setup>>;
  let posted: { id: string };
  let projectId: string;

  beforeAll(async () => {
    sa = await createSuperAdminActor("b3-sa");
    f = await createFixture("b3");
    other = await createFixture("b3o");
    ctx = await setup(sa, f, "b3");
    projectId = (await prisma.project.create({ data: { zevId: f.zev.id, name: `Krov-${f.t}` } })).id;
    // Dva ručna naloga (ručni ne smije na kontrolna konta, B1-Q5): rashod 80 + 20 na teret razgraničenja, prihod 15.
    const a = await j.saveDraft(f.accountant, manual([
      { accountId: ctx.acc("55001"), debit: "80.00", projectId, purposeId: ctx.maint },
      { accountId: ctx.acc("55002"), debit: "20.00" },
      { accountId: ctx.acc("28001"), credit: "100.00" },
    ], "Rashodi"));
    posted = await j.postEntry(f.accountant, a.id);
    const b = await j.saveDraft(f.accountant, manual([{ accountId: ctx.acc("28001"), debit: "15.00" }, { accountId: ctx.acc("66001"), credit: "15.00", projectId }], "Kamata"));
    await j.postEntry(f.accountant, b.id);
    // Nacrt ne ulazi ni u jedan izvještaj.
    await j.saveDraft(f.accountant, manual([{ accountId: ctx.acc("55001"), debit: "999.00" }, { accountId: ctx.acc("28001"), credit: "999.00" }], "Nacrt"));
  });

  it("bruto bilans: PS u svojoj koloni, promet odvojeno, zbirovi uravnoteženi, nacrt ne ulazi", async () => {
    const tb = await rep.trialBalance(f.accountant, { from: START, to: END });
    expect(tb.balanced).toBe(true);
    const row = (code: string) => tb.rows.find((r) => r.code === code);
    expect(row("28001")).toMatchObject({ openingDebit: "100.00", debit: "15.00", credit: "100.00", closingDebit: "15.00", closingCredit: "0.00" });
    expect(row("55001")).toMatchObject({ openingDebit: "0.00", debit: "80.00", closingDebit: "80.00" });
    expect(row("66001")).toMatchObject({ credit: "15.00", closingCredit: "15.00" });
    expect(tb.totals.openingDebit).toBe(tb.totals.openingCredit);
    expect(tb.totals.debit).toBe("115.00");
    expect(tb.rows.every((r) => r.postable)).toBe(true);
  });

  it("bruto bilans sa zbirnim kontima: zbirno = zbir podređenih, ukupno se ne duplira", async () => {
    const plain = await rep.trialBalance(f.accountant, { from: START, to: END });
    const tb = await rep.trialBalance(f.accountant, { from: START, to: END, withSummary: true });
    expect(tb.rows.find((r) => r.code === "550")).toMatchObject({ postable: false, debit: "100.00", closingDebit: "100.00" });
    expect(tb.rows.find((r) => r.code === "5")).toMatchObject({ debit: "100.00" });
    expect(tb.totals).toEqual(plain.totals);
  });

  it("promet prije `from` prelazi u početno stanje", async () => {
    const day = nextDay(TODAY);
    const tb = await rep.trialBalance(f.accountant, { from: day, to: day });
    const r = tb.rows.find((x) => x.code === "55001")!;
    expect(r).toMatchObject({ openingDebit: "80.00", debit: "0.00", closingDebit: "80.00" });
    expect(tb.totals.debit).toBe("0.00");
  });

  it("kartica konta: saldo u prirodnoj strani poslije svake stavke; zbirno konto obuhvata podkonta", async () => {
    const c = (await rep.accountCard(f.accountant, { from: START, to: END, accountId: ctx.acc("28001") }))!;
    expect(c.opening).toBe("100.00");
    expect(c.rows.map((r) => r.balance)).toEqual(["0.00", "15.00"]);
    expect(c.closing).toBe("15.00");
    expect(c.rows[0]).toMatchObject({ entryId: posted.id, credit: "100.00" });
    const income = (await rep.accountCard(f.accountant, { from: START, to: END, accountId: ctx.acc("66001") }))!;
    expect(income.closing).toBe("15.00"); // prihod: P−D
    const sum = (await rep.accountCard(f.accountant, { from: START, to: END, accountId: ctx.acc("550") }))!;
    expect(sum.account.postable).toBe(false);
    expect(sum.rows.map((r) => r.accountCode).sort()).toEqual(["55001", "55002"]);
    expect(sum.closing).toBe("100.00");
    // Filter po projektu.
    const proj = (await rep.accountCard(f.accountant, { from: START, to: END, accountId: ctx.acc("550"), projectId }))!;
    expect(proj.closing).toBe("80.00");
  });

  it("dnevnik: samo proknjiženi nalozi u periodu, duguje = potražuje, filter po vrsti", async () => {
    const all = await rep.journalBook(f.accountant, { from: START, to: END });
    expect(all.entries.map((e) => e.description)).not.toContain("Nacrt");
    expect(all.debit).toBe(all.credit);
    const opening = await rep.journalBook(f.accountant, { from: START, to: END, kind: "OPENING" });
    expect(opening.entries.map((e) => e.id)).toEqual([ctx.opening.id]);
  });

  it("storno: original i storno oba u prometu i poništavaju se; pregled storna ima original, razlog i ko je proknjižio", async () => {
    const d = await j.saveDraft(f.accountant, manual([{ accountId: ctx.acc("55002"), debit: "7.00" }, { accountId: ctx.acc("28001"), credit: "7.00" }], "Za storno"));
    const p = await j.postEntry(f.accountant, d.id);
    const rev = await j.reverseEntry(f.accountant, p.id, { reason: "Pogrešan iznos", postingDate: TODAY });
    const tb = await rep.trialBalance(f.accountant, { from: START, to: END });
    expect(tb.rows.find((r) => r.code === "55002")).toMatchObject({ debit: "27.00", credit: "7.00", closingDebit: "20.00" });
    const list = await rep.reversalReview(f.accountant, { from: START, to: END });
    const row = list.find((r) => r.id === rev.id)!;
    expect(row).toMatchObject({ reason: "Pogrešan iznos", amount: "7.00", original: { id: p.id, number: p.number } });
    expect(row.postedBy).not.toBe("");
  });

  it("dobavljač i namjena: račun dobavljača iz B2 se vidi na kartici dobavljača i u pregledu po namjeni", async () => {
    const supplierId = (await exp.createSupplier(f.accountant, { name: `Dobavljač-${f.t}` })).id;
    const cat = (await fin.ensureCategory(f.accountant, `Održavanje-${f.t}`, "EXPENSE")).id;
    const r = await lc.createRuleDraft(f.accountant, { kind: "SUPPLIER_INVOICE", categoryId: cat, counterAccountId: ctx.acc("55001"), validFrom: VF, reason: "Test" });
    await lc.confirmRule(f.accountant, r.id, "N.N., računovođa");
    await exp.createExpense(f.accountant, { supplierId, categoryId: cat, amount: "40.00", invoiceDate: new Date(), invoiceNumber: uid("R") });

    expect((await rep.dimensionOptions(f.accountant, "supplier")).map((o) => o.id)).toContain(supplierId);
    const cards = await rep.dimensionCard(f.accountant, { from: START, to: END, dim: "supplier", id: supplierId });
    expect(cards.map((c) => [c.account.code, c.closing])).toEqual([["43201", "40.00"]]); // obaveza: P−D

    const purposes = await rep.purposeOverview(f.accountant, { from: START, to: END });
    expect(purposes.find((p) => p.purposeId === ctx.maint)).toMatchObject({ expense: "120.00" }); // 80 ručno + 40 račun
    const none = purposes.find((p) => p.purposeId === "none")!;
    expect(none.income).toBe("15.00");

    const projects = await rep.projectOverview(f.accountant, { from: START, to: END });
    expect(projects.find((p) => p.projectId === projectId)).toMatchObject({ income: "15.00", expense: "80.00", lines: 2 });
  });

  it("izolacija: tuđi konto i namjena daju prazan izvještaj; vlasnik nema pristup", async () => {
    await coa.openFiscalYear(other.accountant, { label: YEAR, startDate: START, endDate: END, periodicity: "MONTHLY" }).catch(() => null);
    expect(await rep.accountCard(other.accountant, { from: START, to: END, accountId: ctx.acc("28001") })).toBeNull();
    expect((await rep.trialBalance(other.accountant, { from: START, to: END, purposeId: ctx.maint })).rows).toEqual([]);
    expect(await rep.dimensionCard(other.accountant, { from: START, to: END, dim: "party", id: f.ownerA.id })).toEqual([]);
    expect(await rep.filterLabels(other.accountant, { purposeId: ctx.maint })).toMatchObject({ purpose: "?" });
    await expect(rep.trialBalance(f.actorA, { from: START, to: END })).rejects.toThrow();
    await expect(rep.ledgerReportCsv(f.actorA, "bruto-bilans", { from: START, to: END })).rejects.toThrow();
  });

  it("CSV: bruto bilans i glavna knjiga, izvoz u auditu", async () => {
    const csv = await rep.ledgerReportCsv(f.accountant, "bruto-bilans", { from: START, to: END });
    expect(csv.split("\r\n")[0]).toContain("PS duguje");
    expect(csv).toContain("55001;Troškovi održavanja");
    const gl = await rep.ledgerReportCsv(f.accountant, "glavna-knjiga", { from: START, to: END });
    expect(gl).toContain("Početno stanje");
    const a = await prisma.auditEvent.findFirst({ where: { zevId: f.zev.id, action: "ledger.report.export", targetId: "glavna-knjiga" } });
    expect(a).toBeTruthy();
  });

  it("period: neispravan datum vraća poslovnu godinu", async () => {
    const r = await rep.reportRange(f.accountant, "nije-datum", null);
    expect(r).toMatchObject({ from: START, to: END });
    expect(await rep.reportRange(f.accountant, END, START)).toMatchObject({ from: START, to: END });
  });
});
