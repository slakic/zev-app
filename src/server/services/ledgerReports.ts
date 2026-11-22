// Faza B3a — knjigovodstveni izvještaji (Plans/kontni-plan-b3-izvjestaji-plan.md §2–3).
//
// Samo čitaju i samo proknjižene naloge. Period se bira po datumu knjiženja (B3-Q4), pa se izvještaj za zatvoren
// period više ne mijenja. „Početno stanje” izvještaja = sav promet prije `from` + nalozi početnog stanja (OPENING)
// u periodu; „promet” = ostali nalozi u periodu. Klasifikacija je po nalogu, pa su zbirovi uvijek uravnoteženi.
import { prisma } from "@/lib/prisma";
import { requireCapability, requireZev, type Actor } from "@/server/auth/guards";
import type { AccountNature, JournalKind, Prisma } from "@/generated/prisma/client";
import { dec, sumDecimals, ZERO, type Decimal } from "@/lib/money";
import { toZonedDateIso } from "@/lib/i18n";
import { partyDisplayName } from "@/server/services/ownership";
import { displayNameOf } from "@/server/auth/displayName";
import { autoEntrySource } from "@/server/services/ledgerEvents";
import { toCsv } from "@/server/services/reports";
import { audit } from "@/server/audit";

type Db = Prisma.TransactionClient | typeof prisma;

const dateOnly = (s: string) => new Date(`${s}T00:00:00Z`);
const isIso = (s: string | null | undefined): s is string => !!s && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(dateOnly(s).getTime());
const iso = (d: Date) => d.toISOString().slice(0, 10);
const money = (d: Decimal) => d.toFixed(2);

export type ReportRange = { from: string; to: string };
/** Filter po dimenziji stavke. Za namjenu i projekat „none” znači stavke bez te dimenzije. */
export type DimFilter = { partyId?: string | null; unitId?: string | null; supplierId?: string | null; projectId?: string | null; purposeId?: string | null };

/** Prirodna strana konta: imovina i rashodi rastu na duguje, ostalo na potražuje. */
export const debitNormal = (n: AccountNature) => n === "ASSET" || n === "EXPENSE" || n === "OFF_BALANCE";
const natural = (n: AccountNature, debit: Decimal, credit: Decimal) => (debitNormal(n) ? debit.minus(credit) : credit.minus(debit));

function dimWhere(f: DimFilter): Prisma.JournalLineWhereInput {
  const opt = (v: string | null | undefined) => (v === "none" ? null : v || undefined);
  return {
    partyId: f.partyId || undefined,
    unitId: f.unitId || undefined,
    supplierId: f.supplierId || undefined,
    projectId: opt(f.projectId),
    purposeId: opt(f.purposeId),
  };
}

/**
 * Period izvještaja: zadati datumi ako su ispravni (zamijenjeni ako su obrnuti), inače poslovna godina u kojoj je
 * današnji dan, pa najnovija godina, pa kalendarska godina. Vraća i godine za brzi izbor.
 */
export async function reportRange(actor: Actor, from?: string | null, to?: string | null) {
  requireCapability(actor, "ledger.view");
  const zevId = requireZev(actor);
  const years = await prisma.fiscalYear.findMany({ where: { zevId }, orderBy: { startDate: "desc" }, select: { label: true, startDate: true, endDate: true } });
  const quick = years.map((y) => ({ label: y.label, from: iso(y.startDate), to: iso(y.endDate) }));
  if (isIso(from) && isIso(to)) return { from: from <= to ? from : to, to: from <= to ? to : from, years: quick };
  const today = toZonedDateIso(new Date());
  const y = quick.find((q) => q.from <= today && today <= q.to) ?? quick[0];
  if (y) return { from: y.from, to: y.to, years: quick };
  return { from: `${today.slice(0, 4)}-01-01`, to: `${today.slice(0, 4)}-12-31`, years: quick };
}

// ---------------------------------------------------------------------------
// Stavke
// ---------------------------------------------------------------------------

const lineSelect = {
  id: true, accountId: true, debit: true, credit: true, description: true,
  partyId: true, unitId: true, supplierId: true, projectId: true, purposeId: true,
  entry: { select: { id: true, number: true, kind: true, postingDate: true, documentDate: true, description: true } },
  account: { select: { code: true, name: true } },
  party: { select: { kind: true, firstName: true, lastName: true, orgName: true } },
  unit: { select: { label: true } },
  supplier: { select: { name: true } },
  project: { select: { name: true } },
  purpose: { select: { code: true, name: true } },
} satisfies Prisma.JournalLineSelect;

type Line = Prisma.JournalLineGetPayload<{ select: typeof lineSelect }>;

async function postedLines(zevId: string, to: string, where: Prisma.JournalLineWhereInput = {}) {
  return prisma.journalLine.findMany({
    where: { zevId, ...where, entry: { status: "POSTED", postingDate: { lte: dateOnly(to) } } },
    select: lineSelect,
    orderBy: [{ entry: { postingDate: "asc" } }, { entry: { number: "asc" } }, { order: "asc" }],
  });
}

const isOpening = (l: { entry: { kind: JournalKind; postingDate: Date } }, from: string) => l.entry.kind === "OPENING" || iso(l.entry.postingDate) < from;

/** Analitika stavke za prikaz: vlasnik, jedinica, dobavljač, projekat, namjena. */
export function lineAnalytics(l: Pick<Line, "party" | "unit" | "supplier" | "project" | "purpose">): string {
  return [l.party ? partyDisplayName(l.party) : null, l.unit?.label, l.supplier?.name, l.project?.name, l.purpose ? `${l.purpose.code} ${l.purpose.name}` : null]
    .filter(Boolean).join(", ");
}

async function zevAccounts(zevId: string, db: Db = prisma) {
  return db.zevAccount.findMany({ where: { zevId }, select: { id: true, code: true, name: true, nature: true, postable: true, parentId: true } });
}
type Acc = Awaited<ReturnType<typeof zevAccounts>>[number];

function descendantsOf(accounts: Acc[], id: string): string[] {
  const children = new Map<string, Acc[]>();
  for (const a of accounts) if (a.parentId) children.set(a.parentId, [...(children.get(a.parentId) ?? []), a]);
  const out: string[] = [];
  const walk = (x: string) => { for (const c of children.get(x) ?? []) { if (c.postable) out.push(c.id); walk(c.id); } };
  walk(id);
  return out;
}

// ---------------------------------------------------------------------------
// Bruto bilans (§3.3)
// ---------------------------------------------------------------------------

export type TrialRow = {
  accountId: string; code: string; name: string; postable: boolean; depth: number;
  openingDebit: string; openingCredit: string; debit: string; credit: string; closingDebit: string; closingCredit: string;
};

export async function trialBalance(actor: Actor, input: ReportRange & DimFilter & { withSummary?: boolean }) {
  requireCapability(actor, "ledger.view");
  return trialBalanceDb(prisma, requireZev(actor), input);
}

/** Bruto bilans iz zadate veze (i u transakciji probnog knjiženja, B4). */
export async function trialBalanceDb(db: Db, zevId: string, input: ReportRange & DimFilter & { withSummary?: boolean }) {
  const [accounts, lines] = await Promise.all([
    zevAccounts(zevId, db),
    db.journalLine.findMany({
      where: { zevId, ...dimWhere(input), entry: { status: "POSTED", postingDate: { lte: dateOnly(input.to) } } },
      select: { accountId: true, debit: true, credit: true, entry: { select: { kind: true, postingDate: true } } },
    }),
  ]);
  type Sums = { od: Decimal; op: Decimal; d: Decimal; p: Decimal };
  const sums = new Map<string, Sums>();
  const get = (id: string) => { let s = sums.get(id); if (!s) sums.set(id, (s = { od: ZERO, op: ZERO, d: ZERO, p: ZERO })); return s; };
  const byId = new Map(accounts.map((a) => [a.id, a]));
  for (const l of lines) {
    const debit = dec(l.debit.toString());
    const credit = dec(l.credit.toString());
    const opening = isOpening(l, input.from);
    // Zbirna konta sabiraju podređena (svaki predak dobija iznos stavke).
    for (let id: string | null = l.accountId; id; id = input.withSummary ? byId.get(id)?.parentId ?? null : null) {
      const s = get(id);
      if (opening) { s.od = s.od.plus(debit); s.op = s.op.plus(credit); } else { s.d = s.d.plus(debit); s.p = s.p.plus(credit); }
    }
  }
  const depth = (a: Acc) => { let n = 0; for (let p = a.parentId; p; p = byId.get(p)?.parentId ?? null) n++; return n; };
  const rows: TrialRow[] = [];
  const total = { od: ZERO, op: ZERO, d: ZERO, p: ZERO, cd: ZERO, cp: ZERO };
  for (const a of [...accounts].sort((x, y) => (x.code < y.code ? -1 : x.code > y.code ? 1 : 0))) {
    const s = sums.get(a.id);
    if (!s || (s.od.isZero() && s.op.isZero() && s.d.isZero() && s.p.isZero())) continue;
    const net = s.od.plus(s.d).minus(s.op).minus(s.p);
    const cd = net.gt(0) ? net : ZERO;
    const cp = net.lt(0) ? net.neg() : ZERO;
    rows.push({
      accountId: a.id, code: a.code, name: a.name, postable: a.postable, depth: depth(a),
      openingDebit: money(s.od), openingCredit: money(s.op), debit: money(s.d), credit: money(s.p), closingDebit: money(cd), closingCredit: money(cp),
    });
    if (a.postable) {
      total.od = total.od.plus(s.od); total.op = total.op.plus(s.op); total.d = total.d.plus(s.d); total.p = total.p.plus(s.p);
      total.cd = total.cd.plus(cd); total.cp = total.cp.plus(cp);
    }
  }
  return {
    rows,
    totals: { openingDebit: money(total.od), openingCredit: money(total.op), debit: money(total.d), credit: money(total.p), closingDebit: money(total.cd), closingCredit: money(total.cp) },
    // Neuravnotežen zbir je moguć samo uz filter po dimenziji (stavke jednog vlasnika nemaju protivstavku).
    balanced: total.od.eq(total.op) && total.d.eq(total.p) && total.cd.eq(total.cp),
  };
}

// ---------------------------------------------------------------------------
// Kartica konta i glavna knjiga (§3.2)
// ---------------------------------------------------------------------------

export type CardRow = {
  lineId: string; entryId: string; number: string | null; kind: JournalKind; postingDate: string; documentDate: string;
  description: string; analytics: string; accountCode: string; debit: string; credit: string; balance: string;
};
export type Card = {
  account: { id: string; code: string; name: string; nature: AccountNature; postable: boolean };
  opening: string; openingDebit: string; openingCredit: string;
  rows: CardRow[]; debit: string; credit: string; closing: string;
};

function buildCard(account: Card["account"], lines: Line[], from: string): Card {
  let od = ZERO, op = ZERO, d = ZERO, p = ZERO;
  const rows: CardRow[] = [];
  for (const l of lines) {
    const debit = dec(l.debit.toString());
    const credit = dec(l.credit.toString());
    if (isOpening(l, from)) { od = od.plus(debit); op = op.plus(credit); continue; }
    d = d.plus(debit); p = p.plus(credit);
    rows.push({
      lineId: l.id, entryId: l.entry.id, number: l.entry.number, kind: l.entry.kind,
      postingDate: iso(l.entry.postingDate), documentDate: iso(l.entry.documentDate),
      description: l.description || l.entry.description, analytics: lineAnalytics(l), accountCode: l.account.code,
      debit: money(debit), credit: money(credit), balance: money(natural(account.nature, od.plus(d), op.plus(p))),
    });
  }
  return {
    account, opening: money(natural(account.nature, od, op)), openingDebit: money(od), openingCredit: money(op),
    rows, debit: money(d), credit: money(p), closing: money(natural(account.nature, od.plus(d), op.plus(p))),
  };
}

/** Kartica jednog konta; zbirno konto obuhvata sva svoja knjižna podkonta. Strani ili nepostojeći konto → null. */
export async function accountCard(actor: Actor, input: ReportRange & DimFilter & { accountId: string }): Promise<Card | null> {
  requireCapability(actor, "ledger.view");
  const zevId = requireZev(actor);
  const accounts = await zevAccounts(zevId);
  const a = accounts.find((x) => x.id === input.accountId);
  if (!a) return null;
  const ids = a.postable ? [a.id] : descendantsOf(accounts, a.id);
  const lines = await postedLines(zevId, input.to, { accountId: { in: ids }, ...dimWhere(input) });
  return buildCard({ id: a.id, code: a.code, name: a.name, nature: a.nature, postable: a.postable }, lines, input.from);
}

/** Kartice svih knjižnih konta sa stanjem ili prometom — glavna knjiga (CSV, B3-Q6) i kartice po dimenziji. */
async function cards(zevId: string, range: ReportRange, where: Prisma.JournalLineWhereInput): Promise<Card[]> {
  const [accounts, lines] = await Promise.all([zevAccounts(zevId), postedLines(zevId, range.to, where)]);
  const byAccount = new Map<string, Line[]>();
  for (const l of lines) byAccount.set(l.accountId, [...(byAccount.get(l.accountId) ?? []), l]);
  return accounts
    .filter((a) => byAccount.has(a.id))
    .sort((x, y) => (x.code < y.code ? -1 : x.code > y.code ? 1 : 0))
    .map((a) => buildCard({ id: a.id, code: a.code, name: a.name, nature: a.nature, postable: a.postable }, byAccount.get(a.id)!, range.from))
    .filter((c) => c.rows.length > 0 || c.opening !== "0.00");
}

export async function generalLedger(actor: Actor, range: ReportRange) {
  requireCapability(actor, "ledger.view");
  return cards(requireZev(actor), range, {});
}

// ---------------------------------------------------------------------------
// Kartice po dimenziji (§3.4): vlasnik, dobavljač
// ---------------------------------------------------------------------------

export async function dimensionCard(actor: Actor, input: ReportRange & { dim: "party" | "supplier"; id: string }) {
  requireCapability(actor, "ledger.view");
  const zevId = requireZev(actor);
  if (!input.id) return [];
  return cards(zevId, input, input.dim === "party" ? { partyId: input.id } : { supplierId: input.id });
}

/** Vlasnici odnosno dobavljači koji imaju bar jednu proknjiženu stavku — izbor za karticu. */
export async function dimensionOptions(actor: Actor, dim: "party" | "supplier") {
  requireCapability(actor, "ledger.view");
  const zevId = requireZev(actor);
  if (dim === "party") {
    const rows = await prisma.journalLine.findMany({
      where: { zevId, partyId: { not: null }, entry: { status: "POSTED" } }, distinct: ["partyId"],
      select: { party: { select: { id: true, kind: true, firstName: true, lastName: true, orgName: true } } },
    });
    return rows.flatMap((r) => (r.party ? [{ id: r.party.id, name: partyDisplayName(r.party) }] : [])).sort((a, b) => a.name.localeCompare(b.name, "sr-Latn"));
  }
  const rows = await prisma.journalLine.findMany({
    where: { zevId, supplierId: { not: null }, entry: { status: "POSTED" } }, distinct: ["supplierId"],
    select: { supplier: { select: { id: true, name: true } } },
  });
  return rows.flatMap((r) => (r.supplier ? [{ id: r.supplier.id, name: r.supplier.name }] : [])).sort((a, b) => a.name.localeCompare(b.name, "sr-Latn"));
}

// ---------------------------------------------------------------------------
// Pregled po namjeni i po projektu (§3.4)
// ---------------------------------------------------------------------------

export type PurposeRow = {
  purposeId: string; code: string; name: string; isCommonReserve: boolean;
  receivableOpening: string; charged: string; collected: string; receivableClosing: string; income: string; expense: string;
};

/**
 * Po namjeni: potraživanja od vlasnika (kontrolna konta OWNER_RECEIVABLE — početak, zaduženo, naplaćeno, kraj) i
 * prihodi/rashodi u periodu (konta prirode INCOME/EXPENSE). `purposeId = "none"` su stavke bez namjene.
 */
export async function purposeOverview(actor: Actor, range: ReportRange): Promise<PurposeRow[]> {
  requireCapability(actor, "ledger.view");
  const zevId = requireZev(actor);
  const [purposes, controls, accounts, lines] = await Promise.all([
    prisma.fundPurpose.findMany({ where: { zevId }, orderBy: { code: "asc" }, select: { id: true, code: true, name: true, isCommonReserve: true } }),
    prisma.zevControlAccount.findMany({ where: { zevId, role: "OWNER_RECEIVABLE" }, select: { accountId: true } }),
    zevAccounts(zevId),
    prisma.journalLine.findMany({
      where: { zevId, entry: { status: "POSTED", postingDate: { lte: dateOnly(range.to) } } },
      select: { accountId: true, purposeId: true, debit: true, credit: true, entry: { select: { kind: true, postingDate: true } } },
    }),
  ]);
  const receivable = new Set(controls.map((c) => c.accountId));
  const nature = new Map(accounts.map((a) => [a.id, a.nature]));
  type S = { ro: Decimal; ch: Decimal; co: Decimal; inc: Decimal; exp: Decimal; any: boolean };
  const by = new Map<string, S>();
  const get = (id: string) => { let s = by.get(id); if (!s) by.set(id, (s = { ro: ZERO, ch: ZERO, co: ZERO, inc: ZERO, exp: ZERO, any: false })); return s; };
  for (const l of lines) {
    const n = nature.get(l.accountId);
    const isRec = receivable.has(l.accountId);
    if (!isRec && n !== "INCOME" && n !== "EXPENSE") continue;
    const s = get(l.purposeId ?? "none");
    s.any = true;
    const debit = dec(l.debit.toString());
    const credit = dec(l.credit.toString());
    const opening = isOpening(l, range.from);
    if (isRec) {
      if (opening) s.ro = s.ro.plus(debit).minus(credit);
      else { s.ch = s.ch.plus(debit); s.co = s.co.plus(credit); }
    } else if (!opening) {
      if (n === "INCOME") s.inc = s.inc.plus(credit).minus(debit);
      else s.exp = s.exp.plus(debit).minus(credit);
    }
  }
  const row = (id: string, code: string, name: string, isCommonReserve: boolean): PurposeRow | null => {
    const s = by.get(id);
    // Namjena bez ijednog iznosa (npr. rashod i njegov storno) se ne prikazuje.
    if (!s?.any || [s.ro, s.ch, s.co, s.inc, s.exp].every((v) => v.isZero())) return null;
    return {
      purposeId: id, code, name, isCommonReserve,
      receivableOpening: money(s.ro), charged: money(s.ch), collected: money(s.co), receivableClosing: money(s.ro.plus(s.ch).minus(s.co)),
      income: money(s.inc), expense: money(s.exp),
    };
  };
  const out = purposes.map((p) => row(p.id, p.code, p.name, p.isCommonReserve));
  out.push(row("none", "", "", false));
  return out.filter((r): r is PurposeRow => r !== null);
}

export type ProjectRow = { projectId: string; name: string; income: string; expense: string; lines: number };

export async function projectOverview(actor: Actor, range: ReportRange): Promise<ProjectRow[]> {
  requireCapability(actor, "ledger.view");
  const zevId = requireZev(actor);
  const lines = await prisma.journalLine.findMany({
    where: {
      zevId, projectId: { not: null },
      entry: { status: "POSTED", kind: { not: "OPENING" }, postingDate: { gte: dateOnly(range.from), lte: dateOnly(range.to) } },
    },
    select: { debit: true, credit: true, account: { select: { nature: true } }, project: { select: { id: true, name: true } } },
  });
  const by = new Map<string, { name: string; inc: Decimal; exp: Decimal; n: number }>();
  for (const l of lines) {
    if (!l.project) continue;
    const s = by.get(l.project.id) ?? { name: l.project.name, inc: ZERO, exp: ZERO, n: 0 };
    const debit = dec(l.debit.toString());
    const credit = dec(l.credit.toString());
    if (l.account.nature === "INCOME") s.inc = s.inc.plus(credit).minus(debit);
    if (l.account.nature === "EXPENSE") s.exp = s.exp.plus(debit).minus(credit);
    s.n++;
    by.set(l.project.id, s);
  }
  return [...by.entries()]
    .map(([projectId, s]) => ({ projectId, name: s.name, income: money(s.inc), expense: money(s.exp), lines: s.n }))
    .sort((a, b) => a.name.localeCompare(b.name, "sr-Latn"));
}

// ---------------------------------------------------------------------------
// Dnevnik knjiženja (§3.1) i pregled storna (§3.5)
// ---------------------------------------------------------------------------

export async function journalBook(actor: Actor, input: ReportRange & { kind?: string | null }) {
  requireCapability(actor, "ledger.view");
  const zevId = requireZev(actor);
  const kinds: JournalKind[] = ["MANUAL", "OPENING", "REVERSAL", "AUTO"];
  const kind = kinds.find((k) => k === input.kind);
  const entries = await prisma.journalEntry.findMany({
    where: { zevId, status: "POSTED", kind, postingDate: { gte: dateOnly(input.from), lte: dateOnly(input.to) } },
    orderBy: [{ postingDate: "asc" }, { number: "asc" }],
    select: {
      id: true, number: true, kind: true, postingDate: true, documentDate: true, description: true,
      lines: { orderBy: { order: "asc" }, select: lineSelect },
    },
  });
  const all = entries.flatMap((e) => e.lines);
  return {
    entries: entries.map((e) => ({
      id: e.id, number: e.number, kind: e.kind, postingDate: iso(e.postingDate), documentDate: iso(e.documentDate), description: e.description,
      lines: e.lines.map((l) => ({
        id: l.id, accountId: l.accountId, accountCode: l.account.code, accountName: l.account.name, analytics: lineAnalytics(l), description: l.description,
        debit: money(dec(l.debit.toString())), credit: money(dec(l.credit.toString())),
      })),
    })),
    debit: money(sumDecimals(all.map((l) => dec(l.debit.toString())))),
    credit: money(sumDecimals(all.map((l) => dec(l.credit.toString())))),
  };
}

export type ReversalRow = {
  id: string; number: string | null; kind: JournalKind; postingDate: string; amount: string; reason: string; postedBy: string;
  original: { id: string; number: string | null; postingDate: string };
  source: { type: string; href: string } | null;
};

/** Storno nalozi u periodu (ručni storno i automatski storno dokumenta), sa originalom i izvornim dokumentom (R-14). */
export async function reversalReview(actor: Actor, range: ReportRange): Promise<ReversalRow[]> {
  requireCapability(actor, "ledger.view");
  const zevId = requireZev(actor);
  const entries = await prisma.journalEntry.findMany({
    where: { zevId, status: "POSTED", reversalOfId: { not: null }, postingDate: { gte: dateOnly(range.from), lte: dateOnly(range.to) } },
    orderBy: [{ postingDate: "asc" }, { number: "asc" }],
    select: {
      id: true, number: true, kind: true, postingDate: true, description: true, reversalReason: true, postedById: true, sourceType: true, sourceId: true,
      reversalOf: { select: { id: true, number: true, postingDate: true } },
      lines: { select: { debit: true } },
    },
  });
  const userIds = [...new Set(entries.flatMap((e) => (e.postedById ? [e.postedById] : [])))];
  const users = await prisma.user.findMany({
    where: { id: { in: userIds } },
    select: { id: true, email: true, parties: { where: { zevId }, take: 1, select: { kind: true, firstName: true, lastName: true, orgName: true } } },
  });
  const name = new Map(users.map((u) => [u.id, displayNameOf(u.parties[0], u.email)]));
  const out: ReversalRow[] = [];
  for (const e of entries) {
    if (!e.reversalOf) continue;
    out.push({
      id: e.id, number: e.number, kind: e.kind, postingDate: iso(e.postingDate),
      amount: money(sumDecimals(e.lines.map((l) => dec(l.debit.toString())))),
      reason: e.reversalReason ?? e.description,
      postedBy: e.postedById ? name.get(e.postedById) ?? "" : "",
      original: { id: e.reversalOf.id, number: e.reversalOf.number, postingDate: iso(e.reversalOf.postingDate) },
      source: e.kind === "AUTO" ? await autoEntrySource(actor, e.sourceType, e.sourceId) : null,
    });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Natpis filtera i CSV (§2.4)
// ---------------------------------------------------------------------------

/** Naziv namjene/projekta iz filtera — samo iz ovog ZEV-a (strani ID nema naziv, a izvještaj je prazan). */
export async function filterLabels(actor: Actor, f: { purposeId?: string | null; projectId?: string | null }) {
  requireCapability(actor, "ledger.view");
  const zevId = requireZev(actor);
  const [purpose, project] = await Promise.all([
    f.purposeId && f.purposeId !== "none" ? prisma.fundPurpose.findFirst({ where: { id: f.purposeId, zevId }, select: { code: true, name: true } }) : null,
    f.projectId && f.projectId !== "none" ? prisma.project.findFirst({ where: { id: f.projectId, zevId }, select: { name: true } }) : null,
  ]);
  return {
    purpose: f.purposeId === "none" ? "" : purpose ? `${purpose.code} ${purpose.name}` : f.purposeId ? "?" : null,
    project: f.projectId === "none" ? "" : project ? project.name : f.projectId ? "?" : null,
  };
}

export const LEDGER_CSV_TYPES = ["dnevnik", "bruto-bilans", "kartica", "glavna-knjiga", "vlasnik", "dobavljac", "namjene", "projekti", "storna"] as const;
export type LedgerCsvType = (typeof LEDGER_CSV_TYPES)[number];

const cardCsvRows = (c: Card) => [
  { konto: c.account.code, naziv: c.account.name, datum: "", dokumentDatum: "", nalog: "", opis: "Početno stanje", analitika: "", duguje: c.openingDebit, potrazuje: c.openingCredit, saldo: c.opening },
  ...c.rows.map((r) => ({
    konto: r.accountCode, naziv: c.account.name, datum: r.postingDate, dokumentDatum: r.documentDate, nalog: r.number ?? "", opis: r.description,
    analitika: r.analytics, duguje: r.debit, potrazuje: r.credit, saldo: r.balance,
  })),
];
const CARD_COLS = [
  { key: "konto", label: "Konto" }, { key: "naziv", label: "Naziv konta" }, { key: "datum", label: "Datum knjiženja" },
  { key: "dokumentDatum", label: "Datum dokumenta" }, { key: "nalog", label: "Nalog" }, { key: "opis", label: "Opis" },
  { key: "analitika", label: "Analitika" }, { key: "duguje", label: "Duguje" }, { key: "potrazuje", label: "Potražuje" }, { key: "saldo", label: "Saldo" },
];

/** CSV jednog izvještaja; izvoz se bilježi u audit (`ledger.report.export`). */
export async function ledgerReportCsv(
  actor: Actor,
  type: LedgerCsvType,
  p: ReportRange & DimFilter & { accountId?: string | null; id?: string | null; kind?: string | null; withSummary?: boolean },
): Promise<string> {
  requireCapability(actor, "ledger.view");
  let csv = "";
  if (type === "dnevnik") {
    const b = await journalBook(actor, p);
    csv = toCsv(
      b.entries.flatMap((e) => e.lines.map((l) => ({
        nalog: e.number ?? "", vrsta: e.kind, datum: e.postingDate, dokumentDatum: e.documentDate, opisNaloga: e.description,
        konto: l.accountCode, naziv: l.accountName, analitika: l.analytics, opis: l.description ?? "", duguje: l.debit, potrazuje: l.credit,
      }))),
      [
        { key: "nalog", label: "Nalog" }, { key: "vrsta", label: "Vrsta" }, { key: "datum", label: "Datum knjiženja" }, { key: "dokumentDatum", label: "Datum dokumenta" },
        { key: "opisNaloga", label: "Opis naloga" }, { key: "konto", label: "Konto" }, { key: "naziv", label: "Naziv konta" }, { key: "analitika", label: "Analitika" },
        { key: "opis", label: "Opis stavke" }, { key: "duguje", label: "Duguje" }, { key: "potrazuje", label: "Potražuje" },
      ],
    );
  } else if (type === "bruto-bilans") {
    const tb = await trialBalance(actor, p);
    csv = toCsv(tb.rows as unknown as Record<string, unknown>[], [
      { key: "code", label: "Konto" }, { key: "name", label: "Naziv" }, { key: "openingDebit", label: "PS duguje" }, { key: "openingCredit", label: "PS potražuje" },
      { key: "debit", label: "Promet duguje" }, { key: "credit", label: "Promet potražuje" }, { key: "closingDebit", label: "Saldo duguje" }, { key: "closingCredit", label: "Saldo potražuje" },
    ]);
  } else if (type === "kartica") {
    const c = p.accountId ? await accountCard(actor, { ...p, accountId: p.accountId }) : null;
    csv = c ? toCsv(cardCsvRows(c), CARD_COLS) : "";
  } else if (type === "glavna-knjiga") {
    csv = toCsv((await generalLedger(actor, p)).flatMap(cardCsvRows), CARD_COLS);
  } else if (type === "vlasnik" || type === "dobavljac") {
    const cs = await dimensionCard(actor, { ...p, dim: type === "vlasnik" ? "party" : "supplier", id: p.id ?? "" });
    csv = toCsv(cs.flatMap(cardCsvRows), CARD_COLS);
  } else if (type === "namjene") {
    csv = toCsv((await purposeOverview(actor, p)).map((r) => ({ ...r, name: r.purposeId === "none" ? "Bez namjene" : `${r.code} ${r.name}` })), [
      { key: "name", label: "Namjena" }, { key: "receivableOpening", label: "Dug na početku" }, { key: "charged", label: "Zaduženo" },
      { key: "collected", label: "Naplaćeno" }, { key: "receivableClosing", label: "Dug na kraju" }, { key: "income", label: "Prihodi" }, { key: "expense", label: "Rashodi" },
    ]);
  } else if (type === "projekti") {
    csv = toCsv((await projectOverview(actor, p)) as unknown as Record<string, unknown>[], [
      { key: "name", label: "Projekat" }, { key: "income", label: "Prihodi" }, { key: "expense", label: "Rashodi" }, { key: "lines", label: "Stavki" },
    ]);
  } else if (type === "storna") {
    csv = toCsv((await reversalReview(actor, p)).map((r) => ({ ...r, original: r.original.number ?? "", source: r.source?.type ?? "" })), [
      { key: "number", label: "Storno nalog" }, { key: "postingDate", label: "Datum knjiženja" }, { key: "original", label: "Original" },
      { key: "reason", label: "Razlog" }, { key: "amount", label: "Iznos" }, { key: "source", label: "Dokument" }, { key: "postedBy", label: "Proknjižio" },
    ]);
  }
  await audit(actor, { action: "ledger.report.export", targetType: "LedgerReport", targetId: type, after: { from: p.from, to: p.to } });
  return csv;
}
