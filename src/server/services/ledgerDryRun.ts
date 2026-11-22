// Faza B4 — probno knjiženje (Plans/kontni-plan-b4-proba-i-aktivacija-plan.md §2, B4-Q2 (a), B4-Q3 (a)).
//
// Proba radi tačno ono što radi aktivacija — priprema i knjiži početno stanje, izvodi i obrađuje sve događaje od
// datuma početka do danas, računa bruto bilans i usklađivanje — u JEDNOJ transakciji koja se na kraju poništava.
// Van transakcije ostaje samo red u revizorskom tragu. Nijedna provjera ne blokira aktivaciju (B4-Q4 (a)).
import { prisma } from "@/lib/prisma";
import { audit } from "@/server/audit";
import { requireCapability, requireZev, type Actor } from "@/server/auth/guards";
import type { AccountingEventKind, AccountingEventStatus, Prisma } from "@/generated/prisma/client";
import { dec, sumDecimals } from "@/lib/money";
import { formatDate, toZonedDateIso } from "@/lib/i18n";
import { postEntryInTx } from "@/server/services/journal";
import { prepareOpeningInTx, reconcileOpeningInTx, type ReconciliationRow } from "@/server/services/openingBalance";
import { describeSources, ledgerStart, processEvents, syncEvents } from "@/server/services/ledgerEvents";
import { getCoverage } from "@/server/services/ledgerConfig";
import { trialBalanceDb, type TrialRow } from "@/server/services/ledgerReports";
import { reconcileAtDb, type ReconRow } from "@/server/services/ledgerReconciliation";

type Tx = Prisma.TransactionClient;

const dateOnly = (s: string) => new Date(`${s}T00:00:00Z`);
const isIso = (s: string | null | undefined): s is string => !!s && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(dateOnly(s).getTime());
const iso = (d: Date) => d.toISOString().slice(0, 10);

export type Check = { key: string; level: "ok" | "warn" | "fail"; text: string };
export type WaitingGroup = { status: AccountingEventStatus; kind: AccountingEventKind; detail: string; count: number; amount: string; examples: { label: string; href: string | null }[] };
export type DryRunResult = {
  startDate: string; asOf: string; ranAt: Date;
  checks: Check[];
  opening: {
    ok: boolean; error: string | null; debit: string; credit: string; lines: number;
    balancing: { code: string; name: string; amount: string; side: "D" | "P" } | null;
    /** Evidencija na dan prije početka nema stanja — proba je dodala tehnički par stavki da bi nastavila. */
    empty: boolean;
    rows: ReconciliationRow[];
  };
  events: { total: number; posted: number; waiting: number; byKind: { kind: AccountingEventKind; posted: number; waiting: number }[]; groups: WaitingGroup[] } | null;
  trial: { rows: TrialRow[]; totals: Record<string, string>; balanced: boolean } | null;
  recon: { ok: boolean; rows: ReconRow[] } | null;
};

/** Podrazumijevani datum probe: datum nacrta početnog stanja, inače 1. januar sljedeće (od decembra) ili tekuće godine. */
export async function defaultDryRunDate(actor: Actor): Promise<string> {
  requireCapability(actor, "ledger.view");
  const zevId = requireZev(actor);
  const draft = await prisma.journalEntry.findFirst({ where: { zevId, kind: "OPENING", status: "DRAFT" }, select: { postingDate: true } });
  if (draft) return iso(draft.postingDate);
  const today = toZonedDateIso(new Date());
  const y = Number(today.slice(0, 4));
  return `${today.slice(5, 7) === "12" ? y + 1 : y}-01-01`;
}

/** Posljednja proba (iz revizorskog traga) — za napomenu uz aktivaciju (B4-Q4 (a)). */
export async function lastDryRun(actor: Actor): Promise<{ at: Date; startDate: string } | null> {
  requireCapability(actor, "ledger.view");
  const e = await prisma.auditEvent.findFirst({ where: { zevId: requireZev(actor), action: "ledger.dry_run" }, orderBy: { createdAt: "desc" }, select: { createdAt: true, after: true } });
  const startDate = (e?.after as { startDate?: string } | null)?.startDate;
  return e && startDate ? { at: e.createdAt, startDate } : null;
}

async function readiness(actor: Actor, zevId: string, startDate: string): Promise<Check[]> {
  const cov = await getCoverage(actor);
  const checks: Check[] = [];
  checks.push(cov.chartStatus === "ACTIVE"
    ? { key: "chart", level: "ok", text: "Kontni plan je aktivan." }
    : { key: "chart", level: "fail", text: "Kontni plan nije aktivan — aktivirajte ga na tabu „Kontni plan”." });
  const start = dateOnly(startDate);
  const period = await prisma.fiscalPeriod.findFirst({ where: { zevId, startDate: { lte: start }, endDate: { gte: start } }, include: { year: true } });
  checks.push(!period
    ? { key: "period", level: "fail", text: `Za ${formatDate(start)} ne postoji poslovna godina — otvorite je na tabu „Poslovne godine”.` }
    : period.status !== "OPEN" || period.year.status !== "OPEN"
      ? { key: "period", level: "fail", text: `Period ${period.label} je zatvoren.` }
      : { key: "period", level: "ok", text: `Poslovna godina ${period.year.label} je otvorena.` });
  const missingControls = cov.controlRows.filter((c) => !c.current);
  checks.push(missingControls.length === 0
    ? { key: "controls", level: "ok", text: "Kontrolna konta su postavljena za sve račune novca, namjene, avanse, neidentifikovane uplate i dobavljače." }
    : { key: "controls", level: "fail", text: `Nedostaje ${missingControls.length} kontrolnih konta — postavite ih na tabu „Pravila knjiženja”.` });
  const openRules = cov.ruleRows.filter((r) => r.status !== "OK");
  checks.push(openRules.length === 0
    ? { key: "rules", level: "ok", text: "Sve vrste zaduženja i kategorije imaju potvrđeno pravilo." }
    : { key: "rules", level: "warn", text: `${openRules.length} vrsta zaduženja ili kategorija nema potvrđeno pravilo — njihovi događaji će čekati (vidi „Pokrivenost”).` });
  checks.push(cov.allocationRule === "NOT_SET"
    ? { key: "allocation", level: "warn", text: "Nije izabrano pravilo raspodjele djelimične uplate — djelimičan raspored na fakturu sa više namjena će čekati." }
    : { key: "allocation", level: "ok", text: "Pravilo raspodjele djelimične uplate je izabrano." });
  if (!cov.reserveGateOpen) checks.push({ key: "reserve", level: "warn", text: "Šema knjiženja zajedničke rezerve nije stručno potvrđena — zaduženja rezerve će čekati." });
  if (cov.unassignedItems.length > 0 || cov.linesWithoutType > 0) {
    checks.push({ key: "types", level: "warn", text: `Stavke naknada bez vrste zaduženja: ${cov.unassignedItems.length}; stavke faktura bez vrste: ${cov.linesWithoutType}. Takve fakture će čekati.` });
  }
  return checks;
}

class DryRunDone extends Error {
  constructor(readonly result: Omit<DryRunResult, "checks" | "ranAt">) { super("Probno knjiženje — poništava se."); }
}

/** Konto na koji proba privremeno stavlja razliku neuravnoteženog početnog stanja (u pravom nalogu je pokriva ručna stavka). */
async function balancingAccount(tx: Tx, zevId: string) {
  const controls = new Set((await tx.zevControlAccount.findMany({ where: { zevId }, select: { accountId: true } })).map((c) => c.accountId));
  const candidates = await tx.zevAccount.findMany({
    where: { zevId, postable: true, active: true, chart: { status: "ACTIVE" } }, orderBy: { code: "asc" }, select: { id: true, code: true, name: true, nature: true },
  });
  const free = candidates.filter((a) => !controls.has(a.id));
  return free.find((a) => a.nature === "EQUITY") ?? free[0] ?? null;
}

async function simulate(tx: Tx, zevId: string, userId: string, startDate: string, asOf: string): Promise<Omit<DryRunResult, "checks" | "ranAt">> {
  const base = { startDate, asOf, events: null, trial: null, recon: null };
  const opening: DryRunResult["opening"] = { ok: false, error: null, debit: "0.00", credit: "0.00", lines: 0, balancing: null, empty: false, rows: [] };
  try {
    const prepared = await prepareOpeningInTx(tx, zevId, userId, startDate);
    let r = await reconcileOpeningInTx(tx, zevId, prepared.entry.id);
    const diff = dec(r.debit).minus(dec(r.credit));
    if (!diff.isZero()) {
      const acc = await balancingAccount(tx, zevId);
      if (!acc) throw new Error("Početno stanje nije uravnoteženo, a nema konta za privremenu razliku.");
      const count = await tx.journalLine.count({ where: { entryId: prepared.entry.id } });
      await tx.journalLine.create({
        data: {
          entryId: prepared.entry.id, zevId, order: count, accountId: acc.id,
          debit: diff.lt(0) ? diff.abs().toFixed(2) : "0", credit: diff.gt(0) ? diff.toFixed(2) : "0", description: "Proba: privremena razlika",
        },
      });
      opening.balancing = { code: acc.code, name: acc.name, amount: diff.abs().toFixed(2), side: diff.gt(0) ? "P" : "D" };
      r = await reconcileOpeningInTx(tx, zevId, prepared.entry.id);
    }
    if ((await tx.journalLine.count({ where: { entryId: prepared.entry.id } })) < 2) {
      // Nalog mora imati bar dvije stavke; prazno početno stanje (nova evidencija) bi u pravom radu dopunila ručna stavka.
      const acc = await balancingAccount(tx, zevId);
      if (!acc) throw new Error("Početno stanje je prazno, a nema konta za tehničke stavke probe.");
      const count = await tx.journalLine.count({ where: { entryId: prepared.entry.id } });
      await tx.journalLine.createMany({
        data: [
          { entryId: prepared.entry.id, zevId, order: count, accountId: acc.id, debit: "0.01", credit: "0", description: "Proba: tehnička stavka" },
          { entryId: prepared.entry.id, zevId, order: count + 1, accountId: acc.id, debit: "0", credit: "0.01", description: "Proba: tehnička stavka" },
        ],
      });
      opening.empty = true;
      r = await reconcileOpeningInTx(tx, zevId, prepared.entry.id);
    }
    Object.assign(opening, { debit: r.debit, credit: r.credit, lines: prepared.lines, rows: r.rows });
    await postEntryInTx(tx, zevId, prepared.entry.id, userId);
    opening.ok = true;
  } catch (e) {
    opening.error = e instanceof Error ? e.message : "Početno stanje se ne može proknjižiti.";
    return { ...base, opening };
  }

  await syncEvents(zevId, tx);
  await processEvents(zevId, userId, tx);
  const events = await tx.accountingEvent.findMany({ where: { zevId }, orderBy: [{ eventDate: "asc" }, { sourceCreatedAt: "asc" }] });
  const byKind = new Map<AccountingEventKind, { posted: number; waiting: number }>();
  const groups = new Map<string, { status: AccountingEventStatus; kind: AccountingEventKind; detail: string; items: typeof events }>();
  for (const e of events) {
    const k = byKind.get(e.kind) ?? { posted: 0, waiting: 0 };
    if (e.status === "POSTED") k.posted++;
    else {
      k.waiting++;
      // Razlog „čeka prethodni” nosi broj dokumenta — grupiše se po vrsti događaja; ostali razlozi (pravilo,
      // kategorija, period) su već zajednički za više dokumenata.
      const key = e.status === "WAITING_PREDECESSOR" ? `${e.status}|${e.kind}` : `${e.status}|${e.statusDetail ?? ""}`;
      const g = groups.get(key) ?? { status: e.status, kind: e.kind, detail: e.statusDetail ?? "", items: [] };
      g.items.push(e);
      groups.set(key, g);
    }
    byKind.set(e.kind, k);
  }
  const examples = [...groups.values()].flatMap((g) => g.items.slice(0, 5));
  const sources = await describeSources(zevId, examples);
  const posted = events.filter((e) => e.status === "POSTED").length;

  const trial = await trialBalanceDb(tx, zevId, { from: startDate, to: asOf });
  const recon = await reconcileAtDb(tx, zevId, asOf);
  return {
    ...base, opening,
    events: {
      total: events.length, posted, waiting: events.length - posted,
      byKind: [...byKind.entries()].map(([kind, v]) => ({ kind, ...v })),
      groups: [...groups.values()]
        .map((g) => ({
          status: g.status, kind: g.kind, detail: g.detail, count: g.items.length,
          amount: sumDecimals(g.items.map((i) => dec(i.amount.toString()))).toFixed(2),
          examples: g.items.slice(0, 5).map((i) => sources.get(`${i.sourceType}:${i.sourceId}`) ?? { label: i.sourceType, href: null }),
        }))
        .sort((a, b) => b.count - a.count),
    },
    trial: { rows: trial.rows, totals: trial.totals, balanced: trial.balanced },
    recon: { ok: recon.ok, rows: recon.rows },
  };
}

/**
 * Pokreće probu za datum početka. Kad je knjiženje već aktivno, vraća null (proba više nema smisla). Prava:
 * pregled knjige (predsjednik i računovođa) — proba ništa ne upisuje osim reda u revizorskom tragu.
 */
export async function runDryRun(actor: Actor, input: { startDate: string }): Promise<DryRunResult | null> {
  requireCapability(actor, "ledger.view");
  const zevId = requireZev(actor);
  if (!isIso(input.startDate)) throw new Error("Unesite datum početka knjiženja.");
  if (await ledgerStart(prisma, zevId)) return null;
  const today = toZonedDateIso(new Date());
  const asOf = today > input.startDate ? today : input.startDate;
  const checks = await readiness(actor, zevId, input.startDate);

  let result: Omit<DryRunResult, "checks" | "ranAt"> | null = null;
  try {
    await prisma.$transaction(
      async (tx) => { throw new DryRunDone(await simulate(tx, zevId, actor.userId, input.startDate, asOf)); },
      { timeout: 180_000, maxWait: 15_000 },
    );
  } catch (e) {
    if (!(e instanceof DryRunDone)) throw e;
    result = e.result;
  }
  const r = result!;
  await audit(actor, {
    action: "ledger.dry_run", targetType: "Zev", targetId: zevId,
    after: { startDate: input.startDate, asOf, openingOk: r.opening.ok, posted: r.events?.posted ?? 0, waiting: r.events?.waiting ?? 0, reconOk: r.recon?.ok ?? null },
  });
  return { ...r, checks, ranAt: new Date() };
}

