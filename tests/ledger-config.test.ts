// Kontni plan A2 — podešavanje knjiženja (Plans/kontni-plan-i-knjizenje-plan.md §3.5–3.6, §11).
import { describe, it, expect, beforeAll } from "vitest";
import { prisma } from "@/lib/prisma";
import { createFixture, createSuperAdminActor, createAreaCharges, uid, type Fixture } from "./helpers";
import type { Actor } from "@/server/auth/guards";
import * as coa from "@/server/services/chartOfAccounts";
import * as lc from "@/server/services/ledgerConfig";
import * as billing from "@/server/services/billing";
import { ensureCategory } from "@/server/services/finance";

const RULES = { digitsOnly: true, allowedLengths: [1, 2, 3, 5], childExtendsParent: true, maxDepth: 4 };
const CSV = [
  "2;K2;;ASSET;ne", "20;G20;2;ASSET;ne", "201;S201;20;ASSET;ne",
  "20101;Potraživanja — održavanje;201;ASSET;da", "20102;Potraživanja — rezerva;201;ASSET;da",
  "24;G24;2;ASSET;ne", "241;S241;24;ASSET;ne", "24101;Tekući račun;241;ASSET;da",
  "246;S246;24;ASSET;ne", "24601;Blagajna;246;ASSET;da",
  "4;K4;;LIABILITY;ne", "43;G43;4;LIABILITY;ne", "430;S430;43;LIABILITY;ne",
  "43001;Avansi vlasnika;430;LIABILITY;da", "43002;Neidentifikovane uplate;430;LIABILITY;da",
  "432;S432;43;LIABILITY;ne", "43201;Dobavljači;432;LIABILITY;da",
  "49;G49;4;LIABILITY;ne", "499;S499;49;LIABILITY;ne",
  "49901;Razgraničeno — održavanje;499;LIABILITY;da", "49902;Razgraničeno — rezerva;499;LIABILITY;da",
  "5;K5;;EXPENSE;ne", "53;G53;5;EXPENSE;ne", "532;S532;53;EXPENSE;ne", "53201;Tekuće održavanje;532;EXPENSE;da",
].join("\n");

async function activeChart(sa: Actor, f: Fixture, tag: string) {
  const tpl = await coa.createTemplate(sa, { key: `a2-${uid(tag).toLowerCase()}`, name: "A2", jurisdiction: "RS", source: "Test", codeRules: RULES });
  expect((await coa.importTemplateAccounts(sa, tpl.id, CSV)).ok).toBe(true);
  await coa.setTemplateStatus(sa, tpl.id, "REVIEWED", { reviewedBy: "N.N.", reviewedAt: "2026-11-20" });
  await coa.assignChart(f.accountant, tpl.id);
  await coa.activateChart(f.accountant);
  const chart = (await coa.getZevChart(f.accountant))!;
  return (code: string) => chart.accounts.find((a) => a.code === code)!;
}

describe("A2: vrste zaduženja, namjene i kontrolna konta", () => {
  let sa: Actor;
  let f: Fixture;
  let acc: (code: string) => { id: string; code: string };

  beforeAll(async () => {
    sa = await createSuperAdminActor("a2-sa");
    f = await createFixture("a2");
    acc = await activeChart(sa, f, "a2");
  });

  it("prava: predsjednik vidi, ali ne podešava", async () => {
    await expect(lc.createPurpose(f.president, { code: "09", name: "X", isCommonReserve: false })).rejects.toThrow();
    await expect(lc.applyStarterSetup(f.actorA)).rejects.toThrow();
    expect(await lc.listPurposes(f.president)).toEqual([]);
  });

  it("početno podešavanje: dvije namjene i dvije vrste, stavke razvrstane po oznaci fonda; ponavljanje ne duplira", async () => {
    const [plain] = await createAreaCharges(f, "0.20");
    const reserve = await billing.createChargeItem(f.accountant, {
      name: `Rezerva-${uid("r")}`, method: "PER_AREA", rate: "0.10", scopeType: "ZEV", effectiveFrom: new Date("2020-01-01"), isReserveFund: true,
    });
    const r1 = await lc.applyStarterSetup(f.accountant);
    expect(r1.createdPurposes).toBe(2);
    expect(r1.createdTypes).toBe(2);
    const types = await lc.listChargeTypes(f.accountant);
    const rez = types.find((t) => t.code === "REZ")!;
    expect(rez.defaultPurpose?.isCommonReserve).toBe(true);
    expect((await prisma.chargeItem.findUniqueOrThrow({ where: { id: reserve.id } })).chargeTypeId).toBe(rez.id);
    expect((await prisma.chargeItem.findUniqueOrThrow({ where: { id: plain } })).chargeTypeId).toBe(types.find((t) => t.code === "ODRZ")!.id);
    const r2 = await lc.applyStarterSetup(f.accountant);
    expect(r2).toEqual({ createdPurposes: 0, createdTypes: 0, assigned: 0 });
  });

  it("serija faktura pamti vrstu zaduženja na liniji; kasnija promjena stavke ne dira izdatu liniju", async () => {
    const items = await prisma.chargeItem.findMany({ where: { zevId: f.zev.id, chargeTypeId: { not: null } } });
    const { batch } = await billing.createDraftBatch(f.accountant, "2031-01", undefined, items.map((i) => i.id));
    await billing.issueBatch(f.accountant, batch.id);
    const lines = await prisma.invoiceLine.findMany({ where: { invoice: { batchId: batch.id } } });
    expect(lines.length).toBeGreaterThan(0);
    expect(lines.every((l) => l.chargeTypeId !== null)).toBe(true);
    const line = lines[0];
    await lc.setChargeItemType(f.accountant, line.chargeItemId!, null);
    expect((await prisma.invoiceLine.findUniqueOrThrow({ where: { id: line.id } })).chargeTypeId).toBe(line.chargeTypeId);
    await lc.setChargeItemType(f.accountant, line.chargeItemId!, line.chargeTypeId);
  });

  it("prijedlog kontrolnih konta iz okvira v2 i primjena; isto konto ne smije imati dvije uloge", async () => {
    const sugg = await lc.suggestControlAccounts(f.accountant);
    expect(sugg.map((s) => s.accountCode).sort()).toEqual(["20101", "20102", "24101", "43001", "43002", "43201"].sort());
    expect(await lc.applySuggestedControlAccounts(f.accountant, "2027-01-01")).toBe(6);
    expect(await lc.suggestControlAccounts(f.accountant)).toEqual([]);
    await expect(
      lc.setControlAccount(f.accountant, { role: "OWNER_ADVANCE", accountId: acc("43002").id, validFrom: "2027-02-01" })
    ).rejects.toThrow(/dvije uloge/);
    await expect(
      lc.setControlAccount(f.accountant, { role: "OWNER_ADVANCE", accountId: acc("43001").id, validFrom: "2026-12-01" })
    ).rejects.toThrow(/kasnijeg datuma/);
    // Append-only: okidač brani izmjenu.
    const row = await prisma.zevControlAccount.findFirstOrThrow({ where: { zevId: f.zev.id } });
    await expect(prisma.zevControlAccount.update({ where: { id: row.id }, data: { reason: "x" } })).rejects.toThrow();
  });
});

describe("A2: pravila knjiženja, kapije i pokrivenost", () => {
  let sa: Actor;
  let f: Fixture;
  let acc: (code: string) => { id: string; code: string };
  let odrz: string;
  let rez: string;

  beforeAll(async () => {
    sa = await createSuperAdminActor("a2r-sa");
    f = await createFixture("a2r");
    acc = await activeChart(sa, f, "a2r");
    await lc.applyStarterSetup(f.accountant);
    await lc.applySuggestedControlAccounts(f.accountant, "2027-01-01");
    const types = await lc.listChargeTypes(f.accountant);
    odrz = types.find((t) => t.code === "ODRZ")!.id;
    rez = types.find((t) => t.code === "REZ")!.id;
  });

  it("pokrivenost prije pravila: vrste čekaju podešavanje, rezerva čeka potvrdu šeme", async () => {
    const cov = await lc.getCoverage(f.president);
    const charge = cov.ruleRows.filter((r) => r.kind === "CHARGE_ISSUED");
    expect(charge.find((r) => r.keyId === odrz)?.status).toBe("MISSING");
    expect(charge.find((r) => r.keyId === rez)?.status).toBe("GATED");
    expect(cov.controlRows.every((c) => c.current !== null)).toBe(true);
  });

  it("nacrt → potvrda (uz stručno lice); kontrolno konto ne može biti protivkonto; priznavanje prihoda nema pravilo", async () => {
    await expect(lc.createRuleDraft(f.accountant, { kind: "CHARGE_ISSUED", chargeTypeId: odrz, counterAccountId: acc("43001").id, validFrom: "2027-01-01", reason: "x" })).rejects.toThrow(/kontrolno konto/);
    await expect(lc.createRuleDraft(f.accountant, { kind: "REVENUE_RECOGNIZED", counterAccountId: acc("49901").id, validFrom: "2027-01-01", reason: "x" })).rejects.toThrow(/K-6/);
    await expect(lc.createRuleDraft(f.accountant, { kind: "PAYMENT_RECEIVED", counterAccountId: acc("49901").id, validFrom: "2027-01-01", reason: "x" })).rejects.toThrow(/kontrolna konta/);
    const d = await lc.createRuleDraft(f.accountant, { kind: "CHARGE_ISSUED", chargeTypeId: odrz, counterAccountId: acc("49901").id, validFrom: "2027-01-01", reason: "Akontacija (R-3)" });
    await expect(lc.createRuleDraft(f.accountant, { kind: "CHARGE_ISSUED", chargeTypeId: odrz, counterAccountId: acc("49901").id, validFrom: "2027-02-01", reason: "x" })).rejects.toThrow(/nacrt/);
    await expect(lc.confirmRule(f.president, d.id, "N.N.")).rejects.toThrow();
    await expect(lc.confirmRule(f.accountant, d.id, " ")).rejects.toThrow(/stručno/);
    const c = await lc.confirmRule(f.accountant, d.id, "N.N., računovođa");
    expect(c.status).toBe("CONFIRMED");
    expect((await lc.getCoverage(f.accountant)).ruleRows.find((r) => r.keyId === odrz && r.kind === "CHARGE_ISSUED")?.status).toBe("OK");
  });

  it("potvrđeno pravilo se ne mijenja (okidač); nova verzija samo od kasnijeg datuma i veže se na staru", async () => {
    const confirmed = await prisma.postingRule.findFirstOrThrow({ where: { zevId: f.zev.id, chargeTypeId: odrz, status: "CONFIRMED" } });
    await expect(prisma.postingRule.update({ where: { id: confirmed.id }, data: { reason: "hak" } })).rejects.toThrow(/ne mijenja/);
    await expect(prisma.postingRule.delete({ where: { id: confirmed.id } })).rejects.toThrow(/ne mijenja/);
    await expect(lc.createRuleDraft(f.accountant, { kind: "CHARGE_ISSUED", chargeTypeId: odrz, counterAccountId: acc("49901").id, validFrom: "2027-01-01", reason: "x" })).rejects.toThrow(/kasnijeg datuma/);
    const v2 = await lc.createRuleDraft(f.accountant, { kind: "CHARGE_ISSUED", chargeTypeId: odrz, counterAccountId: acc("49901").id, validFrom: "2027-07-01", reason: "Nova verzija" });
    expect(v2.supersedesId).toBe(confirmed.id);
    await lc.withdrawRule(f.accountant, v2.id, "Ipak ne");
    expect((await prisma.postingRule.findUniqueOrThrow({ where: { id: v2.id } })).status).toBe("WITHDRAWN");
  });

  it("zajednička rezerva: nacrt da, potvrda tek uz potvrđenu šemu; opoziv ponovo zatvara", async () => {
    const d = await lc.createRuleDraft(f.accountant, { kind: "CHARGE_ISSUED", chargeTypeId: rez, counterAccountId: acc("49902").id, validFrom: "2027-01-01", reason: "Rezerva (R-6)" });
    await expect(lc.confirmRule(f.accountant, d.id, "N.N.")).rejects.toThrow(/Čeka potvrdu šeme/);
    await expect(lc.recordSchemaApproval(f.accountant, { schema: "COMMON_RESERVE_CLASSIFICATION", description: " ", expertName: "N.N.", approvedAt: "2026-12-01" })).rejects.toThrow(/šemu/);
    await lc.recordSchemaApproval(f.accountant, { schema: "COMMON_RESERVE_CLASSIFICATION", description: "D 20102 / P 49902; trošenje D 49902 uz odluku", expertName: "N.N., ovlašćeni računovođa", approvedAt: "2026-12-01" });
    await expect(lc.recordSchemaApproval(f.accountant, { schema: "COMMON_RESERVE_CLASSIFICATION", description: "x", expertName: "x", approvedAt: "2026-12-01" })).rejects.toThrow(/već potvrđena/);
    expect((await lc.confirmRule(f.accountant, d.id, "N.N.")).status).toBe("CONFIRMED");
    await lc.revokeSchemaApproval(f.accountant, "COMMON_RESERVE_CLASSIFICATION", "Nova politika");
    const gates = await lc.listGates(f.accountant);
    expect(gates.find((g) => g.schema === "COMMON_RESERVE_CLASSIFICATION")?.active).toBeNull();
    const ap = await prisma.postingSchemaApproval.findFirstOrThrow({ where: { zevId: f.zev.id } });
    await expect(prisma.postingSchemaApproval.delete({ where: { id: ap.id } })).rejects.toThrow();
  });

  it("pravila po kategoriji: rashod traži kategoriju rashoda; pravilo raspodjele djelimične uplate", async () => {
    const inc = await ensureCategory(f.accountant, `Prihod-${uid("c")}`, "INCOME");
    await expect(lc.createRuleDraft(f.accountant, { kind: "SUPPLIER_INVOICE", categoryId: inc.id, counterAccountId: acc("53201").id, validFrom: "2027-01-01", reason: "x" })).rejects.toThrow(/rashoda/);
    const exp = await ensureCategory(f.accountant, `Rashod-${uid("c")}`, "EXPENSE");
    await lc.createRuleDraft(f.accountant, { kind: "SUPPLIER_INVOICE", categoryId: exp.id, counterAccountId: acc("53201").id, validFrom: "2027-01-01", reason: "R-7" });
    expect(await lc.getAllocationRule(f.accountant)).toBe("NOT_SET");
    await expect(lc.setAllocationRule(f.president, "PROPORTIONAL")).rejects.toThrow();
    await lc.setAllocationRule(f.accountant, "OLDEST_FIRST");
    expect(await lc.getAllocationRule(f.president)).toBe("OLDEST_FIRST");
  });

  it("drugi ZEV ne vidi ni ne koristi tuđa konta i vrste", async () => {
    const g = await createFixture("a2-other");
    await expect(lc.createRuleDraft(g.accountant, { kind: "CHARGE_ISSUED", chargeTypeId: odrz, counterAccountId: acc("49901").id, validFrom: "2028-01-01", reason: "x" })).rejects.toThrow();
    expect(await lc.listChargeTypes(g.accountant)).toEqual([]);
    expect((await lc.listRules(g.accountant)).length).toBe(0);
  });
});
