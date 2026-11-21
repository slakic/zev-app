// Faza B1a — nalozi za knjiženje (Plans/kontni-plan-b1-nalozi-plan.md §3).
//
// Nacrt se slobodno mijenja i briše; knjiženje dodjeljuje broj i zaključava nalog. Sve kontrole su u jednoj
// transakciji, a baza ih ponavlja (CHECK na stavci, okidač nepromjenjivosti, odložena provjera ravnoteže).
// Ručni nalog ne smije koristiti kontrolna konta (B1-Q5 (a)) — ona se mijenjaju samo kroz događaje (B2),
// storno i nalog početnog stanja (B1b), da analitika i glavna knjiga ostanu usklađene.
import { prisma } from "@/lib/prisma";
import { audit } from "@/server/audit";
import { hasRole, requireCapability, requireZev, ForbiddenError, type Actor } from "@/server/auth/guards";
import { Prisma, type JournalKind, type Role } from "@/generated/prisma/client";
import { dec, sumDecimals, ZERO } from "@/lib/money";
import { endOfDay, toZonedDateIso } from "@/lib/i18n";

type Tx = Prisma.TransactionClient;

const dateOnly = (s: string) => new Date(`${s}T00:00:00Z`);
const isDate = (s: string | null | undefined): s is string => !!s && /^\d{4}-\d{2}-\d{2}$/.test(s);

export type JournalLineInput = {
  accountId: string;
  debit?: string | null;
  credit?: string | null;
  partyId?: string | null;
  unitId?: string | null;
  supplierId?: string | null;
  projectId?: string | null;
  purposeId?: string | null;
  description?: string | null;
};

export type JournalDraftInput = {
  documentDate: string;
  postingDate: string;
  description: string;
  lines: JournalLineInput[];
};

// ---------------------------------------------------------------------------
// Čitanje
// ---------------------------------------------------------------------------

export async function listEntries(actor: Actor, filter: { periodId?: string | null; status?: string | null } = {}) {
  requireCapability(actor, "ledger.view");
  const zevId = requireZev(actor);
  const entries = await prisma.journalEntry.findMany({
    where: {
      zevId,
      periodId: filter.periodId || undefined,
      status: filter.status === "DRAFT" || filter.status === "POSTED" ? filter.status : undefined,
    },
    include: { lines: { select: { debit: true } }, period: { select: { label: true } }, reversedBy: { select: { id: true, number: true } } },
    orderBy: [{ postingDate: "desc" }, { createdAt: "desc" }],
    take: 500,
  });
  return entries.map((e) => ({ ...e, total: sumDecimals(e.lines.map((l) => dec(l.debit.toString()))).toFixed(2) }));
}

export async function getEntry(actor: Actor, id: string) {
  requireCapability(actor, "ledger.view");
  const zevId = requireZev(actor);
  return prisma.journalEntry.findUniqueOrThrow({
    where: { id, zevId },
    include: {
      period: true,
      year: true,
      reversalOf: { select: { id: true, number: true } },
      reversedBy: { select: { id: true, number: true } },
      lines: {
        orderBy: { order: "asc" },
        include: {
          account: { select: { id: true, code: true, name: true } },
          party: { select: { id: true, kind: true, firstName: true, lastName: true, orgName: true } },
          unit: { select: { id: true, label: true } },
          supplier: { select: { id: true, name: true } },
          project: { select: { id: true, name: true } },
          purpose: { select: { id: true, code: true, name: true } },
        },
      },
    },
  });
}

/** Šifarnici za uređivač naloga: knjižna aktivna konta (bez kontrolnih — B1-Q5) i dimenzije ZEV-a. */
export async function editorOptions(actor: Actor) {
  requireCapability(actor, "journal.prepare");
  const zevId = requireZev(actor);
  const chart = await prisma.zevChart.findFirst({ where: { zevId, status: "ACTIVE" } });
  const [accounts, control, parties, units, suppliers, projects, purposes] = await Promise.all([
    chart ? prisma.zevAccount.findMany({ where: { chartId: chart.id, postable: true, active: true }, orderBy: { code: "asc" }, select: { id: true, code: true, name: true } }) : Promise.resolve([]),
    prisma.zevControlAccount.findMany({ where: { zevId }, select: { accountId: true } }),
    prisma.party.findMany({ where: { zevId, active: true }, select: { id: true, kind: true, firstName: true, lastName: true, orgName: true }, orderBy: [{ lastName: "asc" }, { orgName: "asc" }] }),
    prisma.unit.findMany({ where: { zevId, active: true }, select: { id: true, label: true }, orderBy: { label: "asc" } }),
    prisma.supplier.findMany({ where: { zevId, active: true }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
    prisma.project.findMany({ where: { zevId }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
    prisma.fundPurpose.findMany({ where: { zevId, active: true }, select: { id: true, code: true, name: true }, orderBy: { code: "asc" } }),
  ]);
  const controlIds = new Set(control.map((c) => c.accountId));
  return { hasActiveChart: !!chart, accounts: accounts.filter((a) => !controlIds.has(a.id)), parties, units, suppliers, projects, purposes };
}

// ---------------------------------------------------------------------------
// Provjere
// ---------------------------------------------------------------------------

/** Period u koji pada datum knjiženja; mora postojati i biti otvoren (sa godinom). */
async function openPeriodFor(tx: Tx, zevId: string, postingDate: Date, lock: boolean) {
  const period = await tx.fiscalPeriod.findFirst({
    where: { zevId, startDate: { lte: postingDate }, endDate: { gte: postingDate } },
    include: { year: true },
  });
  if (!period) throw new Error("Za datum knjiženja ne postoji poslovna godina — otvorite je na tabu „Poslovne godine”.");
  if (lock) await tx.$queryRaw`SELECT id FROM "FiscalPeriod" WHERE id = ${period.id} FOR UPDATE`;
  const fresh = lock ? await tx.fiscalPeriod.findUniqueOrThrow({ where: { id: period.id } }) : period;
  if (fresh.status !== "OPEN" || period.year.status !== "OPEN") throw new Error(`Period ${period.label} je zatvoren — u njega se ne knjiži.`);
  return period;
}

type NormalizedLine = Required<Omit<JournalLineInput, "debit" | "credit">> & { debit: Prisma.Decimal; credit: Prisma.Decimal };

export function normalizeLines(lines: JournalLineInput[]): NormalizedLine[] {
  const out = lines
    .filter((l) => l.accountId || l.debit || l.credit)
    .map((l, i) => {
      const debit = l.debit?.trim() ? dec(l.debit.replace(",", ".")) : ZERO;
      const credit = l.credit?.trim() ? dec(l.credit.replace(",", ".")) : ZERO;
      if (!l.accountId) throw new Error(`Stavka ${i + 1}: izaberite konto.`);
      if (debit.isNegative() || credit.isNegative()) throw new Error(`Stavka ${i + 1}: iznos ne može biti negativan.`);
      if (debit.decimalPlaces() > 2 || credit.decimalPlaces() > 2) throw new Error(`Stavka ${i + 1}: iznos ima najviše dvije decimale.`);
      if (debit.gt(0) === credit.gt(0)) throw new Error(`Stavka ${i + 1}: upišite iznos tačno na jednoj strani (duguje ili potražuje).`);
      return {
        accountId: l.accountId, debit, credit,
        partyId: l.partyId || null, unitId: l.unitId || null, supplierId: l.supplierId || null,
        projectId: l.projectId || null, purposeId: l.purposeId || null, description: l.description?.trim() || null,
      } as NormalizedLine;
    });
  return out;
}

/**
 * Konta i dimenzije stavki: aktivno knjižno konto aktivnog plana ZEV-a, dimenzije iz istog ZEV-a, obavezne dimenzije
 * konta popunjene, ručni nalog bez kontrolnih konta.
 */
export async function checkLines(tx: Tx, zevId: string, kind: JournalKind, lines: NormalizedLine[], controlMessage?: string) {
  const chart = await tx.zevChart.findFirst({ where: { zevId, status: "ACTIVE" } });
  if (!chart) throw new Error("Kontni plan ZEV-a nije aktivan.");
  const accountIds = [...new Set(lines.map((l) => l.accountId))];
  const accounts = await tx.zevAccount.findMany({ where: { id: { in: accountIds }, zevId } });
  const byId = new Map(accounts.map((a) => [a.id, a]));
  const controlIds = new Set((await tx.zevControlAccount.findMany({ where: { zevId }, select: { accountId: true } })).map((c) => c.accountId));
  const ensure = async (ids: (string | null)[], model: "party" | "unit" | "supplier" | "project" | "fundPurpose", label: string) => {
    const want = [...new Set(ids.filter((x): x is string => !!x))];
    if (want.length === 0) return;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const found = await (tx[model] as any).count({ where: { id: { in: want }, zevId } });
    if (found !== want.length) throw new Error(`${label} nije iz ovog ZEV-a.`);
  };
  await ensure(lines.map((l) => l.partyId), "party", "Vlasnik/lice");
  await ensure(lines.map((l) => l.unitId), "unit", "Poseban dio");
  await ensure(lines.map((l) => l.supplierId), "supplier", "Dobavljač");
  await ensure(lines.map((l) => l.projectId), "project", "Projekat");
  await ensure(lines.map((l) => l.purposeId), "fundPurpose", "Namjena");
  lines.forEach((l, i) => {
    const a = byId.get(l.accountId);
    if (!a || a.chartId !== chart.id) throw new Error(`Stavka ${i + 1}: konto nije u aktivnom kontnom planu ZEV-a.`);
    if (!a.postable) throw new Error(`Stavka ${i + 1}: konto „${a.code}” je zbirno — knjiži se samo na knjižna konta.`);
    if (!a.active) throw new Error(`Stavka ${i + 1}: konto „${a.code}” je neaktivno.`);
    if (kind === "MANUAL" && controlIds.has(a.id)) {
      throw new Error(`Stavka ${i + 1}: konto „${a.code}” je kontrolno konto — ${controlMessage ?? "ručni nalog ga ne koristi (mijenja se kroz događaje, storno i početno stanje)."}`);
    }
    const dims: Record<string, string | null> = { PARTY: l.partyId, UNIT: l.unitId, SUPPLIER: l.supplierId, PROJECT: l.projectId, PURPOSE: l.purposeId };
    for (const d of a.requiredDimensions) {
      if (d in dims && !dims[d]) throw new Error(`Stavka ${i + 1}: konto „${a.code}” traži analitiku (${d.toLowerCase()}).`);
    }
  });
}

function totals(lines: { debit: Prisma.Decimal; credit: Prisma.Decimal }[]) {
  return { debit: sumDecimals(lines.map((l) => l.debit)), credit: sumDecimals(lines.map((l) => l.credit)) };
}

// ---------------------------------------------------------------------------
// Nacrt
// ---------------------------------------------------------------------------

function validateHeader(input: JournalDraftInput, kind: JournalKind) {
  if (!isDate(input.documentDate) || !isDate(input.postingDate)) throw new Error("Unesite datum dokumenta i datum knjiženja.");
  if (!input.description.trim()) throw new Error("Opis naloga je obavezan.");
  // B1-Q7 (b): ručni nalog najviše do danas (početno stanje smije na datum početka primjene u budućnosti).
  if (kind === "MANUAL" && dateOnly(input.postingDate) > endOfDay(toZonedDateIso(new Date()))) {
    throw new Error("Datum knjiženja ručnog naloga ne može biti u budućnosti.");
  }
}

/** Novi nacrt ručnog naloga ili izmjena postojećeg nacrta (stavke se zamjenjuju). */
export async function saveDraft(actor: Actor, input: JournalDraftInput, id?: string | null) {
  requireCapability(actor, "journal.prepare");
  const zevId = requireZev(actor);
  validateHeader(input, "MANUAL");
  const lines = normalizeLines(input.lines);
  const postingDate = dateOnly(input.postingDate);
  const entry = await prisma.$transaction(async (tx) => {
    const period = await openPeriodFor(tx, zevId, postingDate, false);
    if (lines.length > 0) await checkLines(tx, zevId, "MANUAL", lines);
    const header = {
      yearId: period.yearId, periodId: period.id, documentDate: dateOnly(input.documentDate), postingDate,
      description: input.description.trim(),
    };
    let e;
    if (id) {
      const before = await tx.journalEntry.findUniqueOrThrow({ where: { id, zevId } });
      if (before.status !== "DRAFT") throw new Error("Mijenja se samo nacrt naloga.");
      if (before.kind !== "MANUAL") throw new Error("Ovaj nalog se ne uređuje ručno.");
      await tx.journalLine.deleteMany({ where: { entryId: id } });
      e = await tx.journalEntry.update({ where: { id }, data: header });
    } else {
      e = await tx.journalEntry.create({ data: { ...header, zevId, kind: "MANUAL", createdById: actor.userId } });
    }
    if (lines.length > 0) {
      await tx.journalLine.createMany({
        data: lines.map((l, i) => ({
          entryId: e.id, zevId, order: i, accountId: l.accountId, debit: l.debit.toFixed(2), credit: l.credit.toFixed(2),
          partyId: l.partyId, unitId: l.unitId, supplierId: l.supplierId, projectId: l.projectId, purposeId: l.purposeId, description: l.description,
        })),
      });
    }
    return e;
  });
  const t = totals(lines);
  await audit(actor, {
    action: id ? "journal.update" : "journal.create", targetType: "JournalEntry", targetId: entry.id,
    after: { postingDate: input.postingDate, lines: lines.length, debit: t.debit.toFixed(2), credit: t.credit.toFixed(2) },
  });
  return entry;
}

export async function deleteDraft(actor: Actor, id: string) {
  requireCapability(actor, "journal.prepare");
  const zevId = requireZev(actor);
  const e = await prisma.$transaction(async (tx) => {
    const e = await tx.journalEntry.findUniqueOrThrow({ where: { id, zevId } });
    if (e.status !== "DRAFT") throw new Error("Briše se samo nacrt — proknjižen nalog se stornira.");
    await tx.journalLine.deleteMany({ where: { entryId: id } });
    await tx.journalEntry.delete({ where: { id } });
    return e;
  });
  await audit(actor, { action: "journal.delete", targetType: "JournalEntry", targetId: id, before: { description: e.description, postingDate: e.postingDate } });
}

// ---------------------------------------------------------------------------
// Knjiženje i storno
// ---------------------------------------------------------------------------

async function nextNumber(tx: Tx, zevId: string, yearId: string, yearLabel: string, series: "NK" | "PS") {
  await tx.$executeRaw`INSERT INTO "JournalCounter" ("zevId", "yearId", "series", "next") VALUES (${zevId}, ${yearId}, ${series}, 1) ON CONFLICT DO NOTHING`;
  const rows = await tx.$queryRaw<{ next: number }[]>`SELECT "next" FROM "JournalCounter" WHERE "zevId" = ${zevId} AND "yearId" = ${yearId} AND "series" = ${series} FOR UPDATE`;
  const n = rows[0].next;
  await tx.$executeRaw`UPDATE "JournalCounter" SET "next" = ${n + 1} WHERE "zevId" = ${zevId} AND "yearId" = ${yearId} AND "series" = ${series}`;
  return `${series}-${yearLabel}-${String(n).padStart(4, "0")}`;
}

/** Knjiženje nacrta: period otvoren, stavke ispravne, nalog uravnotežen; dodjela broja i zaključavanje. */
export async function postEntry(actor: Actor, id: string) {
  requireCapability(actor, "journal.post");
  const zevId = requireZev(actor);
  const posted = await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "JournalEntry" WHERE id = ${id} AND "zevId" = ${zevId} FOR UPDATE`;
    const e = await tx.journalEntry.findUniqueOrThrow({ where: { id, zevId }, include: { lines: true, year: true } });
    if (e.status !== "DRAFT") throw new Error("Nalog je već proknjižen.");
    const period = await openPeriodFor(tx, zevId, e.postingDate, true);
    if (period.id !== e.periodId) throw new Error("Datum knjiženja ne odgovara periodu naloga — sačuvajte nacrt ponovo.");
    if (e.lines.length < 2) throw new Error("Nalog mora imati najmanje dvije stavke.");
    const lines = e.lines.map((l) => ({ ...l, debit: dec(l.debit.toString()), credit: dec(l.credit.toString()) }));
    await checkLines(tx, zevId, e.kind, lines as unknown as NormalizedLine[]);
    const t = totals(lines);
    if (!t.debit.eq(t.credit)) throw new Error(`Nalog nije uravnotežen: duguje ${t.debit.toFixed(2)}, potražuje ${t.credit.toFixed(2)}.`);
    if (e.kind === "OPENING") {
      // Početno stanje (B1b): jedno nestornirano po ZEV-u, i samo usklađeno sa analitikom i evidencijom na dan.
      const other = await tx.journalEntry.findFirst({ where: { zevId, kind: "OPENING", status: "POSTED", reversedBy: null } });
      if (other) throw new Error(`Početno stanje je već proknjiženo nalogom ${other.number}.`);
      const { reconcileOpeningInTx } = await import("@/server/services/openingBalance");
      const r = await reconcileOpeningInTx(tx, zevId, id);
      if (!r.ready) throw new Error(r.problems.join(" "));
    }
    const number = await nextNumber(tx, zevId, e.yearId, e.year.label, e.kind === "OPENING" ? "PS" : "NK");
    return tx.journalEntry.update({ where: { id }, data: { status: "POSTED", number, postedById: actor.userId, postedAt: new Date() } });
  });
  await audit(actor, { action: "journal.post", targetType: "JournalEntry", targetId: id, after: { number: posted.number, postingDate: posted.postingDate } });
  return posted;
}

/** Storno: novi proknjiženi nalog sa zamijenjenim stranama, vezom na original i razlogom, u otvorenom periodu. */
export async function reverseEntry(actor: Actor, id: string, input: { reason: string; postingDate: string }) {
  requireCapability(actor, "journal.reverse");
  const zevId = requireZev(actor);
  const reason = input.reason.trim();
  if (!reason) throw new Error("Storno zahtijeva razlog.");
  if (!isDate(input.postingDate)) throw new Error("Unesite datum storna.");
  const postingDate = dateOnly(input.postingDate);
  const rev = await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "JournalEntry" WHERE id = ${id} AND "zevId" = ${zevId} FOR UPDATE`;
    const orig = await tx.journalEntry.findUniqueOrThrow({ where: { id, zevId }, include: { lines: true, reversedBy: true } });
    if (orig.status !== "POSTED") throw new Error("Stornira se samo proknjižen nalog; nacrt se briše.");
    if (orig.kind === "REVERSAL") throw new Error("Storno nalog se ne stornira — knjižite novi nalog.");
    if (orig.reversedBy) throw new Error(`Nalog je već storniran nalogom ${orig.reversedBy.number}.`);
    if (postingDate < orig.postingDate) throw new Error("Storno ne može biti prije datuma originalnog naloga.");
    // Početno stanje može biti na datum početka u budućnosti; njegov storno smije na taj isti datum.
    const sameDayOpening = orig.kind === "OPENING" && postingDate.getTime() === orig.postingDate.getTime();
    if (postingDate > endOfDay(toZonedDateIso(new Date())) && !sameDayOpening) throw new Error("Datum storna ne može biti u budućnosti.");
    const period = await openPeriodFor(tx, zevId, postingDate, true);
    const year = await tx.fiscalYear.findUniqueOrThrow({ where: { id: period.yearId } });
    const draft = await tx.journalEntry.create({
      data: {
        zevId, yearId: period.yearId, periodId: period.id, kind: "REVERSAL", documentDate: postingDate, postingDate,
        description: `Storno naloga ${orig.number}: ${reason}`, reversalOfId: orig.id, reversalReason: reason, createdById: actor.userId,
      },
    });
    await tx.journalLine.createMany({
      data: orig.lines.map((l) => ({
        entryId: draft.id, zevId, order: l.order, accountId: l.accountId, debit: l.credit, credit: l.debit,
        partyId: l.partyId, unitId: l.unitId, supplierId: l.supplierId, projectId: l.projectId, purposeId: l.purposeId,
        description: l.description, openingSourceType: l.openingSourceType, openingSourceId: l.openingSourceId,
      })),
    });
    const number = await nextNumber(tx, zevId, period.yearId, year.label, "NK");
    return tx.journalEntry.update({ where: { id: draft.id }, data: { status: "POSTED", number, postedById: actor.userId, postedAt: new Date() } });
  });
  await audit(actor, { action: "journal.reverse", targetType: "JournalEntry", targetId: rev.id, after: { number: rev.number, reversalOfId: id }, reason });
  return rev;
}

// ---------------------------------------------------------------------------
// Periodi: zatvaranje i ponovno otvaranje uz dvostruko odobrenje
// ---------------------------------------------------------------------------

export async function closePeriod(actor: Actor, periodId: string) {
  requireCapability(actor, "period.close");
  const zevId = requireZev(actor);
  const p = await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "FiscalPeriod" WHERE id = ${periodId} AND "zevId" = ${zevId} FOR UPDATE`;
    const p = await tx.fiscalPeriod.findUniqueOrThrow({ where: { id: periodId, zevId } });
    if (p.status === "CLOSED") throw new Error("Period je već zatvoren.");
    const drafts = await tx.journalEntry.count({ where: { zevId, periodId, status: "DRAFT" } });
    if (drafts > 0) throw new Error(`U periodu ${p.label} ima nacrta naloga (${drafts}) — proknjižite ih ili obrišite prije zatvaranja.`);
    return tx.fiscalPeriod.update({ where: { id: periodId }, data: { status: "CLOSED", closedAt: new Date(), closedById: actor.userId } });
  });
  await audit(actor, { action: "fiscal_period.close", targetType: "FiscalPeriod", targetId: periodId, before: { status: "OPEN" }, after: { status: "CLOSED", label: p.label } });
  return p;
}

/** Uloga sa kojom lice traži/odobrava: predsjednik ako je ima, inače računovođa. */
function reopenRole(actor: Actor): Role {
  if (hasRole(actor, "PRESIDENT")) return "PRESIDENT";
  if (hasRole(actor, "ACCOUNTANT")) return "ACCOUNTANT";
  throw new ForbiddenError();
}

export async function requestReopen(actor: Actor, periodId: string, reason: string) {
  requireCapability(actor, "period.reopen");
  const zevId = requireZev(actor);
  if (!reason.trim()) throw new Error("Zahtjev za ponovno otvaranje traži razlog.");
  const p = await prisma.fiscalPeriod.findUniqueOrThrow({ where: { id: periodId, zevId } });
  if (p.status !== "CLOSED") throw new Error("Period nije zatvoren.");
  const pending = await prisma.periodReopenRequest.findFirst({ where: { zevId, periodId, decision: null } });
  if (pending) throw new Error("Za ovaj period već postoji zahtjev koji čeka odluku.");
  const r = await prisma.periodReopenRequest.create({
    data: { zevId, periodId, reason: reason.trim(), requestedById: actor.userId, requestedRole: reopenRole(actor) },
  });
  await audit(actor, { action: "fiscal_period.reopen_request", targetType: "FiscalPeriod", targetId: periodId, after: { label: p.label, role: r.requestedRole }, reason });
  return r;
}

/**
 * Odluka o zahtjevu: donosi je DRUGO lice, sa drugom ulogom od one sa kojom je zahtjev podnesen (B1-Q2 (a)).
 * Odobrenje otvara period; odbijanje ga ostavlja zatvorenim.
 */
export async function decideReopen(actor: Actor, requestId: string, approve: boolean, note?: string | null) {
  requireCapability(actor, "period.reopen");
  const zevId = requireZev(actor);
  const result = await prisma.$transaction(async (tx) => {
    const r = await tx.periodReopenRequest.findUniqueOrThrow({ where: { id: requestId, zevId }, include: { period: true } });
    if (r.decision) throw new Error("O zahtjevu je već odlučeno.");
    if (r.requestedById === actor.userId) throw new Error("Zahtjev ne može odobriti lice koje ga je podnijelo.");
    const needed: Role = r.requestedRole === "PRESIDENT" ? "ACCOUNTANT" : "PRESIDENT";
    if (!hasRole(actor, needed)) throw new Error(needed === "ACCOUNTANT" ? "Zahtjev predsjednika odobrava računovođa." : "Zahtjev računovođe odobrava predsjednik.");
    await tx.periodReopenRequest.update({
      where: { id: requestId },
      data: { decidedById: actor.userId, decision: approve ? "APPROVED" : "REJECTED", decisionNote: note?.trim() || null, decidedAt: new Date() },
    });
    if (approve) await tx.fiscalPeriod.update({ where: { id: r.periodId }, data: { status: "OPEN", closedAt: null, closedById: null } });
    return r;
  });
  await audit(actor, {
    action: approve ? "fiscal_period.reopen" : "fiscal_period.reopen_reject", targetType: "FiscalPeriod", targetId: result.periodId,
    before: { status: "CLOSED" }, after: { status: approve ? "OPEN" : "CLOSED", label: result.period.label, requestId }, reason: note ?? result.reason,
  });
}

export async function listReopenRequests(actor: Actor) {
  requireCapability(actor, "ledger.view");
  return prisma.periodReopenRequest.findMany({ where: { zevId: requireZev(actor) }, orderBy: { requestedAt: "desc" } });
}
