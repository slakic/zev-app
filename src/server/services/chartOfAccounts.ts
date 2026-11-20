// Kontni plan — Faza A1 (Plans/kontni-plan-i-knjizenje-plan.md §3.1–3.4).
//
// Predlošci su platformski (super admin); kontni plan ZEV-a je KOPIJA predloška u trenutku
// dodjele, pa izmjena ili nova verzija predloška nikad ne dira postojeće planove. Ovo nije
// knjigovodstvo: nema naloga ni knjiženja, samo šifarnik konta i poslovne godine/periodi.
//
// Pravila koja servis provodi (DB okidači i FK su druga linija odbrane, vidi migraciju
// 20261120120000_chart_of_accounts):
//  - šifra je tekst (vodeće nule ostaju), jedinstvena u planu/predlošku, po pravilima predloška;
//  - hijerarhija bez ciklusa, roditelj u istom planu; konto sa podkontima nije knjižno;
//  - u AKTIVNOM planu šifra, vrsta, zbirno/knjižno i roditelj su zaključani — promjena značenja
//    ide kroz „zamjenu konta” (novi red sa replacesId, stari deaktiviran), a briše se samo u nacrtu;
//  - deaktivacija ne briše ništa.
import { prisma } from "@/lib/prisma";
import { audit } from "@/server/audit";
import { requireCapability, requireSuperAdmin, requireZev, type Actor } from "@/server/auth/guards";
import { Prisma, type AccountNature, type ChartTemplateStatus } from "@/generated/prisma/client";
import { detectDelimiter, parseCsv } from "@/lib/csv";
import {
  ACCOUNT_NATURES,
  normalizeCode,
  parseChartCsv,
  parseCodeRules,
  parentsFirst,
  validateAccountCode,
  wouldCreateCycle,
  type CodeRules,
} from "@/lib/accountCodes";

type Tx = Prisma.TransactionClient;

const dateOnly = (s: string) => new Date(`${s}T00:00:00Z`);

function isUniqueViolation(e: unknown): boolean {
  return e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002";
}

function assertNature(n: string): AccountNature {
  if (!(ACCOUNT_NATURES as readonly string[]).includes(n)) throw new Error("Nepoznata vrsta konta.");
  return n as AccountNature;
}

// ---------------------------------------------------------------------------
// Predlošci (super admin)
// ---------------------------------------------------------------------------

export async function listTemplates(actor: Actor) {
  requireSuperAdmin(actor);
  return prisma.chartTemplate.findMany({
    include: { _count: { select: { accounts: true, zevCharts: true } } },
    orderBy: [{ key: "asc" }, { version: "desc" }],
  });
}

export async function getTemplate(actor: Actor, id: string) {
  requireSuperAdmin(actor);
  return prisma.chartTemplate.findUniqueOrThrow({
    where: { id },
    include: { accounts: { orderBy: { code: "asc" } }, _count: { select: { zevCharts: true } } },
  });
}

export type TemplateMetaInput = {
  name: string;
  jurisdiction: string;
  source?: string | null;
  note?: string | null;
  validFrom?: string | null;
  validTo?: string | null;
  codeRules: CodeRules;
};

function templateMetaData(input: TemplateMetaInput) {
  const name = input.name.trim();
  const jurisdiction = input.jurisdiction.trim();
  if (!name) throw new Error("Naziv predloška je obavezan.");
  if (!jurisdiction) throw new Error("Jurisdikcija je obavezna.");
  const validFrom = input.validFrom ? dateOnly(input.validFrom) : null;
  const validTo = input.validTo ? dateOnly(input.validTo) : null;
  if (validFrom && validTo && validTo < validFrom) throw new Error("Kraj primjene ne može biti prije početka.");
  return {
    name,
    jurisdiction,
    source: input.source?.trim() || null,
    note: input.note?.trim() || null,
    validFrom,
    validTo,
    codeRules: parseCodeRules(input.codeRules) as unknown as Prisma.InputJsonValue,
  };
}

/** Novi predložak (porodica `key`, verzija 1) ili nova verzija postojeće porodice bez konta. */
export async function createTemplate(actor: Actor, input: TemplateMetaInput & { key: string }) {
  requireSuperAdmin(actor);
  const key = input.key.trim();
  if (!/^[a-z0-9][a-z0-9-]*$/.test(key)) throw new Error("Ključ predloška: mala slova, cifre i crtice (npr. rs-kontni-okvir-pl).");
  const data = templateMetaData(input);
  const latest = await prisma.chartTemplate.findFirst({ where: { key }, orderBy: { version: "desc" } });
  if (latest) throw new Error(`Predložak „${key}” već postoji — napravite novu verziju postojećeg.`);
  const tpl = await prisma.chartTemplate.create({ data: { ...data, key, version: 1, createdById: actor.userId } });
  await audit(actor, {
    action: "chart_template.create", targetType: "ChartTemplate", targetId: tpl.id,
    after: { key, version: 1, name: tpl.name, source: tpl.source },
  });
  return tpl;
}

/** Nova verzija (DRAFT) iz postojeće: kopira podatke i konta; izvor stručne provjere se ne prenosi. */
export async function createTemplateVersion(actor: Actor, fromId: string) {
  requireSuperAdmin(actor);
  const tpl = await prisma.$transaction(async (tx) => {
    const from = await tx.chartTemplate.findUniqueOrThrow({ where: { id: fromId }, include: { accounts: true } });
    const latest = await tx.chartTemplate.findFirstOrThrow({ where: { key: from.key }, orderBy: { version: "desc" } });
    if (latest.status === "DRAFT") throw new Error(`Verzija ${latest.version} je još nacrt — dovršite nju prije nove.`);
    const created = await tx.chartTemplate.create({
      data: {
        key: from.key, version: latest.version + 1, name: from.name, jurisdiction: from.jurisdiction,
        source: from.source, note: from.note, validFrom: null, validTo: null,
        codeRules: from.codeRules as Prisma.InputJsonValue, createdById: actor.userId,
      },
    });
    await copyTemplateAccounts(tx, from.accounts, created.id);
    return created;
  });
  await audit(actor, {
    action: "chart_template.version", targetType: "ChartTemplate", targetId: tpl.id,
    after: { key: tpl.key, version: tpl.version, fromId },
  });
  return tpl;
}

async function copyTemplateAccounts(
  tx: Tx,
  accounts: { id: string; code: string; name: string; description: string | null; parentId: string | null; nature: AccountNature; postable: boolean; requiredDimensions: string[] }[],
  templateId: string
) {
  const codeById = new Map(accounts.map((a) => [a.id, a.code]));
  const rows = parentsFirst(accounts.map((a) => ({ ...a, parentCode: a.parentId ? codeById.get(a.parentId) ?? null : null })));
  const newIdByCode = new Map<string, string>();
  for (const a of rows) {
    const created = await tx.chartTemplateAccount.create({
      data: {
        templateId, code: a.code, name: a.name, description: a.description, nature: a.nature, postable: a.postable,
        requiredDimensions: a.requiredDimensions, parentId: a.parentCode ? newIdByCode.get(a.parentCode) ?? null : null,
      },
    });
    newIdByCode.set(a.code, created.id);
  }
}

async function requireDraftTemplate(tx: Tx, id: string) {
  const tpl = await tx.chartTemplate.findUniqueOrThrow({ where: { id } });
  if (tpl.status !== "DRAFT") throw new Error("Predložak više nije nacrt i ne može se mijenjati — napravite novu verziju.");
  return tpl;
}

export async function updateTemplateDraft(actor: Actor, id: string, input: TemplateMetaInput) {
  requireSuperAdmin(actor);
  const data = templateMetaData(input);
  const { before, after } = await prisma.$transaction(async (tx) => {
    const before = await requireDraftTemplate(tx, id);
    const after = await tx.chartTemplate.update({ where: { id }, data });
    return { before, after };
  });
  await audit(actor, {
    action: "chart_template.update", targetType: "ChartTemplate", targetId: id,
    before: { name: before.name, jurisdiction: before.jurisdiction, source: before.source, codeRules: before.codeRules },
    after: { name: after.name, jurisdiction: after.jurisdiction, source: after.source, codeRules: after.codeRules },
  });
  return after;
}

/**
 * Uvoz konta u NACRT predloška iz CSV-a (zamjenjuje sva njegova konta). Ništa se ne upisuje ako
 * ijedan red ima grešku — greške se vraćaju sa brojem reda.
 */
export async function importTemplateAccounts(
  actor: Actor,
  id: string,
  csvText: string
): Promise<{ ok: true; count: number } | { ok: false; errors: string[] }> {
  requireSuperAdmin(actor);
  const tpl = await prisma.chartTemplate.findUniqueOrThrow({ where: { id } });
  if (tpl.status !== "DRAFT") throw new Error("Konta se uvoze samo u nacrt predloška.");
  const text = csvText.replace(/^﻿/, "");
  if (!text.trim()) return { ok: false, errors: ["Fajl je prazan."] };
  const { rows, errors } = parseChartCsv(parseCsv(text, detectDelimiter(text)), parseCodeRules(tpl.codeRules));
  if (errors.length > 0) return { ok: false, errors };
  if (rows.length === 0) return { ok: false, errors: ["Fajl nema nijedno konto."] };

  await prisma.$transaction(async (tx) => {
    await requireDraftTemplate(tx, id);
    // Prvo odvezati djecu od roditelja (FK je RESTRICT), pa obrisati — nacrt nema kopija u ZEV-ovima.
    await tx.chartTemplateAccount.updateMany({ where: { templateId: id }, data: { parentId: null } });
    await tx.chartTemplateAccount.deleteMany({ where: { templateId: id } });
    const idByCode = new Map<string, string>();
    for (const r of parentsFirst(rows)) {
      const created = await tx.chartTemplateAccount.create({
        data: {
          templateId: id, code: r.code, name: r.name, description: r.description, nature: r.nature, postable: r.postable,
          parentId: r.parentCode ? idByCode.get(r.parentCode) ?? null : null,
        },
      });
      idByCode.set(r.code, created.id);
    }
  }, { timeout: 60_000 });
  await audit(actor, {
    action: "chart_template.import", targetType: "ChartTemplate", targetId: id,
    after: { count: rows.length },
  });
  return { ok: true, count: rows.length };
}

/**
 * Promjena statusa predloška: DRAFT → DEMO, DRAFT → REVIEWED (izvor, ko je provjerio i kada su
 * obavezni), DEMO/REVIEWED → RETIRED. Povučen predložak ostaje izvor postojećih planova.
 */
export async function setTemplateStatus(
  actor: Actor,
  id: string,
  target: "DEMO" | "REVIEWED" | "RETIRED",
  review?: { source?: string | null; reviewedBy?: string | null; reviewedAt?: string | null }
) {
  requireSuperAdmin(actor);
  const { before, after } = await prisma.$transaction(async (tx) => {
    const before = await tx.chartTemplate.findUniqueOrThrow({ where: { id }, include: { accounts: true } });
    const allowed: Record<ChartTemplateStatus, ChartTemplateStatus[]> = {
      DRAFT: ["DEMO", "REVIEWED"], DEMO: ["RETIRED"], REVIEWED: ["RETIRED"], RETIRED: [],
    };
    if (!allowed[before.status].includes(target)) throw new Error("Ova promjena statusa predloška nije dozvoljena.");
    const data: Prisma.ChartTemplateUpdateInput = { status: target };
    if (target === "DEMO" || target === "REVIEWED") {
      if (before.accounts.length === 0) throw new Error("Predložak nema nijedno konto.");
      if (!before.accounts.some((a) => a.postable)) throw new Error("Predložak nema nijedno knjižno konto.");
      const parents = new Set(before.accounts.map((a) => a.parentId).filter(Boolean));
      const bad = before.accounts.find((a) => a.postable && parents.has(a.id));
      if (bad) throw new Error(`Konto „${bad.code}” ima podkonta, pa ne može biti knjižno.`);
    }
    if (target === "REVIEWED") {
      const source = review?.source?.trim() || before.source;
      const reviewedBy = review?.reviewedBy?.trim();
      if (!source) throw new Error("Za provjeren predložak izvor (propis) je obavezan.");
      if (!reviewedBy) throw new Error("Upišite ime i svojstvo stručnog lica koje je provjerilo predložak.");
      if (!review?.reviewedAt) throw new Error("Upišite datum stručne provjere.");
      Object.assign(data, { source, reviewedBy, reviewedAt: dateOnly(review.reviewedAt) });
    }
    const after = await tx.chartTemplate.update({ where: { id }, data });
    return { before, after };
  });
  await audit(actor, {
    action: "chart_template.status", targetType: "ChartTemplate", targetId: id,
    before: { status: before.status },
    after: { status: after.status, source: after.source, reviewedBy: after.reviewedBy, reviewedAt: after.reviewedAt },
  });
  return after;
}

// ---------------------------------------------------------------------------
// Kontni plan ZEV-a
// ---------------------------------------------------------------------------

async function lockZev(tx: Tx, zevId: string) {
  await tx.$queryRaw`SELECT id FROM "Zev" WHERE id = ${zevId} FOR UPDATE`;
}

/** Predlošci koje ZEV smije preuzeti: provjereni (i DEMO samo za demo ZEV), čija primjena nije istekla. */
export async function listAssignableTemplates(actor: Actor) {
  requireCapability(actor, "chart.edit");
  const zevId = requireZev(actor);
  const zev = await prisma.zev.findUniqueOrThrow({ where: { id: zevId }, select: { isDemo: true } });
  const statuses: ChartTemplateStatus[] = zev.isDemo ? ["REVIEWED", "DEMO"] : ["REVIEWED"];
  const now = new Date();
  return prisma.chartTemplate.findMany({
    where: { status: { in: statuses }, OR: [{ validTo: null }, { validTo: { gte: now } }] },
    include: { _count: { select: { accounts: true } } },
    orderBy: [{ key: "asc" }, { version: "desc" }],
  });
}

/** Trenutni (ne-povučen) kontni plan ZEV-a sa kontima, ili null. */
export async function getZevChart(actor: Actor) {
  requireCapability(actor, "ledger.view");
  const zevId = requireZev(actor);
  return prisma.zevChart.findFirst({
    where: { zevId, status: { not: "RETIRED" } },
    include: {
      sourceTemplate: { select: { id: true, key: true, version: true, name: true, jurisdiction: true, source: true, status: true, reviewedBy: true, reviewedAt: true } },
      accounts: { orderBy: { code: "asc" } },
    },
  });
}

export async function countRetiredCharts(actor: Actor): Promise<number> {
  requireCapability(actor, "ledger.view");
  return prisma.zevChart.count({ where: { zevId: requireZev(actor), status: "RETIRED" } });
}

/** Dodjela kontnog plana iz predloška: kopija konta, status DRAFT. Najviše jedan ne-povučen plan. */
export async function assignChart(actor: Actor, templateId: string) {
  requireCapability(actor, "chart.edit");
  const zevId = requireZev(actor);
  const chart = await prisma.$transaction(async (tx) => {
    await lockZev(tx, zevId);
    const existing = await tx.zevChart.findFirst({ where: { zevId, status: { not: "RETIRED" } } });
    if (existing) throw new Error("ZEV već ima kontni plan. Povucite ga prije dodjele novog.");
    const zev = await tx.zev.findUniqueOrThrow({ where: { id: zevId }, select: { isDemo: true } });
    const tpl = await tx.chartTemplate.findUniqueOrThrow({ where: { id: templateId }, include: { accounts: true } });
    if (tpl.status === "DEMO" && !zev.isDemo) throw new Error("Demonstracioni predložak se ne može dodijeliti stvarnom ZEV-u.");
    if (tpl.status !== "REVIEWED" && tpl.status !== "DEMO") throw new Error("Dodijeliti se može samo stručno provjeren predložak.");
    if (tpl.validTo && tpl.validTo < new Date()) throw new Error("Primjena ovog predloška je istekla.");
    const created = await tx.zevChart.create({
      data: { zevId, sourceTemplateId: tpl.id, codeRules: tpl.codeRules as Prisma.InputJsonValue, createdById: actor.userId },
    });
    const codeById = new Map(tpl.accounts.map((a) => [a.id, a.code]));
    const rows = parentsFirst(tpl.accounts.map((a) => ({ ...a, parentCode: a.parentId ? codeById.get(a.parentId) ?? null : null })));
    const idByCode = new Map<string, string>();
    for (const a of rows) {
      const acc = await tx.zevAccount.create({
        data: {
          zevId, chartId: created.id, templateAccountId: a.id, code: a.code, name: a.name, description: a.description,
          nature: a.nature, postable: a.postable, requiredDimensions: a.requiredDimensions,
          parentId: a.parentCode ? idByCode.get(a.parentCode) ?? null : null,
        },
      });
      idByCode.set(a.code, acc.id);
    }
    return created;
  }, { timeout: 60_000 });
  await audit(actor, {
    action: "zev_chart.assign", targetType: "ZevChart", targetId: chart.id,
    after: { templateId, status: chart.status },
  });
  return chart;
}

async function currentChartInTx(tx: Tx, zevId: string) {
  const chart = await tx.zevChart.findFirst({ where: { zevId, status: { not: "RETIRED" } } });
  if (!chart) throw new Error("ZEV još nema kontni plan.");
  return chart;
}

export async function activateChart(actor: Actor) {
  requireCapability(actor, "chart.edit");
  const zevId = requireZev(actor);
  const chart = await prisma.$transaction(async (tx) => {
    await lockZev(tx, zevId);
    const chart = await currentChartInTx(tx, zevId);
    if (chart.status !== "DRAFT") throw new Error("Kontni plan je već aktivan.");
    const accounts = await tx.zevAccount.findMany({ where: { chartId: chart.id } });
    if (!accounts.some((a) => a.postable && a.active)) throw new Error("Plan nema nijedno aktivno knjižno konto.");
    const parents = new Set(accounts.filter((a) => a.active).map((a) => a.parentId).filter(Boolean));
    const bad = accounts.find((a) => a.postable && parents.has(a.id));
    if (bad) throw new Error(`Konto „${bad.code}” ima podkonta, pa ne može biti knjižno.`);
    return tx.zevChart.update({ where: { id: chart.id }, data: { status: "ACTIVE", activatedAt: new Date() } });
  });
  await audit(actor, {
    action: "zev_chart.activate", targetType: "ZevChart", targetId: chart.id,
    before: { status: "DRAFT" }, after: { status: "ACTIVE" },
  });
  return chart;
}

export async function retireChart(actor: Actor, reason: string) {
  requireCapability(actor, "chart.edit");
  const zevId = requireZev(actor);
  if (!reason.trim()) throw new Error("Povlačenje kontnog plana zahtijeva razlog.");
  const { before, after } = await prisma.$transaction(async (tx) => {
    await lockZev(tx, zevId);
    const before = await currentChartInTx(tx, zevId);
    const after = await tx.zevChart.update({ where: { id: before.id }, data: { status: "RETIRED", retiredAt: new Date() } });
    return { before, after };
  });
  await audit(actor, {
    action: "zev_chart.retire", targetType: "ZevChart", targetId: after.id,
    before: { status: before.status }, after: { status: "RETIRED" }, reason,
  });
  return after;
}

/** Konto ZEV-a sa nadređenim, podkontima i vezama zamjene — za stranicu konta. */
export async function getZevAccount(actor: Actor, id: string) {
  requireCapability(actor, "ledger.view");
  const zevId = requireZev(actor);
  return prisma.zevAccount.findUniqueOrThrow({
    where: { id, zevId },
    include: {
      chart: { select: { id: true, status: true, codeRules: true } },
      parent: { select: { id: true, code: true, name: true } },
      children: { select: { id: true, code: true, name: true, active: true, postable: true }, orderBy: { code: "asc" } },
      replaces: { select: { id: true, code: true, name: true } },
      replacedBy: { select: { id: true, code: true, name: true } },
      templateAccount: { select: { code: true, name: true } },
    },
  });
}

async function depthOf(tx: Tx, parentId: string | null): Promise<number> {
  let depth = 1;
  let cur = parentId;
  while (cur) {
    depth += 1;
    const p = await tx.zevAccount.findUnique({ where: { id: cur }, select: { parentId: true } });
    cur = p?.parentId ?? null;
    if (depth > 64) break;
  }
  return depth;
}

export type NewAccountInput = {
  parentId?: string | null;
  code: string;
  name: string;
  description?: string | null;
  nature?: string | null;
  postable: boolean;
};

/** Novi konto (lokalna analitička razrada). U aktivnom planu samo ispod zbirnog konta. */
export async function addAccount(actor: Actor, input: NewAccountInput) {
  requireCapability(actor, "chart.edit");
  const zevId = requireZev(actor);
  const code = normalizeCode(input.code);
  const name = input.name.trim();
  if (!name) throw new Error("Naziv konta je obavezan.");
  try {
    const acc = await prisma.$transaction(async (tx) => {
      const chart = await currentChartInTx(tx, zevId);
      const parent = input.parentId
        ? await tx.zevAccount.findUnique({ where: { id: input.parentId, zevId } })
        : null;
      if (input.parentId && (!parent || parent.chartId !== chart.id)) throw new Error("Nadređeni konto nije u kontnom planu ovog ZEV-a.");
      if (parent && !parent.active) throw new Error("Nadređeni konto je neaktivan.");
      if (parent && parent.postable) {
        throw new Error(`Konto „${parent.code}” je knjižno. Podkonto se dodaje samo zbirnom kontu${chart.status === "DRAFT" ? " — prvo ga označite kao zbirno" : ""}.`);
      }
      if (!parent && chart.status === "ACTIVE") throw new Error("U aktivnom planu novi konto mora imati nadređeni (zbirni) konto.");
      const nature = assertNature(input.nature || parent?.nature || "");
      const err = validateAccountCode(code, parseCodeRules(chart.codeRules), {
        parentCode: parent?.code ?? null,
        depth: await depthOf(tx, parent?.id ?? null),
      });
      if (err) throw new Error(err);
      return tx.zevAccount.create({
        data: {
          zevId, chartId: chart.id, code, name, description: input.description?.trim() || null,
          nature, postable: input.postable, parentId: parent?.id ?? null,
        },
      });
    });
    await audit(actor, {
      action: "zev_account.create", targetType: "ZevAccount", targetId: acc.id,
      after: { code: acc.code, name: acc.name, nature: acc.nature, postable: acc.postable, parentId: acc.parentId },
    });
    return acc;
  } catch (e) {
    if (isUniqueViolation(e)) throw new Error(`Konto sa šifrom „${code}” već postoji u kontnom planu.`);
    throw e;
  }
}

export type AccountUpdateInput = {
  name: string;
  description?: string | null;
  /** Samo u nacrtu plana: */
  code?: string;
  nature?: string;
  postable?: boolean;
  parentId?: string | null;
};

/**
 * Izmjena konta. Naziv i opis uvijek (uz trag); šifra, vrsta, zbirno/knjižno i roditelj samo dok je
 * plan nacrt — u aktivnom planu je to „zamjena konta”.
 */
export async function updateAccount(actor: Actor, id: string, input: AccountUpdateInput) {
  requireCapability(actor, "chart.edit");
  const zevId = requireZev(actor);
  const name = input.name.trim();
  if (!name) throw new Error("Naziv konta je obavezan.");
  const code = input.code !== undefined ? normalizeCode(input.code) : undefined;
  try {
    const { before, after } = await prisma.$transaction(async (tx) => {
      const before = await tx.zevAccount.findUniqueOrThrow({ where: { id, zevId }, include: { chart: true, children: { select: { id: true } } } });
      if (before.chart.status === "RETIRED") throw new Error("Povučen kontni plan se ne mijenja.");
      const data: Prisma.ZevAccountUncheckedUpdateInput = { name, description: input.description?.trim() || null };
      const structural =
        (code !== undefined && code !== before.code) ||
        (input.nature !== undefined && input.nature !== before.nature) ||
        (input.postable !== undefined && input.postable !== before.postable) ||
        (input.parentId !== undefined && (input.parentId || null) !== before.parentId);
      if (structural) {
        if (before.chart.status !== "DRAFT") {
          throw new Error("U aktivnom planu šifra, vrsta, zbirno/knjižno i nadređeni konto se ne mijenjaju — koristite „Zamijeni konto”.");
        }
        const hasChildren = before.children.length > 0;
        const parentId = input.parentId !== undefined ? input.parentId || null : before.parentId;
        const nextCode = code ?? before.code;
        if (input.postable === true && hasChildren) throw new Error("Konto sa podkontima ne može biti knjižno.");
        if (code !== undefined && code !== before.code && hasChildren && parseCodeRules(before.chart.codeRules).childExtendsParent) {
          throw new Error("Šifra konta sa podkontima se ne mijenja, jer šifre podkonta počinju njom.");
        }
        let parentCode: string | null = null;
        if (parentId) {
          const parent = await tx.zevAccount.findUnique({ where: { id: parentId, zevId } });
          if (!parent || parent.chartId !== before.chartId) throw new Error("Nadređeni konto nije u istom kontnom planu.");
          if (parent.postable) throw new Error(`Konto „${parent.code}” je knjižno i ne može imati podkonta.`);
          const nodes = await tx.zevAccount.findMany({ where: { chartId: before.chartId }, select: { id: true, code: true, parentId: true } });
          if (wouldCreateCycle(nodes, id, parentId)) throw new Error("Hijerarhija konta ne smije imati ciklus.");
          parentCode = parent.code;
        }
        const err = validateAccountCode(nextCode, parseCodeRules(before.chart.codeRules), { parentCode, depth: await depthOf(tx, parentId) });
        if (err) throw new Error(err);
        Object.assign(data, {
          code: nextCode,
          nature: input.nature !== undefined ? assertNature(input.nature) : before.nature,
          postable: input.postable ?? before.postable,
          parentId,
        });
      }
      const after = await tx.zevAccount.update({ where: { id, zevId }, data });
      return { before, after };
    });
    await audit(actor, {
      action: "zev_account.update", targetType: "ZevAccount", targetId: id,
      before: { code: before.code, name: before.name, description: before.description, nature: before.nature, postable: before.postable, parentId: before.parentId },
      after: { code: after.code, name: after.name, description: after.description, nature: after.nature, postable: after.postable, parentId: after.parentId },
    });
    return after;
  } catch (e) {
    if (isUniqueViolation(e)) throw new Error(`Konto sa šifrom „${code}” već postoji u kontnom planu.`);
    throw e;
  }
}

export async function deactivateAccount(actor: Actor, id: string, reason: string) {
  requireCapability(actor, "chart.edit");
  const zevId = requireZev(actor);
  if (!reason.trim()) throw new Error("Deaktivacija konta zahtijeva razlog.");
  const acc = await prisma.$transaction(async (tx) => {
    const acc = await tx.zevAccount.findUniqueOrThrow({ where: { id, zevId }, include: { chart: true } });
    if (acc.chart.status === "RETIRED") throw new Error("Povučen kontni plan se ne mijenja.");
    if (!acc.active) throw new Error("Konto je već neaktivan.");
    const activeChildren = await tx.zevAccount.count({ where: { parentId: id, active: true } });
    if (activeChildren > 0) throw new Error("Prvo deaktivirajte podkonta ovog konta.");
    return tx.zevAccount.update({ where: { id, zevId }, data: { active: false, deactivatedAt: new Date() } });
  });
  await audit(actor, {
    action: "zev_account.deactivate", targetType: "ZevAccount", targetId: id,
    before: { active: true }, after: { active: false }, reason,
  });
  return acc;
}

export async function reactivateAccount(actor: Actor, id: string) {
  requireCapability(actor, "chart.edit");
  const zevId = requireZev(actor);
  const acc = await prisma.$transaction(async (tx) => {
    const acc = await tx.zevAccount.findUniqueOrThrow({ where: { id, zevId }, include: { chart: true, parent: true, replacedBy: true } });
    if (acc.chart.status === "RETIRED") throw new Error("Povučen kontni plan se ne mijenja.");
    if (acc.active) throw new Error("Konto je već aktivan.");
    if (acc.replacedBy) throw new Error(`Konto je zamijenjen kontom „${acc.replacedBy.code}” i ne aktivira se ponovo.`);
    if (acc.parent && !acc.parent.active) throw new Error("Prvo aktivirajte nadređeni konto.");
    return tx.zevAccount.update({ where: { id, zevId }, data: { active: true, deactivatedAt: null } });
  });
  await audit(actor, {
    action: "zev_account.reactivate", targetType: "ZevAccount", targetId: id,
    before: { active: false }, after: { active: true },
  });
  return acc;
}

/**
 * Zamjena konta u aktivnom planu (promjena šifre ili značenja): novi konto pod istim nadređenim,
 * sa vezom na stari; stari se deaktivira i ostaje u planu sa svom istorijom.
 */
export async function replaceAccount(
  actor: Actor,
  id: string,
  input: { code: string; name: string; description?: string | null; nature: string; postable: boolean },
  reason: string
) {
  requireCapability(actor, "chart.edit");
  const zevId = requireZev(actor);
  if (!reason.trim()) throw new Error("Zamjena konta zahtijeva razlog.");
  const code = normalizeCode(input.code);
  const name = input.name.trim();
  if (!name) throw new Error("Naziv novog konta je obavezan.");
  try {
    const { old, created } = await prisma.$transaction(async (tx) => {
      const old = await tx.zevAccount.findUniqueOrThrow({ where: { id, zevId }, include: { chart: true, parent: true, children: { select: { id: true } }, replacedBy: true } });
      if (old.chart.status !== "ACTIVE") throw new Error("Zamjena konta postoji samo u aktivnom planu; u nacrtu konto izmijenite direktno.");
      if (!old.active) throw new Error("Neaktivan konto se ne zamjenjuje.");
      if (old.replacedBy) throw new Error("Konto je već zamijenjen.");
      if (old.children.length > 0) throw new Error("Zamjenjuje se samo konto bez podkonta.");
      const err = validateAccountCode(code, parseCodeRules(old.chart.codeRules), {
        parentCode: old.parent?.code ?? null,
        depth: await depthOf(tx, old.parentId),
      });
      if (err) throw new Error(err);
      await tx.zevAccount.update({ where: { id, zevId }, data: { active: false, deactivatedAt: new Date() } });
      const created = await tx.zevAccount.create({
        data: {
          zevId, chartId: old.chartId, parentId: old.parentId, code, name, description: input.description?.trim() || null,
          nature: assertNature(input.nature), postable: input.postable, requiredDimensions: old.requiredDimensions, replacesId: old.id,
        },
      });
      return { old, created };
    });
    await audit(actor, {
      action: "zev_account.replace", targetType: "ZevAccount", targetId: created.id,
      before: { id: old.id, code: old.code, name: old.name, nature: old.nature, postable: old.postable },
      after: { id: created.id, code: created.code, name: created.name, nature: created.nature, postable: created.postable },
      reason,
    });
    return created;
  } catch (e) {
    if (isUniqueViolation(e)) throw new Error(`Konto sa šifrom „${code}” već postoji u kontnom planu.`);
    throw e;
  }
}

/** Brisanje konta — samo u nacrtu plana i samo bez podkonta; u aktivnom planu postoji samo deaktivacija. */
export async function deleteAccount(actor: Actor, id: string) {
  requireCapability(actor, "chart.edit");
  const zevId = requireZev(actor);
  const acc = await prisma.$transaction(async (tx) => {
    const acc = await tx.zevAccount.findUniqueOrThrow({ where: { id, zevId }, include: { chart: true, children: { select: { id: true } } } });
    if (acc.chart.status !== "DRAFT") throw new Error("Konto aktivnog plana se ne briše — možete ga deaktivirati.");
    if (acc.children.length > 0) throw new Error("Prvo obrišite podkonta ovog konta.");
    await tx.zevAccount.delete({ where: { id, zevId } });
    return acc;
  });
  await audit(actor, {
    action: "zev_account.delete", targetType: "ZevAccount", targetId: id,
    before: { code: acc.code, name: acc.name },
  });
  return acc;
}

// ---------------------------------------------------------------------------
// Poslovne godine i periodi
// ---------------------------------------------------------------------------

export async function listFiscalYears(actor: Actor) {
  requireCapability(actor, "ledger.view");
  return prisma.fiscalYear.findMany({
    where: { zevId: requireZev(actor) },
    include: { periods: { orderBy: { startDate: "asc" } } },
    orderBy: { startDate: "desc" },
  });
}

/** Mjesečni periodi od početka do kraja godine (prvi/posljednji mogu biti djelimični). */
export function monthlyPeriods(start: Date, end: Date): { label: string; startDate: Date; endDate: Date }[] {
  const out: { label: string; startDate: Date; endDate: Date }[] = [];
  let cur = start;
  while (cur <= end) {
    const y = cur.getUTCFullYear();
    const m = cur.getUTCMonth();
    const lastOfMonth = new Date(Date.UTC(y, m + 1, 0));
    const periodEnd = lastOfMonth < end ? lastOfMonth : end;
    out.push({ label: `${y}-${String(m + 1).padStart(2, "0")}`, startDate: cur, endDate: periodEnd });
    cur = new Date(Date.UTC(y, m + 1, 1));
  }
  return out;
}

/**
 * Otvaranje poslovne godine (A1: samo otvaranje; zatvaranje je Faza B). Datumi su dani
 * („GGGG-MM-DD”), kraj uključivo. Godine istog ZEV-a se ne preklapaju.
 */
export async function openFiscalYear(
  actor: Actor,
  input: { label: string; startDate: string; endDate: string; periodicity: "MONTHLY" | "YEARLY" }
) {
  requireCapability(actor, "period.open");
  const zevId = requireZev(actor);
  const label = input.label.trim();
  if (!label) throw new Error("Oznaka poslovne godine je obavezna.");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.startDate) || !/^\d{4}-\d{2}-\d{2}$/.test(input.endDate)) throw new Error("Unesite datum početka i kraja.");
  const start = dateOnly(input.startDate);
  const end = dateOnly(input.endDate);
  if (end < start) throw new Error("Kraj poslovne godine ne može biti prije početka.");
  const days = (end.getTime() - start.getTime()) / 86_400_000 + 1;
  if (days > 366 * 2) throw new Error("Poslovna godina ne može trajati duže od dvije godine.");
  try {
    const year = await prisma.$transaction(async (tx) => {
      await lockZev(tx, zevId);
      const overlap = await tx.fiscalYear.findFirst({ where: { zevId, startDate: { lte: end }, endDate: { gte: start } } });
      if (overlap) throw new Error(`Period se preklapa sa poslovnom godinom „${overlap.label}”.`);
      const year = await tx.fiscalYear.create({ data: { zevId, label, startDate: start, endDate: end, createdById: actor.userId } });
      const periods = input.periodicity === "MONTHLY" ? monthlyPeriods(start, end) : [{ label, startDate: start, endDate: end }];
      await tx.fiscalPeriod.createMany({ data: periods.map((p) => ({ ...p, zevId, yearId: year.id })) });
      return year;
    });
    await audit(actor, {
      action: "fiscal_year.open", targetType: "FiscalYear", targetId: year.id,
      after: { label, startDate: input.startDate, endDate: input.endDate, periodicity: input.periodicity },
    });
    return year;
  } catch (e) {
    if (isUniqueViolation(e)) throw new Error(`Poslovna godina „${label}” već postoji.`);
    throw e;
  }
}
