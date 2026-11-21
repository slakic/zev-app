// Faza B1a — nalozi, kontrole, storno, periodi (Plans/kontni-plan-b1-nalozi-plan.md §3, §6).
import { describe, it, expect, beforeAll } from "vitest";
import { prisma } from "@/lib/prisma";
import { createFixture, createSuperAdminActor, uid, type Fixture } from "./helpers";
import type { Actor } from "@/server/auth/guards";
import * as coa from "@/server/services/chartOfAccounts";
import * as lc from "@/server/services/ledgerConfig";
import * as j from "@/server/services/journal";

const RULES = { digitsOnly: true, allowedLengths: [1, 2, 3, 5], childExtendsParent: true, maxDepth: 4 };
const CSV = [
  "2;K2;;ASSET;ne", "24;G24;2;ASSET;ne", "241;S241;24;ASSET;ne", "24101;Tekući račun;241;ASSET;da",
  "28;G28;2;ASSET;ne", "280;S280;28;ASSET;ne", "28001;Unaprijed plaćeno;280;ASSET;da",
  "4;K4;;LIABILITY;ne", "43;G43;4;LIABILITY;ne", "432;S432;43;LIABILITY;ne", "43201;Dobavljači;432;LIABILITY;da",
  "5;K5;;EXPENSE;ne", "55;G55;5;EXPENSE;ne", "553;S553;55;EXPENSE;ne", "55301;Bankarske naknade;553;EXPENSE;da",
  "550;S550;55;EXPENSE;ne", "55005;Osiguranje;550;EXPENSE;da",
].join("\n");

const TODAY = new Date().toISOString().slice(0, 10);
const YEAR = TODAY.slice(0, 4);
const MONTH = TODAY.slice(0, 7);
const prevMonth = (() => {
  const d = new Date(`${MONTH}-01T00:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() - 1);
  return d.toISOString().slice(0, 7);
})();

async function setup(sa: Actor, f: Fixture, tag: string) {
  const tpl = await coa.createTemplate(sa, { key: `b1-${uid(tag).toLowerCase()}`, name: "B1", jurisdiction: "RS", source: "Test", codeRules: RULES });
  expect((await coa.importTemplateAccounts(sa, tpl.id, CSV)).ok).toBe(true);
  await coa.setTemplateStatus(sa, tpl.id, "REVIEWED", { reviewedBy: "N.N.", reviewedAt: "2026-01-01" });
  await coa.assignChart(f.accountant, tpl.id);
  await coa.activateChart(f.accountant);
  await coa.openFiscalYear(f.accountant, { label: YEAR, startDate: `${YEAR}-01-01`, endDate: `${YEAR}-12-31`, periodicity: "MONTHLY" });
  // U januaru je „prethodni mjesec” u prošloj godini — i nju otvaramo, da test ne zavisi od datuma pokretanja.
  const prevYear = prevMonth.slice(0, 4);
  if (prevYear !== YEAR) await coa.openFiscalYear(f.accountant, { label: prevYear, startDate: `${prevYear}-01-01`, endDate: `${prevYear}-12-31`, periodicity: "MONTHLY" });
  const chart = (await coa.getZevChart(f.accountant))!;
  return (code: string) => chart.accounts.find((a) => a.code === code)!.id;
}

const draft = (lines: j.JournalLineInput[], postingDate = TODAY) => ({ documentDate: postingDate, postingDate, description: "Test nalog", lines });

describe("B1a: nalozi i kontrole", () => {
  let sa: Actor;
  let f: Fixture;
  let acc: (code: string) => string;

  beforeAll(async () => {
    sa = await createSuperAdminActor("b1-sa");
    f = await createFixture("b1");
    acc = await setup(sa, f, "b1");
  });

  it("stavka: iznos tačno na jednoj strani, ne nula, ne zbirno konto", async () => {
    await expect(j.saveDraft(f.accountant, draft([{ accountId: acc("55301"), debit: "10", credit: "10" }]))).rejects.toThrow(/jednoj strani/);
    await expect(j.saveDraft(f.accountant, draft([{ accountId: acc("55301") }]))).rejects.toThrow(/jednoj strani/);
    const sumAcc = (await coa.getZevChart(f.accountant))!.accounts.find((a) => a.code === "553")!.id;
    await expect(j.saveDraft(f.accountant, draft([{ accountId: sumAcc, debit: "5" }]))).rejects.toThrow(/zbirno/);
    await expect(j.saveDraft(f.accountant, draft([{ accountId: acc("55301"), debit: "1.234" }]))).rejects.toThrow(/dvije decimale/);
  });

  it("neuravnotežen nacrt se čuva, ali se ne knjiži; ni baza ga ne pušta", async () => {
    const d = await j.saveDraft(f.accountant, draft([{ accountId: acc("55301"), debit: "10.00" }, { accountId: acc("55005"), credit: "9.00" }]));
    await expect(j.postEntry(f.accountant, d.id)).rejects.toThrow(/nije uravnotežen/);
    await expect(prisma.journalEntry.update({ where: { id: d.id }, data: { status: "POSTED", number: `X-${uid("n")}` } })).rejects.toThrow(/uravnotežen/);
    await j.deleteDraft(f.accountant, d.id);
  });

  it("predsjednik i vlasnik ne prave naloge; predsjednik ih vidi", async () => {
    await expect(j.saveDraft(f.president, draft([]))).rejects.toThrow();
    await expect(j.listEntries(f.actorA)).rejects.toThrow();
    expect(Array.isArray(await j.listEntries(f.president))).toBe(true);
  });

  it("ručni nalog ne koristi kontrolno konto; datum u budućnosti odbijen", async () => {
    await lc.setControlAccount(f.accountant, { role: "SUPPLIER_PAYABLE", accountId: acc("43201"), validFrom: "2026-01-01" });
    await expect(j.saveDraft(f.accountant, draft([{ accountId: acc("43201"), credit: "5" }, { accountId: acc("55301"), debit: "5" }]))).rejects.toThrow(/kontrolno konto/);
    const opts = await j.editorOptions(f.accountant);
    expect(opts.accounts.some((a) => a.id === acc("43201"))).toBe(false);
    await expect(j.saveDraft(f.accountant, draft([], `${Number(YEAR) + 1}-01-15`))).rejects.toThrow();
  });

  it("knjiženje dodjeljuje broj redom; proknjižen nalog i stavke su nepromjenjivi", async () => {
    const d1 = await j.saveDraft(f.accountant, draft([{ accountId: acc("55301"), debit: "3.00" }, { accountId: acc("24101"), credit: "3.00" }]));
    const p1 = await j.postEntry(f.accountant, d1.id);
    expect(p1.number).toBe(`NK-${YEAR}-0001`);
    await expect(j.postEntry(f.accountant, d1.id)).rejects.toThrow(/već proknjižen/);
    await expect(prisma.journalEntry.update({ where: { id: d1.id }, data: { description: "hak" } })).rejects.toThrow(/ne mijenja/);
    const line = await prisma.journalLine.findFirstOrThrow({ where: { entryId: d1.id } });
    await expect(prisma.journalLine.update({ where: { id: line.id }, data: { description: "hak" } })).rejects.toThrow(/ne mijenjaju/);
    await expect(j.deleteDraft(f.accountant, d1.id)).rejects.toThrow(/stornira/);
  });

  it("istovremeno knjiženje: isti nacrt samo jednom, različiti nacrti dobijaju različite brojeve", async () => {
    const mk = () => j.saveDraft(f.accountant, draft([{ accountId: acc("55301"), debit: "1.00" }, { accountId: acc("24101"), credit: "1.00" }]));
    const a = await mk();
    const results = await Promise.allSettled([j.postEntry(f.accountant, a.id), j.postEntry(f.accountant, a.id)]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const drafts = await Promise.all([mk(), mk(), mk()]);
    const posted = await Promise.all(drafts.map((d) => j.postEntry(f.accountant, d.id)));
    const numbers = posted.map((p) => p.number);
    expect(new Set(numbers).size).toBe(3);
    const all = (await prisma.journalEntry.findMany({ where: { zevId: f.zev.id, status: "POSTED" }, select: { number: true } })).map((e) => Number(e.number!.slice(-4))).sort((x, y) => x - y);
    expect(all).toEqual(all.map((_, i) => i + 1)); // bez rupa
  });

  it("storno: obrnute strane, veza na original, razlog; ne dvaput i ne storno storna", async () => {
    const d = await j.saveDraft(f.accountant, draft([{ accountId: acc("55005"), debit: "120.00" }, { accountId: acc("24101"), credit: "120.00" }]));
    const p = await j.postEntry(f.accountant, d.id);
    await expect(j.reverseEntry(f.accountant, p.id, { reason: " ", postingDate: TODAY })).rejects.toThrow(/razlog/);
    const r = await j.reverseEntry(f.accountant, p.id, { reason: "Pogrešan račun", postingDate: TODAY });
    expect(r.reversalOfId).toBe(p.id);
    const lines = await prisma.journalLine.findMany({ where: { entryId: r.id }, orderBy: { order: "asc" } });
    expect(lines.map((l) => [l.debit.toFixed(2), l.credit.toFixed(2)])).toEqual([["0.00", "120.00"], ["120.00", "0.00"]]);
    await expect(j.reverseEntry(f.accountant, p.id, { reason: "x", postingDate: TODAY })).rejects.toThrow(/već storniran/);
    await expect(j.reverseEntry(f.accountant, r.id, { reason: "x", postingDate: TODAY })).rejects.toThrow(/ne stornira/);
  });

  it("drugi ZEV ne vidi nalog ni ne koristi tuđe konto", async () => {
    const g = await createFixture("b1-other");
    const e = (await j.listEntries(f.accountant))[0];
    await expect(j.getEntry(g.accountant, e.id)).rejects.toThrow();
    await expect(j.postEntry(g.accountant, e.id)).rejects.toThrow();
    await expect(j.saveDraft(g.accountant, draft([{ accountId: acc("55301"), debit: "1" }]))).rejects.toThrow();
  });
});

describe("B1a: zatvaranje i ponovno otvaranje perioda", () => {
  let sa: Actor;
  let f: Fixture;
  let acc: (code: string) => string;
  let periodId: string;

  beforeAll(async () => {
    sa = await createSuperAdminActor("b1p-sa");
    f = await createFixture("b1p");
    acc = await setup(sa, f, "b1p");
    periodId = (await prisma.fiscalPeriod.findFirstOrThrow({ where: { zevId: f.zev.id, label: prevMonth } })).id;
  });

  it("period sa nacrtom se ne zatvara; zatvoren period odbija knjiženje i storno", async () => {
    const day = `${prevMonth}-15`;
    const d = await j.saveDraft(f.accountant, draft([{ accountId: acc("55301"), debit: "2.00" }, { accountId: acc("24101"), credit: "2.00" }], day));
    await expect(j.closePeriod(f.accountant, periodId)).rejects.toThrow(/nacrta/);
    const posted = await j.postEntry(f.accountant, d.id);
    await expect(j.closePeriod(f.president, periodId)).rejects.toThrow();
    await j.closePeriod(f.accountant, periodId);
    await expect(j.saveDraft(f.accountant, draft([], day))).rejects.toThrow(/zatvoren/);
    await expect(j.reverseEntry(f.accountant, posted.id, { reason: "x", postingDate: day })).rejects.toThrow(/zatvoren/);
    // Storno u tekući (otvoren) period je dozvoljen (R-9).
    const r = await j.reverseEntry(f.accountant, posted.id, { reason: "Ispravka u tekućem periodu", postingDate: TODAY });
    expect(r.status).toBe("POSTED");
  });

  it("ponovno otvaranje: drugo lice druge uloge; isto lice ne odobrava sebi", async () => {
    await expect(j.requestReopen(f.accountant, periodId, " ")).rejects.toThrow(/razlog/);
    const req = await j.requestReopen(f.accountant, periodId, "Zaboravljen račun");
    await expect(j.requestReopen(f.president, periodId, "x")).rejects.toThrow(/već postoji/);
    await expect(j.decideReopen(f.accountant, req.id, true)).rejects.toThrow(/podnijelo/);
    await j.decideReopen(f.president, req.id, true, "Odobreno");
    expect((await prisma.fiscalPeriod.findUniqueOrThrow({ where: { id: periodId } })).status).toBe("OPEN");
    // Obrnuto: predsjednik traži, računovođa odbija.
    await j.closePeriod(f.accountant, periodId);
    const req2 = await j.requestReopen(f.president, periodId, "Provjera");
    await expect(j.decideReopen(f.president, req2.id, true)).rejects.toThrow();
    await j.decideReopen(f.accountant, req2.id, false, "Nije potrebno");
    expect((await prisma.fiscalPeriod.findUniqueOrThrow({ where: { id: periodId } })).status).toBe("CLOSED");
  });
});
