// Kontni plan A2 — podešavanje knjiženja (Plans/kontni-plan-i-knjizenje-plan.md §3.5–3.6, §11).
//
// Namjene sredstava, vrste zaduženja (i veza stavki naknade sa njima), kontrolna konta, pravila knjiženja sa
// datumom početka primjene, potvrde šema pod kapijom (K-6) i pravilo raspodjele djelimične uplate (R-15).
// NIŠTA OD OVOGA NE KNJIŽI — Faza B čita ovu konfiguraciju. Zato se ovdje provjerava samo da je konfiguracija
// smislena i istorija sačuvana:
//  - potvrđeno pravilo, kontrolno konto i potvrda šeme se ne mijenjaju (DB okidači); izmjena je novi red;
//  - pravila postoje samo za događaje čiju drugu stranu ne određuju kontrolna konta (§3.6.1): zaduženje po vrsti
//    zaduženja, račun dobavljača i ručne transakcije po kategoriji;
//  - priznavanje prihoda nema pravilo uopšte, a pravilo za zajedničku rezervu se ne potvrđuje bez potvrde šeme.
import { prisma } from "@/lib/prisma";
import { audit } from "@/server/audit";
import { requireCapability, requireZev, type Actor } from "@/server/auth/guards";
import { Prisma, type AccountingEventKind, type ControlRole, type GatedSchema } from "@/generated/prisma/client";
import { normalizeCode } from "@/lib/accountCodes";

const dateOnly = (s: string) => new Date(`${s}T00:00:00Z`);
const isDate = (s: string | null | undefined): s is string => !!s && /^\d{4}-\d{2}-\d{2}$/.test(s);

function isUniqueViolation(e: unknown): boolean {
  return e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002";
}

async function activeChart(zevId: string) {
  const chart = await prisma.zevChart.findFirst({ where: { zevId, status: { not: "RETIRED" } } });
  if (!chart) throw new Error("ZEV još nema kontni plan.");
  if (chart.status !== "ACTIVE") throw new Error("Kontni plan nije aktivan. Aktivirajte ga prije podešavanja knjiženja.");
  return chart;
}

// ---------------------------------------------------------------------------
// Namjene sredstava i vrste zaduženja
// ---------------------------------------------------------------------------

export async function listPurposes(actor: Actor) {
  requireCapability(actor, "ledger.view");
  return prisma.fundPurpose.findMany({ where: { zevId: requireZev(actor) }, orderBy: { code: "asc" } });
}

export async function createPurpose(actor: Actor, input: { code: string; name: string; isCommonReserve: boolean; decisionRef?: string | null }) {
  requireCapability(actor, "chargeTypes.edit");
  const zevId = requireZev(actor);
  const code = normalizeCode(input.code);
  const name = input.name.trim();
  if (!code || !name) throw new Error("Šifra i naziv namjene su obavezni.");
  try {
    const p = await prisma.fundPurpose.create({
      data: { zevId, code, name, isCommonReserve: input.isCommonReserve, decisionRef: input.decisionRef?.trim() || null },
    });
    await audit(actor, { action: "fund_purpose.create", targetType: "FundPurpose", targetId: p.id, after: { code, name, isCommonReserve: p.isCommonReserve } });
    return p;
  } catch (e) {
    if (isUniqueViolation(e)) throw new Error(`Namjena sa šifrom „${code}” već postoji.`);
    throw e;
  }
}

/** Naziv, odluka i aktivnost. Oznaka zajedničke rezerve se ne mijenja — od nje zavisi kapija K-6. */
export async function updatePurpose(actor: Actor, id: string, input: { name: string; decisionRef?: string | null; active: boolean }) {
  requireCapability(actor, "chargeTypes.edit");
  const zevId = requireZev(actor);
  const name = input.name.trim();
  if (!name) throw new Error("Naziv namjene je obavezan.");
  const before = await prisma.fundPurpose.findUniqueOrThrow({ where: { id, zevId } });
  const after = await prisma.fundPurpose.update({
    where: { id, zevId },
    data: { name, decisionRef: input.decisionRef?.trim() || null, active: input.active },
  });
  await audit(actor, {
    action: "fund_purpose.update", targetType: "FundPurpose", targetId: id,
    before: { name: before.name, decisionRef: before.decisionRef, active: before.active },
    after: { name: after.name, decisionRef: after.decisionRef, active: after.active },
  });
  return after;
}

export async function listChargeTypes(actor: Actor) {
  requireCapability(actor, "ledger.view");
  return prisma.chargeType.findMany({
    where: { zevId: requireZev(actor) },
    include: { defaultPurpose: true, chargeItems: { select: { id: true, name: true, active: true }, orderBy: { name: "asc" } } },
    orderBy: { code: "asc" },
  });
}

export async function createChargeType(actor: Actor, input: { code: string; name: string; defaultPurposeId?: string | null }) {
  requireCapability(actor, "chargeTypes.edit");
  const zevId = requireZev(actor);
  const code = normalizeCode(input.code);
  const name = input.name.trim();
  if (!code || !name) throw new Error("Šifra i naziv vrste zaduženja su obavezni.");
  if (input.defaultPurposeId) await prisma.fundPurpose.findUniqueOrThrow({ where: { id: input.defaultPurposeId, zevId } });
  try {
    const ct = await prisma.chargeType.create({ data: { zevId, code, name, defaultPurposeId: input.defaultPurposeId || null } });
    await audit(actor, { action: "charge_type.create", targetType: "ChargeType", targetId: ct.id, after: { code, name, defaultPurposeId: ct.defaultPurposeId } });
    return ct;
  } catch (e) {
    if (isUniqueViolation(e)) throw new Error(`Vrsta zaduženja sa šifrom „${code}” već postoji.`);
    throw e;
  }
}

/**
 * Naziv, podrazumijevana namjena i aktivnost. Namjena se ne mijenja ako postoji potvrđeno pravilo koje se na nju
 * oslanja (pravilo bez sopstvene namjene) — to bi tiho promijenilo značenje već potvrđenog pravila.
 */
export async function updateChargeType(actor: Actor, id: string, input: { name: string; defaultPurposeId?: string | null; active: boolean }) {
  requireCapability(actor, "chargeTypes.edit");
  const zevId = requireZev(actor);
  const name = input.name.trim();
  if (!name) throw new Error("Naziv vrste zaduženja je obavezan.");
  const before = await prisma.chargeType.findUniqueOrThrow({ where: { id, zevId } });
  const purposeId = input.defaultPurposeId || null;
  if (purposeId !== before.defaultPurposeId) {
    if (purposeId) await prisma.fundPurpose.findUniqueOrThrow({ where: { id: purposeId, zevId } });
    const dependent = await prisma.postingRule.count({ where: { zevId, chargeTypeId: id, status: "CONFIRMED", purposeId: null } });
    if (dependent > 0) throw new Error("Namjena se ne mijenja: potvrđeno pravilo knjiženja se oslanja na nju. Napravite novu verziju pravila sa izričitom namjenom.");
  }
  const after = await prisma.chargeType.update({ where: { id, zevId }, data: { name, defaultPurposeId: purposeId, active: input.active } });
  await audit(actor, {
    action: "charge_type.update", targetType: "ChargeType", targetId: id,
    before: { name: before.name, defaultPurposeId: before.defaultPurposeId, active: before.active },
    after: { name: after.name, defaultPurposeId: after.defaultPurposeId, active: after.active },
  });
  return after;
}

/** Veza stavke naknade sa vrstom zaduženja (null = bez vrste, „Čeka podešavanje knjiženja”). */
export async function setChargeItemType(actor: Actor, chargeItemId: string, chargeTypeId: string | null) {
  requireCapability(actor, "chargeTypes.edit");
  const zevId = requireZev(actor);
  const item = await prisma.chargeItem.findUniqueOrThrow({ where: { id: chargeItemId, zevId } });
  if (chargeTypeId) await prisma.chargeType.findUniqueOrThrow({ where: { id: chargeTypeId, zevId } });
  const after = await prisma.chargeItem.update({ where: { id: chargeItemId, zevId }, data: { chargeTypeId: chargeTypeId || null } });
  await audit(actor, {
    action: "charge_item.set_type", targetType: "ChargeItem", targetId: chargeItemId,
    before: { chargeTypeId: item.chargeTypeId }, after: { chargeTypeId: after.chargeTypeId },
  });
  return after;
}

/**
 * Početno podešavanje (prijedlog, jednim klikom): ako ZEV nema namjene ni vrste zaduženja, pravi „Redovno
 * održavanje” i „Zajednička rezerva” (sa oznakom rezerve) i stavke naknade bez vrste razvrstava po postojećoj
 * oznaci „fond održavanja”. Sve ostaje izmjenjivo; ništa se ne potvrđuje.
 */
export async function applyStarterSetup(actor: Actor) {
  requireCapability(actor, "chargeTypes.edit");
  const zevId = requireZev(actor);
  const result = await prisma.$transaction(async (tx) => {
    let purposes = await tx.fundPurpose.findMany({ where: { zevId } });
    let createdPurposes = 0;
    if (purposes.length === 0) {
      await tx.fundPurpose.createMany({
        data: [
          { zevId, code: "01", name: "Redovno održavanje", isCommonReserve: false },
          { zevId, code: "02", name: "Zajednička rezerva", isCommonReserve: true },
        ],
      });
      createdPurposes = 2;
      purposes = await tx.fundPurpose.findMany({ where: { zevId } });
    }
    let types = await tx.chargeType.findMany({ where: { zevId } });
    let createdTypes = 0;
    if (types.length === 0) {
      const maint = purposes.find((p) => !p.isCommonReserve) ?? null;
      const reserve = purposes.find((p) => p.isCommonReserve) ?? null;
      await tx.chargeType.createMany({
        data: [
          { zevId, code: "ODRZ", name: "Redovno održavanje", defaultPurposeId: maint?.id ?? null },
          { zevId, code: "REZ", name: "Zajednička rezerva", defaultPurposeId: reserve?.id ?? null },
        ],
      });
      createdTypes = 2;
      types = await tx.chargeType.findMany({ where: { zevId } });
    }
    const odrz = types.find((t) => t.code === "ODRZ");
    const rez = types.find((t) => t.code === "REZ");
    let assigned = 0;
    if (odrz && rez) {
      const items = await tx.chargeItem.findMany({ where: { zevId, chargeTypeId: null } });
      for (const it of items) {
        await tx.chargeItem.update({ where: { id: it.id }, data: { chargeTypeId: it.isReserveFund ? rez.id : odrz.id } });
        assigned++;
      }
    }
    return { createdPurposes, createdTypes, assigned };
  });
  await audit(actor, { action: "ledger.starter_setup", targetType: "Zev", targetId: zevId, after: result });
  return result;
}

// ---------------------------------------------------------------------------
// Kontrolna konta (§3.6.2, §11 R-2/R-3)
// ---------------------------------------------------------------------------

type ControlKey = { role: ControlRole; moneyAccountId: string | null; purposeId: string | null };
const keyOf = (k: ControlKey) => `${k.role}:${k.moneyAccountId ?? "-"}:${k.purposeId ?? "-"}`;

/** Svi redovi kontrolnih konta (istorija) i, po ključu, onaj koji danas važi (ili prvi budući). */
export async function listControlAccounts(actor: Actor) {
  requireCapability(actor, "ledger.view");
  const zevId = requireZev(actor);
  const rows = await prisma.zevControlAccount.findMany({
    where: { zevId },
    include: { account: { select: { id: true, code: true, name: true } }, moneyAccount: { select: { id: true, name: true, type: true } }, purpose: { select: { id: true, code: true, name: true } } },
    orderBy: [{ role: "asc" }, { validFrom: "asc" }],
  });
  // Po ključu važi posljednji red sa validFrom ≤ danas; ako takvog nema (sve je buduće), prvi budući.
  const now = new Date();
  const byKey = new Map<string, (typeof rows)[number][]>();
  for (const r of rows) byKey.set(keyOf(r), [...(byKey.get(keyOf(r)) ?? []), r]);
  const current = [...byKey.values()].map((list) => list.filter((r) => r.validFrom <= now).at(-1) ?? list[0]);
  return { rows, current };
}

export async function setControlAccount(
  actor: Actor,
  input: { role: ControlRole; accountId: string; moneyAccountId?: string | null; purposeId?: string | null; validFrom: string; reason?: string | null }
) {
  requireCapability(actor, "rules.edit");
  const zevId = requireZev(actor);
  const chart = await activeChart(zevId);
  if (!isDate(input.validFrom)) throw new Error("Unesite datum od kada važi.");
  const role = input.role;
  const moneyAccountId = input.moneyAccountId || null;
  const purposeId = input.purposeId || null;
  if (role === "MONEY_ACCOUNT" && !moneyAccountId) throw new Error("Za konto računa novca izaberite račun (banka ili blagajna).");
  if (role !== "MONEY_ACCOUNT" && moneyAccountId) throw new Error("Račun novca se bira samo za ulogu „Račun novca”.");
  if (role !== "OWNER_RECEIVABLE" && purposeId) throw new Error("Namjena se bira samo za potraživanja od vlasnika.");
  if (moneyAccountId) await prisma.moneyAccount.findUniqueOrThrow({ where: { id: moneyAccountId, zevId } });
  if (purposeId) await prisma.fundPurpose.findUniqueOrThrow({ where: { id: purposeId, zevId } });
  const account = await prisma.zevAccount.findUnique({ where: { id: input.accountId, zevId } });
  if (!account || account.chartId !== chart.id) throw new Error("Konto nije u aktivnom kontnom planu ZEV-a.");
  if (!account.postable || !account.active) throw new Error(`Konto „${account.code}” mora biti aktivno knjižno konto.`);
  const validFrom = dateOnly(input.validFrom);
  const key = keyOf({ role, moneyAccountId, purposeId });
  const { current } = await listControlAccounts(actor);
  const sameKey = (await prisma.zevControlAccount.findMany({ where: { zevId, role, moneyAccountId, purposeId }, orderBy: { validFrom: "desc" } }));
  if (sameKey[0] && validFrom <= sameKey[0].validFrom) {
    throw new Error("Novo kontrolno konto mora važiti od kasnijeg datuma od posljednjeg upisanog za istu ulogu (istorija se ne prepisuje).");
  }
  const clash = current.find((c) => c.accountId === account.id && keyOf(c) !== key);
  if (clash) throw new Error(`Konto „${account.code}” je već kontrolno konto za drugu ulogu — jedno konto ne smije imati dvije uloge.`);
  const ruleUse = await prisma.postingRule.count({ where: { zevId, counterAccountId: account.id, status: { in: ["DRAFT", "CONFIRMED"] } } });
  if (ruleUse > 0) throw new Error(`Konto „${account.code}” je protivkonto u pravilu knjiženja i ne može biti kontrolno.`);
  const row = await prisma.zevControlAccount.create({
    data: { zevId, role, moneyAccountId, purposeId, accountId: account.id, validFrom, reason: input.reason?.trim() || null, createdById: actor.userId },
  });
  await audit(actor, {
    action: "control_account.set", targetType: "ZevControlAccount", targetId: row.id,
    after: { role, accountCode: account.code, moneyAccountId, purposeId, validFrom: input.validFrom }, reason: input.reason ?? null,
  });
  return row;
}

/** Prijedlog iz okvira v2 (§11): po šiframa koje postoje u planu ZEV-a, samo za uloge koje još nisu postavljene. */
export async function suggestControlAccounts(actor: Actor) {
  requireCapability(actor, "ledger.view");
  const zevId = requireZev(actor);
  const chart = await prisma.zevChart.findFirst({ where: { zevId, status: "ACTIVE" }, include: { accounts: { where: { active: true, postable: true } } } });
  if (!chart) return [];
  const byCode = new Map(chart.accounts.map((a) => [a.code, a]));
  const firstUnder = (prefix: string) => chart.accounts.filter((a) => a.code.startsWith(prefix)).sort((a, b) => (a.code < b.code ? -1 : 1))[0];
  const [purposes, moneyAccounts, { current }] = await Promise.all([
    prisma.fundPurpose.findMany({ where: { zevId, active: true }, orderBy: { code: "asc" } }),
    prisma.moneyAccount.findMany({ where: { zevId, active: true }, orderBy: { name: "asc" } }),
    listControlAccounts(actor),
  ]);
  const taken = new Set(current.map((c) => keyOf(c)));
  const out: { role: ControlRole; moneyAccountId: string | null; purposeId: string | null; accountId: string; accountCode: string; accountName: string; forLabel: string }[] = [];
  const push = (k: ControlKey, acc: { id: string; code: string; name: string } | undefined, forLabel: string) => {
    if (acc && !taken.has(keyOf(k))) out.push({ ...k, accountId: acc.id, accountCode: acc.code, accountName: acc.name, forLabel });
  };
  const maint = purposes.find((p) => !p.isCommonReserve);
  const reserve = purposes.find((p) => p.isCommonReserve);
  if (maint) push({ role: "OWNER_RECEIVABLE", moneyAccountId: null, purposeId: maint.id }, byCode.get("20101"), maint.name);
  if (reserve) push({ role: "OWNER_RECEIVABLE", moneyAccountId: null, purposeId: reserve.id }, byCode.get("20102"), reserve.name);
  push({ role: "OWNER_ADVANCE", moneyAccountId: null, purposeId: null }, byCode.get("43001"), "");
  push({ role: "UNIDENTIFIED_RECEIPTS", moneyAccountId: null, purposeId: null }, byCode.get("43002"), "");
  push({ role: "SUPPLIER_PAYABLE", moneyAccountId: null, purposeId: null }, byCode.get("43201") ?? firstUnder("432"), "");
  for (const m of moneyAccounts) {
    push({ role: "MONEY_ACCOUNT", moneyAccountId: m.id, purposeId: null }, m.type === "CASH" ? firstUnder("246") : firstUnder("241"), m.name);
  }
  return out;
}

export async function applySuggestedControlAccounts(actor: Actor, validFrom: string) {
  requireCapability(actor, "rules.edit");
  const suggestions = await suggestControlAccounts(actor);
  for (const s of suggestions) {
    await setControlAccount(actor, { role: s.role, accountId: s.accountId, moneyAccountId: s.moneyAccountId, purposeId: s.purposeId, validFrom, reason: "Prijedlog iz kontnog okvira" });
  }
  return suggestions.length;
}

// ---------------------------------------------------------------------------
// Pravila knjiženja (§3.6.4)
// ---------------------------------------------------------------------------

/** Događaji koji imaju pravilo i šta je ključ pravila. Ostalo određuju kontrolna konta (§3.6.1). */
export const RULE_KINDS = {
  CHARGE_ISSUED: "chargeType",
  SUPPLIER_INVOICE: "expenseCategory",
  CASH_EXPENSE: "expenseCategory",
  CASH_INCOME: "incomeCategory",
} as const satisfies Partial<Record<AccountingEventKind, string>>;
export type RuleKind = keyof typeof RULE_KINDS;

const isRuleKind = (k: string): k is RuleKind => k in RULE_KINDS;

export async function listRules(actor: Actor) {
  requireCapability(actor, "ledger.view");
  return prisma.postingRule.findMany({
    where: { zevId: requireZev(actor) },
    include: {
      chargeType: { select: { id: true, code: true, name: true } },
      category: { select: { id: true, name: true, kind: true } },
      counterAccount: { select: { id: true, code: true, name: true } },
      purpose: { select: { id: true, code: true, name: true, isCommonReserve: true } },
    },
    orderBy: [{ kind: "asc" }, { validFrom: "asc" }, { createdAt: "asc" }],
  });
}

async function gateOpen(zevId: string, schema: GatedSchema): Promise<boolean> {
  const rows = await prisma.postingSchemaApproval.findMany({ where: { zevId, schema }, orderBy: { createdAt: "desc" }, take: 1 });
  return rows.length > 0 && rows[0].revokesId === null;
}

/** Namjena na koju se pravilo stvarno odnosi: izričita, inače podrazumijevana namjena vrste zaduženja. */
async function effectivePurpose(zevId: string, rule: { purposeId: string | null; chargeTypeId: string | null }) {
  if (rule.purposeId) return prisma.fundPurpose.findUnique({ where: { id: rule.purposeId, zevId } });
  if (rule.chargeTypeId) {
    const ct = await prisma.chargeType.findUnique({ where: { id: rule.chargeTypeId, zevId }, include: { defaultPurpose: true } });
    return ct?.defaultPurpose ?? null;
  }
  return null;
}

export async function createRuleDraft(
  actor: Actor,
  input: {
    kind: string; chargeTypeId?: string | null; categoryId?: string | null; counterAccountId: string;
    purposeId?: string | null; validFrom: string; reason: string; expertRef?: string | null;
  }
) {
  requireCapability(actor, "rules.edit");
  const zevId = requireZev(actor);
  if (input.kind === "REVENUE_RECOGNIZED") throw new Error("Priznavanje prihoda nema pravilo dok računovođa ne potvrdi šemu (K-6) — dolazi u Fazi B.");
  if (!isRuleKind(input.kind)) throw new Error("Za ovaj događaj se ne pravi pravilo — drugu stranu određuju kontrolna konta.");
  const kind: RuleKind = input.kind;
  const reason = input.reason.trim();
  if (!reason) throw new Error("Upišite razlog (zašto se pravilo uvodi ili mijenja).");
  if (!isDate(input.validFrom)) throw new Error("Unesite datum početka primjene.");
  const chart = await activeChart(zevId);
  const keyType = RULE_KINDS[kind];
  const chargeTypeId = keyType === "chargeType" ? input.chargeTypeId || null : null;
  const categoryId = keyType !== "chargeType" ? input.categoryId || null : null;
  if (keyType === "chargeType") {
    if (!chargeTypeId) throw new Error("Izaberite vrstu zaduženja.");
    await prisma.chargeType.findUniqueOrThrow({ where: { id: chargeTypeId, zevId } });
  } else {
    if (!categoryId) throw new Error("Izaberite kategoriju.");
    const cat = await prisma.transactionCategory.findUniqueOrThrow({ where: { id: categoryId, zevId } });
    const want = keyType === "incomeCategory" ? "INCOME" : "EXPENSE";
    if (cat.kind !== want) throw new Error(want === "INCOME" ? "Za prihod izaberite kategoriju prihoda." : "Za rashod izaberite kategoriju rashoda.");
  }
  const purposeId = input.purposeId || null;
  if (purposeId) await prisma.fundPurpose.findUniqueOrThrow({ where: { id: purposeId, zevId } });
  const account = await prisma.zevAccount.findUnique({ where: { id: input.counterAccountId, zevId } });
  if (!account || account.chartId !== chart.id) throw new Error("Protivkonto nije u aktivnom kontnom planu ZEV-a.");
  if (!account.postable || !account.active) throw new Error(`Konto „${account.code}” mora biti aktivno knjižno konto.`);
  const control = await prisma.zevControlAccount.count({ where: { zevId, accountId: account.id } });
  if (control > 0) throw new Error(`Konto „${account.code}” je kontrolno konto — ne može biti protivkonto u pravilu.`);

  const sameKey = { zevId, kind, chargeTypeId, categoryId };
  const draft = await prisma.postingRule.findFirst({ where: { ...sameKey, status: "DRAFT" } });
  if (draft) throw new Error("Za ovaj događaj već postoji nacrt pravila — potvrdite ga ili povucite.");
  const latest = await prisma.postingRule.findFirst({ where: { ...sameKey, status: "CONFIRMED" }, orderBy: { validFrom: "desc" } });
  const validFrom = dateOnly(input.validFrom);
  if (latest && validFrom <= latest.validFrom) {
    throw new Error("Nova verzija pravila mora važiti od kasnijeg datuma od posljednje potvrđene (ranija knjiženja se ne prepisuju).");
  }
  const rule = await prisma.postingRule.create({
    data: {
      zevId, chartId: chart.id, kind, chargeTypeId, categoryId, counterAccountId: account.id, purposeId, validFrom,
      reason, expertRef: input.expertRef?.trim() || null, supersedesId: latest?.id ?? null, createdById: actor.userId,
    },
  });
  await audit(actor, {
    action: "posting_rule.create", targetType: "PostingRule", targetId: rule.id,
    after: { kind, chargeTypeId, categoryId, counterAccount: account.code, purposeId, validFrom: input.validFrom, supersedesId: rule.supersedesId },
    reason,
  });
  return rule;
}

export async function confirmRule(actor: Actor, id: string, expertRef: string) {
  requireCapability(actor, "rules.confirm");
  const zevId = requireZev(actor);
  const ref = expertRef.trim();
  if (!ref) throw new Error("Upišite ko je stručno potvrdio pravilo (ime i svojstvo).");
  const rule = await prisma.postingRule.findUniqueOrThrow({ where: { id, zevId }, include: { counterAccount: true } });
  if (rule.status !== "DRAFT") throw new Error("Potvrđuje se samo nacrt pravila.");
  if (!rule.counterAccount.active || !rule.counterAccount.postable) throw new Error(`Konto „${rule.counterAccount.code}” više nije aktivno knjižno konto.`);
  const purpose = await effectivePurpose(zevId, rule);
  if (purpose?.isCommonReserve && !(await gateOpen(zevId, "COMMON_RESERVE_CLASSIFICATION"))) {
    throw new Error("Čeka potvrdu šeme knjiženja: pravilo za zajedničku rezervu se potvrđuje tek kad stručno lice potvrdi bilansnu klasifikaciju rezerve.");
  }
  const after = await prisma.postingRule.update({
    where: { id, zevId },
    data: { status: "CONFIRMED", expertRef: ref, confirmedById: actor.userId, confirmedAt: new Date() },
  });
  await audit(actor, { action: "posting_rule.confirm", targetType: "PostingRule", targetId: id, before: { status: "DRAFT" }, after: { status: "CONFIRMED", expertRef: ref } });
  return after;
}

export async function withdrawRule(actor: Actor, id: string, reason: string) {
  requireCapability(actor, "rules.edit");
  const zevId = requireZev(actor);
  if (!reason.trim()) throw new Error("Povlačenje nacrta traži razlog.");
  const rule = await prisma.postingRule.findUniqueOrThrow({ where: { id, zevId } });
  if (rule.status !== "DRAFT") throw new Error("Povlači se samo nacrt; potvrđeno pravilo zamjenjuje nova verzija.");
  const after = await prisma.postingRule.update({ where: { id, zevId }, data: { status: "WITHDRAWN" } });
  await audit(actor, { action: "posting_rule.withdraw", targetType: "PostingRule", targetId: id, before: { status: "DRAFT" }, after: { status: "WITHDRAWN" }, reason });
  return after;
}

// ---------------------------------------------------------------------------
// Kapije (K-6) i pravilo raspodjele djelimične uplate (R-15)
// ---------------------------------------------------------------------------

export const GATED_SCHEMAS: GatedSchema[] = ["REVENUE_RECOGNITION", "COMMON_RESERVE_CLASSIFICATION"];

export async function listGates(actor: Actor) {
  requireCapability(actor, "ledger.view");
  const zevId = requireZev(actor);
  const rows = await prisma.postingSchemaApproval.findMany({ where: { zevId }, orderBy: { createdAt: "asc" } });
  return GATED_SCHEMAS.map((schema) => {
    const history = rows.filter((r) => r.schema === schema);
    const last = history[history.length - 1];
    const active = last && last.revokesId === null ? last : null;
    return { schema, active, history };
  });
}

export async function recordSchemaApproval(
  actor: Actor,
  input: { schema: GatedSchema; description: string; expertName: string; approvedAt: string }
) {
  requireCapability(actor, "schema.approve");
  const zevId = requireZev(actor);
  if (!GATED_SCHEMAS.includes(input.schema)) throw new Error("Nepoznata šema.");
  const description = input.description.trim();
  const expertName = input.expertName.trim();
  if (!description) throw new Error("Opišite konkretnu šemu: konta, strane i trenutak knjiženja.");
  if (!expertName) throw new Error("Upišite ime i svojstvo stručnog lica koje je potvrdilo šemu.");
  if (!isDate(input.approvedAt)) throw new Error("Unesite datum potvrde.");
  if (await gateOpen(zevId, input.schema)) throw new Error("Šema je već potvrđena. Za izmjenu je prvo opozovite.");
  const row = await prisma.postingSchemaApproval.create({
    data: { zevId, schema: input.schema, description, expertName, approvedAt: dateOnly(input.approvedAt), recordedById: actor.userId },
  });
  await audit(actor, { action: "posting_schema.approve", targetType: "PostingSchemaApproval", targetId: row.id, after: { schema: input.schema, expertName, approvedAt: input.approvedAt } });
  return row;
}

export async function revokeSchemaApproval(actor: Actor, schema: GatedSchema, reason: string) {
  requireCapability(actor, "schema.approve");
  const zevId = requireZev(actor);
  if (!reason.trim()) throw new Error("Opoziv potvrde šeme traži razlog.");
  const last = await prisma.postingSchemaApproval.findFirst({ where: { zevId, schema }, orderBy: { createdAt: "desc" } });
  if (!last || last.revokesId !== null) throw new Error("Šema nije potvrđena.");
  const row = await prisma.postingSchemaApproval.create({
    data: { zevId, schema, description: reason.trim(), expertName: last.expertName, approvedAt: new Date(), revokesId: last.id, recordedById: actor.userId },
  });
  await audit(actor, { action: "posting_schema.revoke", targetType: "PostingSchemaApproval", targetId: row.id, after: { schema }, reason });
  return row;
}

export const ALLOCATION_RULES = ["NOT_SET", "PROPORTIONAL", "OLDEST_FIRST"] as const;
export type AllocationRule = (typeof ALLOCATION_RULES)[number];
const ALLOCATION_KEY = "ledger.partialAllocationRule";

export async function getAllocationRule(actor: Actor): Promise<AllocationRule> {
  requireCapability(actor, "ledger.view");
  const row = await prisma.setting.findUnique({ where: { zevId_key: { zevId: requireZev(actor), key: ALLOCATION_KEY } } });
  const v = String(row?.value ?? "NOT_SET");
  return (ALLOCATION_RULES as readonly string[]).includes(v) ? (v as AllocationRule) : "NOT_SET";
}

export async function setAllocationRule(actor: Actor, value: string) {
  requireCapability(actor, "rules.edit");
  const zevId = requireZev(actor);
  if (!(ALLOCATION_RULES as readonly string[]).includes(value)) throw new Error("Nepoznato pravilo raspodjele.");
  const before = await getAllocationRule(actor);
  await prisma.setting.upsert({
    where: { zevId_key: { zevId, key: ALLOCATION_KEY } },
    create: { zevId, key: ALLOCATION_KEY, value },
    update: { value },
  });
  await audit(actor, { action: "ledger.allocation_rule.set", targetType: "Zev", targetId: zevId, before: { value: before }, after: { value } });
}

// ---------------------------------------------------------------------------
// Pokrivenost (§3.6.6): šta ima pravilo, šta čeka podešavanje, šta čeka potvrdu šeme
// ---------------------------------------------------------------------------

export type CoverageStatus = "OK" | "MISSING" | "DRAFT" | "GATED";

export async function getCoverage(actor: Actor) {
  requireCapability(actor, "ledger.view");
  const zevId = requireZev(actor);
  const [chart, purposes, chargeTypes, categories, moneyAccounts, rules, controls, gates, allocationRule, unassignedItems, linesWithoutType] = await Promise.all([
    prisma.zevChart.findFirst({ where: { zevId, status: { not: "RETIRED" } } }),
    prisma.fundPurpose.findMany({ where: { zevId, active: true }, orderBy: { code: "asc" } }),
    prisma.chargeType.findMany({ where: { zevId, active: true }, include: { defaultPurpose: true }, orderBy: { code: "asc" } }),
    prisma.transactionCategory.findMany({ where: { zevId }, orderBy: { name: "asc" } }),
    prisma.moneyAccount.findMany({ where: { zevId, active: true }, orderBy: { name: "asc" } }),
    listRules(actor),
    listControlAccounts(actor),
    listGates(actor),
    getAllocationRule(actor),
    prisma.chargeItem.findMany({ where: { zevId, active: true, chargeTypeId: null }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
    prisma.invoiceLine.count({ where: { chargeTypeId: null, invoice: { zevId, status: { in: ["ISSUED", "PAID"] } } } }),
  ]);
  const reserveGateOpen = gates.find((g) => g.schema === "COMMON_RESERVE_CLASSIFICATION")?.active != null;

  const ruleRows: { kind: RuleKind; keyId: string; keyLabel: string; status: CoverageStatus; confirmed: (typeof rules)[number] | null; draft: (typeof rules)[number] | null }[] = [];
  const add = (kind: RuleKind, keyId: string, keyLabel: string, isReserve: boolean) => {
    const forKey = rules.filter((r) => r.kind === kind && (r.chargeTypeId === keyId || r.categoryId === keyId));
    const confirmed = forKey.filter((r) => r.status === "CONFIRMED").at(-1) ?? null;
    const draft = forKey.find((r) => r.status === "DRAFT") ?? null;
    const reserveRule = isReserve || (draft?.purpose?.isCommonReserve ?? false);
    const status: CoverageStatus = confirmed ? "OK" : reserveRule && !reserveGateOpen ? "GATED" : draft ? "DRAFT" : "MISSING";
    ruleRows.push({ kind, keyId, keyLabel, status, confirmed, draft });
  };
  for (const ct of chargeTypes) add("CHARGE_ISSUED", ct.id, `${ct.code} ${ct.name}`, ct.defaultPurpose?.isCommonReserve ?? false);
  for (const c of categories.filter((c) => c.kind === "EXPENSE")) {
    add("SUPPLIER_INVOICE", c.id, c.name, false);
    add("CASH_EXPENSE", c.id, c.name, false);
  }
  for (const c of categories.filter((c) => c.kind === "INCOME")) add("CASH_INCOME", c.id, c.name, false);

  const currentByKey = new Map(controls.current.map((c) => [keyOf(c), c]));
  const controlRows: { role: ControlRole; moneyAccountId: string | null; purposeId: string | null; forLabel: string; current: (typeof controls.current)[number] | null }[] = [];
  for (const m of moneyAccounts) controlRows.push({ role: "MONEY_ACCOUNT", moneyAccountId: m.id, purposeId: null, forLabel: m.name, current: currentByKey.get(keyOf({ role: "MONEY_ACCOUNT", moneyAccountId: m.id, purposeId: null })) ?? null });
  if (purposes.length === 0) {
    controlRows.push({ role: "OWNER_RECEIVABLE", moneyAccountId: null, purposeId: null, forLabel: "", current: currentByKey.get(keyOf({ role: "OWNER_RECEIVABLE", moneyAccountId: null, purposeId: null })) ?? null });
  } else {
    for (const p of purposes) {
      controlRows.push({
        role: "OWNER_RECEIVABLE", moneyAccountId: null, purposeId: p.id, forLabel: p.name,
        current: currentByKey.get(keyOf({ role: "OWNER_RECEIVABLE", moneyAccountId: null, purposeId: p.id })) ?? currentByKey.get(keyOf({ role: "OWNER_RECEIVABLE", moneyAccountId: null, purposeId: null })) ?? null,
      });
    }
  }
  for (const role of ["OWNER_ADVANCE", "UNIDENTIFIED_RECEIPTS", "SUPPLIER_PAYABLE"] as const) {
    controlRows.push({ role, moneyAccountId: null, purposeId: null, forLabel: "", current: currentByKey.get(keyOf({ role, moneyAccountId: null, purposeId: null })) ?? null });
  }

  return {
    chartStatus: chart?.status ?? null,
    purposes, chargeTypes, categories, moneyAccounts,
    ruleRows, controlRows, gates, allocationRule, unassignedItems, linesWithoutType, reserveGateOpen,
  };
}
