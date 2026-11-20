// Kontni plan, Faza A1 (Plans/kontni-plan-i-knjizenje-plan.md §3.4, §7).
import { describe, it, expect, beforeAll } from "vitest";
import { prisma } from "@/lib/prisma";
import { createFixture, createSuperAdminActor, uid, type Fixture } from "./helpers";
import type { Actor } from "@/server/auth/guards";
import * as coa from "@/server/services/chartOfAccounts";
import { EMPTY_CODE_RULES, flattenTree, parseChartCsv, validateAccountCode, type CodeRules } from "@/lib/accountCodes";
import { parseCsv } from "@/lib/csv";

const NUMERIC_RULES: CodeRules = { digitsOnly: true, allowedLengths: [], childExtendsParent: true, maxDepth: null };

const CSV = [
  "šifra;naziv;nadređena;vrsta;knjižno;opis",
  "0;Klasa nula;;ASSET;ne;",
  "01;Grupa 01;0;ASSET;ne;",
  "0100;Konto 0100;01;ASSET;da;vodeća nula",
  "1;Klasa jedan;;ASSET;ne;",
  "10;Grupa 10;1;ASSET;ne;",
  "100;Konto 100;10;ASSET;da;",
  "101;Konto 101;10;ASSET;da;",
  "4;Klasa četiri;;LIABILITY;ne;",
  "43;Grupa 43;4;LIABILITY;ne;",
  "435;Obaveze;43;LIABILITY;da;",
].join("\n");

async function makeReviewedTemplate(sa: Actor, tag: string) {
  const tpl = await coa.createTemplate(sa, {
    key: `test-${uid(tag).toLowerCase()}`, name: `Test ${tag}`, jurisdiction: "RS", source: "Test izvor", codeRules: NUMERIC_RULES,
  });
  const imp = await coa.importTemplateAccounts(sa, tpl.id, CSV);
  expect(imp).toEqual({ ok: true, count: 10 });
  await coa.setTemplateStatus(sa, tpl.id, "REVIEWED", { reviewedBy: "N.N., računovođa", reviewedAt: "2026-11-20" });
  return tpl;
}

describe("šifre konta i CSV (čiste funkcije)", () => {
  it("šifra ostaje tekst — vodeće nule se ne gube, sortiranje je leksičko", () => {
    const { rows, errors } = parseChartCsv(parseCsv(CSV, ";"), NUMERIC_RULES);
    expect(errors).toEqual([]);
    expect(rows.map((r) => r.code)).toContain("0100");
    expect(rows.find((r) => r.code === "0100")?.parentCode).toBe("01");
    const flat = flattenTree(rows.map((r) => ({ id: r.code, code: r.code, parentId: r.parentCode })));
    expect(flat.map((r) => r.code).slice(0, 3)).toEqual(["0", "01", "0100"]);
    expect(flat.find((r) => r.code === "0100")?.depth).toBe(2);
  });

  it("pravila šifara su vezana za predložak", () => {
    expect(validateAccountCode("10A", NUMERIC_RULES, { parentCode: "10", depth: 2 })).toMatch(/samo cifre/);
    expect(validateAccountCode("10A", EMPTY_CODE_RULES, { parentCode: "10", depth: 2 })).toBeNull();
    expect(validateAccountCode("200", NUMERIC_RULES, { parentCode: "10", depth: 3 })).toMatch(/mora počinjati/);
    expect(validateAccountCode("123", { ...EMPTY_CODE_RULES, allowedLengths: [1, 2, 4] }, { parentCode: null, depth: 1 })).toMatch(/dozvoljene dužine/);
    expect(validateAccountCode("1", { ...EMPTY_CODE_RULES, maxDepth: 2 }, { parentCode: null, depth: 3 })).toMatch(/najviše 2/);
  });

  it("CSV: ciklus, nepostojeći roditelj, duplikat i knjižni roditelj su greške sa brojem reda", () => {
    const bad = ["1;A;2;ASSET;ne", "2;B;1;ASSET;ne", "3;C;9;ASSET;da", "3;D;;ASSET;da", "5;E;;ASSET;da", "50;F;5;ASSET;da"].join("\n");
    const { errors } = parseChartCsv(parseCsv(bad, ";"), EMPTY_CODE_RULES);
    expect(errors.some((e) => /ciklus/.test(e))).toBe(true);
    expect(errors.some((e) => /„9” ne postoji/.test(e))).toBe(true);
    expect(errors.some((e) => /ponavlja/.test(e))).toBe(true);
    expect(errors.some((e) => /„5” ima podkonta/.test(e))).toBe(true);
  });
});

describe("predlošci (super admin)", () => {
  let sa: Actor;
  let f: Fixture;
  beforeAll(async () => {
    sa = await createSuperAdminActor("coa-sa");
    f = await createFixture("coa-tpl");
  });

  it("samo super admin upravlja predlošcima", async () => {
    await expect(coa.createTemplate(f.accountant, { key: "x", name: "X", jurisdiction: "RS", codeRules: EMPTY_CODE_RULES })).rejects.toThrow();
    await expect(coa.listTemplates(f.president)).rejects.toThrow();
  });

  it("neispravan CSV ne upisuje ništa", async () => {
    const tpl = await coa.createTemplate(sa, { key: `bad-${uid("b").toLowerCase()}`, name: "Bad", jurisdiction: "RS", codeRules: NUMERIC_RULES });
    const res = await coa.importTemplateAccounts(sa, tpl.id, "1;A;;ASSET;ne\n1X;B;1;ASSET;da");
    expect(res.ok).toBe(false);
    expect(await prisma.chartTemplateAccount.count({ where: { templateId: tpl.id } })).toBe(0);
  });

  it("provjeren predložak traži izvor, stručno lice i datum; poslije toga se ne mijenja", async () => {
    const tpl = await coa.createTemplate(sa, { key: `rev-${uid("r").toLowerCase()}`, name: "Rev", jurisdiction: "RS", codeRules: NUMERIC_RULES });
    await coa.importTemplateAccounts(sa, tpl.id, CSV);
    await expect(coa.setTemplateStatus(sa, tpl.id, "REVIEWED", { reviewedBy: "N.N.", reviewedAt: "2026-11-20" })).rejects.toThrow(/izvor/);
    await expect(coa.setTemplateStatus(sa, tpl.id, "REVIEWED", { source: "Sl. glasnik", reviewedAt: "2026-11-20" })).rejects.toThrow(/stručnog lica/);
    const reviewed = await coa.setTemplateStatus(sa, tpl.id, "REVIEWED", { source: "Sl. glasnik", reviewedBy: "N.N.", reviewedAt: "2026-11-20" });
    expect(reviewed.status).toBe("REVIEWED");
    await expect(coa.importTemplateAccounts(sa, tpl.id, CSV)).rejects.toThrow(/nacrt/);
    await expect(coa.updateTemplateDraft(sa, tpl.id, { name: "Novo", jurisdiction: "RS", codeRules: NUMERIC_RULES })).rejects.toThrow(/nacrt/);
  });
});

describe("kontni plan ZEV-a", () => {
  let sa: Actor;
  let f: Fixture;
  let g: Fixture;
  let tplId: string;

  beforeAll(async () => {
    sa = await createSuperAdminActor("coa-sa2");
    f = await createFixture("coa-f");
    g = await createFixture("coa-g");
    tplId = (await makeReviewedTemplate(sa, "zev")).id;
  });

  it("vlasnik i predsjednik ne uređuju plan; predsjednik ga vidi", async () => {
    await expect(coa.assignChart(f.actorA, tplId)).rejects.toThrow();
    await expect(coa.assignChart(f.president, tplId)).rejects.toThrow();
    await expect(coa.getZevChart(f.actorA)).rejects.toThrow();
    expect(await coa.getZevChart(f.president)).toBeNull();
  });

  it("demo predložak se ne dodjeljuje stvarnom ZEV-u", async () => {
    const demo = await coa.createTemplate(sa, { key: `demo-${uid("d").toLowerCase()}`, name: "Demo", jurisdiction: "RS", codeRules: NUMERIC_RULES });
    await coa.importTemplateAccounts(sa, demo.id, CSV);
    await coa.setTemplateStatus(sa, demo.id, "DEMO");
    expect((await coa.listAssignableTemplates(f.accountant)).some((t) => t.id === demo.id)).toBe(false);
    await expect(coa.assignChart(f.accountant, demo.id)).rejects.toThrow(/Demonstracioni/);
  });

  it("dva ZEV-a imaju različitu razradu istog predloška bez međusobnog uticaja (kriterijumi 1, 10)", async () => {
    await coa.assignChart(f.accountant, tplId);
    await coa.assignChart(g.accountant, tplId);
    const chartF = (await coa.getZevChart(f.accountant))!;
    const chartG = (await coa.getZevChart(g.accountant))!;
    expect(chartF.accounts.map((a) => a.code)).toContain("0100");
    const parentF = chartF.accounts.find((a) => a.code === "10")!;
    await coa.addAccount(f.accountant, { parentId: parentF.id, code: "102", name: "Samo u F", postable: true });
    const g102 = (await coa.getZevChart(g.accountant))!.accounts.find((a) => a.code === "102");
    expect(g102).toBeUndefined();
    // Isti kod u drugom ZEV-u je dozvoljen (jedinstvenost je po planu).
    const parentG = chartG.accounts.find((a) => a.code === "10")!;
    await coa.addAccount(g.accountant, { parentId: parentG.id, code: "102", name: "Samo u G", postable: true });
    // ZEV G ne vidi ni ne mijenja konto ZEV-a F.
    await expect(coa.getZevAccount(g.accountant, parentF.id)).rejects.toThrow();
    await expect(coa.updateAccount(g.accountant, parentF.id, { name: "Hak" })).rejects.toThrow();
    await expect(coa.addAccount(g.accountant, { parentId: parentF.id, code: "109", name: "Hak", postable: true })).rejects.toThrow(/nije u kontnom planu/);
  });

  it("drugi plan se ne dodjeljuje dok postoji ne-povučen", async () => {
    await expect(coa.assignChart(f.accountant, tplId)).rejects.toThrow(/već ima kontni plan/);
  });

  it("jedinstvena šifra, knjižni roditelj i pravila šifara", async () => {
    const chart = (await coa.getZevChart(f.accountant))!;
    const p10 = chart.accounts.find((a) => a.code === "10")!;
    const k100 = chart.accounts.find((a) => a.code === "100")!;
    await expect(coa.addAccount(f.accountant, { parentId: p10.id, code: "100", name: "Dup", postable: true })).rejects.toThrow(/već postoji/);
    await expect(coa.addAccount(f.accountant, { parentId: k100.id, code: "1001", name: "Pod", postable: true })).rejects.toThrow(/knjižno/);
    await expect(coa.addAccount(f.accountant, { parentId: p10.id, code: "200", name: "Loš", postable: true })).rejects.toThrow(/mora počinjati/);
  });

  it("u nacrtu: ciklus odbijen (servis i okidač), konto sa podkontima ne postaje knjižno", async () => {
    const chart = (await coa.getZevChart(f.accountant))!;
    const k1 = chart.accounts.find((a) => a.code === "1")!;
    const k10 = chart.accounts.find((a) => a.code === "10")!;
    await expect(coa.updateAccount(f.accountant, k1.id, { name: k1.name, parentId: k10.id })).rejects.toThrow(/ciklus/);
    await expect(coa.updateAccount(f.accountant, k10.id, { name: k10.name, postable: true })).rejects.toThrow(/podkontima/);
    // Okidač hvata ciklus i kad se servis zaobiđe.
    await expect(prisma.zevAccount.update({ where: { id: k1.id }, data: { parentId: k10.id } })).rejects.toThrow(/ciklus/);
  });

  it("brisanje samo u nacrtu i samo bez podkonta", async () => {
    const chart = (await coa.getZevChart(f.accountant))!;
    const k10 = chart.accounts.find((a) => a.code === "10")!;
    await expect(coa.deleteAccount(f.accountant, k10.id)).rejects.toThrow(/podkonta/);
    const k102 = chart.accounts.find((a) => a.code === "102")!;
    await coa.deleteAccount(f.accountant, k102.id);
    expect(await prisma.zevAccount.findUnique({ where: { id: k102.id } })).toBeNull();
  });

  it("aktivan plan: šifra/vrsta zaključane, brisanje zabranjeno, zamjena čuva istoriju", async () => {
    await coa.activateChart(f.accountant);
    const chart = (await coa.getZevChart(f.accountant))!;
    expect(chart.status).toBe("ACTIVE");
    const k101 = chart.accounts.find((a) => a.code === "101")!;
    await expect(coa.updateAccount(f.accountant, k101.id, { name: k101.name, code: "109" })).rejects.toThrow(/Zamijeni konto/);
    await expect(coa.deleteAccount(f.accountant, k101.id)).rejects.toThrow(/deaktivirati/);
    // Naziv se smije promijeniti, uz trag.
    await coa.updateAccount(f.accountant, k101.id, { name: "Konto 101 — novi naziv" });
    const replaced = await coa.replaceAccount(f.accountant, k101.id, { code: "105", name: "Zamjena", nature: "ASSET", postable: true }, "Promjena značenja");
    const old = await coa.getZevAccount(f.accountant, k101.id);
    expect(old.active).toBe(false);
    expect(old.replacedBy?.id).toBe(replaced.id);
    expect(replaced.replacesId).toBe(k101.id);
    await expect(coa.reactivateAccount(f.accountant, k101.id)).rejects.toThrow(/zamijenjen/);
    const trail = await prisma.auditEvent.findMany({ where: { targetId: { in: [k101.id, replaced.id] } }, orderBy: { createdAt: "asc" } });
    expect(trail.map((e) => e.action)).toEqual(expect.arrayContaining(["zev_account.update", "zev_account.replace"]));
    expect(trail.find((e) => e.action === "zev_account.replace")?.reason).toBe("Promjena značenja");
  });

  it("deaktivacija: traži razlog, ne dira podatke, ne prolazi uz aktivna podkonta", async () => {
    const chart = (await coa.getZevChart(f.accountant))!;
    const k10 = chart.accounts.find((a) => a.code === "10")!;
    const k100 = chart.accounts.find((a) => a.code === "100")!;
    await expect(coa.deactivateAccount(f.accountant, k100.id, " ")).rejects.toThrow(/razlog/);
    await expect(coa.deactivateAccount(f.accountant, k10.id, "x")).rejects.toThrow(/podkonta/);
    await coa.deactivateAccount(f.accountant, k100.id, "Ne koristi se");
    const after = await coa.getZevAccount(f.accountant, k100.id);
    expect(after.active).toBe(false);
    expect(after.code).toBe("100");
    await expect(coa.addAccount(f.accountant, { parentId: k100.id, code: "1009", name: "X", postable: true })).rejects.toThrow();
    await coa.reactivateAccount(f.accountant, k100.id);
  });

  it("nova verzija predloška ne mijenja postojeći plan ZEV-a (kriterijum 6)", async () => {
    const before = (await coa.getZevChart(g.accountant))!;
    const v2 = await coa.createTemplateVersion(sa, tplId);
    expect(v2.version).toBe(2);
    await coa.importTemplateAccounts(sa, v2.id, CSV.replace("Konto 100;", "Preimenovano 100;").replace("435;Obaveze;43;LIABILITY;da;\n", "") + "\n436;Novo;43;LIABILITY;da;");
    await coa.setTemplateStatus(sa, v2.id, "REVIEWED", { reviewedBy: "N.N.", reviewedAt: "2026-11-21" });
    await coa.setTemplateStatus(sa, tplId, "RETIRED");
    const after = (await coa.getZevChart(g.accountant))!;
    expect(after.sourceTemplateId).toBe(tplId);
    expect(after.accounts.map((a) => [a.code, a.name])).toEqual(before.accounts.map((a) => [a.code, a.name]));
    expect(after.accounts.find((a) => a.code === "100")?.name).toBe("Konto 100");
  });

  it("povučen plan ostaje čitljiv i oslobađa mjesto za novi", async () => {
    await expect(coa.retireChart(g.accountant, "")).rejects.toThrow(/razlog/);
    const old = (await coa.getZevChart(g.accountant))!;
    await coa.retireChart(g.accountant, "Prelazak na novu verziju");
    expect(await coa.getZevChart(g.accountant)).toBeNull();
    expect(await prisma.zevAccount.count({ where: { chartId: old.id } })).toBe(old.accounts.length);
    expect(await coa.countRetiredCharts(g.accountant)).toBe(1);
  });
});

describe("poslovne godine i periodi", () => {
  let f: Fixture;
  beforeAll(async () => {
    f = await createFixture("coa-fy");
  });

  it("mjesečni periodi, bez preklapanja, samo računovođa otvara", async () => {
    await expect(coa.openFiscalYear(f.president, { label: "2027", startDate: "2027-01-01", endDate: "2027-12-31", periodicity: "MONTHLY" })).rejects.toThrow();
    await coa.openFiscalYear(f.accountant, { label: "2027", startDate: "2027-01-01", endDate: "2027-12-31", periodicity: "MONTHLY" });
    const years = await coa.listFiscalYears(f.president);
    expect(years[0].periods.map((p) => p.label)).toHaveLength(12);
    expect(years[0].periods[1].label).toBe("2027-02");
    expect(years[0].periods[1].endDate.toISOString().slice(0, 10)).toBe("2027-02-28");
    await expect(coa.openFiscalYear(f.accountant, { label: "2027b", startDate: "2027-12-01", endDate: "2028-11-30", periodicity: "YEARLY" })).rejects.toThrow(/preklapa/);
    await expect(coa.openFiscalYear(f.accountant, { label: "X", startDate: "2029-02-01", endDate: "2029-01-01", periodicity: "YEARLY" })).rejects.toThrow(/prije početka/);
  });

  it("djelimični prvi i posljednji mjesec", () => {
    const p = coa.monthlyPeriods(new Date("2028-03-15T00:00:00Z"), new Date("2028-05-10T00:00:00Z"));
    expect(p.map((x) => [x.label, x.startDate.toISOString().slice(0, 10), x.endDate.toISOString().slice(0, 10)])).toEqual([
      ["2028-03", "2028-03-15", "2028-03-31"],
      ["2028-04", "2028-04-01", "2028-04-30"],
      ["2028-05", "2028-05-01", "2028-05-10"],
    ]);
  });
});
