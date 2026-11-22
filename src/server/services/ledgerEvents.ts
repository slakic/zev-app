// Faza B2 — automatsko knjiženje događaja (Plans/kontni-plan-b2-automatsko-knjizenje-plan.md).
//
// Događaji se IZVODE iz operativne evidencije (`syncEvents`): svaki izvorni zapis od datuma početka knjiženja daje
// svoj događaj, a jedinstveni ključ (zevId, sourceType, sourceId, kind) čini upis idempotentnim — ponovljen poziv,
// istovremena obrada ili propušten poziv poslije poslovne radnje ne mogu ni duplirati ni izgubiti događaj.
// `processEvents` zatim svaki događaj knjiži kao jedan AUTO nalog (K-1) po potvrđenim pravilima i kontrolnim
// kontima koja važe na datum događaja; šta ne može — vidljivo čeka sa razlogom (nikad „opšte konto”).
//
// Knjiženje je aktivno kad postoji proknjiženo, nestornirano početno stanje; njegov datum je datum početka (B2-Q1).
// Storno događaji (storno fakture, rasporeda, uplate) knjiže tačnu suprotnost onoga što je proknjiženo za original;
// ako je original nastao prije početka (pa je sadržan u početnom stanju), suprotnost se računa po šemi.
import { prisma } from "@/lib/prisma";
import { audit } from "@/server/audit";
import { requireCapability, requireZev, type Actor } from "@/server/auth/guards";
import { hasCapability } from "@/lib/accountingCapabilities";
import { Prisma, type AccountingEventKind, type AccountingEventStatus, type ControlRole } from "@/generated/prisma/client";
import { dec, sumDecimals, ZERO } from "@/lib/money";
import { formatDate, toZonedDateIso } from "@/lib/i18n";
import { postEntryInTx } from "@/server/services/journal";
import { displayNameOf } from "@/server/auth/displayName";
import { controlAccountsAt, controlKey, defaultPurposeId, ROLE_LABEL } from "@/server/services/openingBalance";
import { allocationSplitRule, chargeTypePurpose, confirmedChargeRule, purposeSplit, type AllocationSplitRule } from "@/server/services/purposeSplit";

type Tx = Prisma.TransactionClient;
type Db = Tx | typeof prisma;
type Decimal = Prisma.Decimal;

const dateOnly = (s: string) => new Date(`${s}T00:00:00Z`);
/** Kalendarski dan (po zoni ZEV-a) trenutka, kao UTC ponoć — isti oblik kao datum knjiženja naloga. */
const dayOf = (d: Date) => dateOnly(toZonedDateIso(d));

/** Redoslijed obrade događaja istog dana i istog trenutka nastanka izvora. */
const KIND_ORDER: Partial<Record<AccountingEventKind, number>> = {
  CHARGE_ISSUED: 0, PAYMENT_RECEIVED: 1, PAYMENT_IDENTIFIED: 2, PAYMENT_ALLOCATED: 3,
  ALLOCATION_REVERSED: 4, PAYMENT_REVERSED: 5, CHARGE_CANCELLED: 6,
  BALANCE_CORRECTION: 0, SUPPLIER_INVOICE: 0, SUPPLIER_PAYMENT: 1, CASH_INCOME: 1, CASH_EXPENSE: 1,
  TRANSACTION_CANCELLED: 7, SUPPLIER_INVOICE_CANCELLED: 8,
};

export const OWNER_EVENT_KINDS: AccountingEventKind[] = [
  "CHARGE_ISSUED", "CHARGE_CANCELLED", "PAYMENT_RECEIVED", "PAYMENT_IDENTIFIED", "PAYMENT_ALLOCATED", "ALLOCATION_REVERSED", "PAYMENT_REVERSED",
];

// ---------------------------------------------------------------------------
// Aktivnost knjiženja
// ---------------------------------------------------------------------------

/** Datum početka knjiženja: datum proknjiženog, nestorniranog početnog stanja; null = knjiženje nije aktivno. */
export async function ledgerStart(db: Db, zevId: string): Promise<Date | null> {
  return (await openingEntry(db, zevId))?.postingDate ?? null;
}

/** Proknjiženo, nestornirano početno stanje: datum početka i trenutak knjiženja (granica „kasno unesenog” zapisa). */
async function openingEntry(db: Db, zevId: string) {
  return db.journalEntry.findFirst({ where: { zevId, kind: "OPENING", status: "POSTED", reversedBy: null }, select: { postingDate: true, postedAt: true } });
}

// ---------------------------------------------------------------------------
// Izvođenje događaja iz evidencije
// ---------------------------------------------------------------------------

type NewEvent = { kind: AccountingEventKind; sourceType: string; sourceId: string; eventDate: Date; sourceCreatedAt: Date; amount: string };

/**
 * Upisuje događaje koji nedostaju za sve zapise evidencije od datuma početka. Idempotentno (skipDuplicates na
 * jedinstvenom ključu izvora). Vraća broj novih događaja.
 */
export async function syncEvents(zevId: string, db: Db = prisma): Promise<number> {
  const opening = await openingEntry(db, zevId);
  if (!opening) return 0;
  const start = opening.postingDate;
  // B4-Q5 (a): zapis sa datumom prije početka koji je unesen POSLIJE knjiženja početnog stanja nije u početnom
  // stanju — dobija događaj (datum dokumenta ostaje, knjiži se na datum početka, `processEventInTx`).
  const postedAt = opening.postedAt ?? new Date(0);
  const late = { gt: postedAt };
  // Granica upita sa danom rezerve (zona); tačan dan se provjerava ispod.
  const from = new Date(start.getTime() - 36 * 3600 * 1000);
  const onOrAfter = (d: Date) => dayOf(d) >= start;
  /** Datum prije početka, ali zapis (ili storno) nastao poslije knjiženja početnog stanja. */
  const isLate = (happenedAt: Date) => happenedAt > postedAt;
  const out: NewEvent[] = [];

  const invoices = await db.invoice.findMany({
    where: {
      zevId, status: { in: ["ISSUED", "PAID", "CANCELLED", "CORRECTED"] },
      OR: [{ issueDate: { gte: from } }, { cancelledAt: { gte: from } }, { status: "CORRECTED" }, { createdAt: late }, { cancelledAt: late }],
    },
    include: { batch: { select: { status: true } }, correctedBy: { select: { issueDate: true, createdAt: true } } },
  });
  for (const inv of invoices) {
    // Faktura iz serije koja nije izdata nikad nije bila zaduženje (storniran nacrt).
    const wasIssued = !inv.batch || inv.batch.status === "ISSUED";
    if (!wasIssued) continue;
    if (onOrAfter(inv.issueDate) || isLate(inv.createdAt)) {
      out.push({ kind: "CHARGE_ISSUED", sourceType: "Invoice", sourceId: inv.id, eventDate: dayOf(inv.issueDate), sourceCreatedAt: inv.createdAt, amount: inv.total.toFixed(2) });
    }
    const cancelAt = inv.status === "CANCELLED" ? inv.cancelledAt : inv.status === "CORRECTED" ? inv.correctedBy?.issueDate ?? null : null;
    if (cancelAt && (onOrAfter(cancelAt) || isLate(cancelAt))) {
      out.push({ kind: "CHARGE_CANCELLED", sourceType: "Invoice", sourceId: inv.id, eventDate: dayOf(cancelAt), sourceCreatedAt: inv.status === "CORRECTED" ? inv.correctedBy!.createdAt : cancelAt, amount: inv.total.toFixed(2) });
    }
  }

  const payments = await db.payment.findMany({ where: { zevId, OR: [{ date: { gte: from } }, { reversedAt: { gte: from } }, { createdAt: late }, { reversedAt: late }] } });
  for (const p of payments) {
    if (onOrAfter(p.date) || isLate(p.createdAt)) out.push({ kind: "PAYMENT_RECEIVED", sourceType: "Payment", sourceId: p.id, eventDate: dayOf(p.date), sourceCreatedAt: p.createdAt, amount: p.amount.toFixed(2) });
    if (p.reversedAt && (onOrAfter(p.reversedAt) || isLate(p.reversedAt))) out.push({ kind: "PAYMENT_REVERSED", sourceType: "Payment", sourceId: p.id, eventDate: dayOf(p.reversedAt), sourceCreatedAt: p.reversedAt, amount: p.amount.toFixed(2) });
  }

  const allocations = await db.paymentAllocation.findMany({ where: { payment: { zevId }, OR: [{ createdAt: { gte: from } }, { createdAt: late }] }, include: { payment: { select: { payerId: true } } } });
  for (const a of allocations) {
    if (!onOrAfter(a.createdAt) && !isLate(a.createdAt)) continue;
    const base = { sourceType: "PaymentAllocation", sourceId: a.id, eventDate: dayOf(a.createdAt), sourceCreatedAt: a.createdAt };
    const amount = dec(a.amount.toString());
    if (amount.gt(0)) {
      // B2-Q4 (a): uplata bez platioca raspoređena na fakturu = identifikacija (dužnik fakture) pa raspored.
      if (!a.payment.payerId) out.push({ ...base, kind: "PAYMENT_IDENTIFIED", amount: amount.toFixed(2) });
      out.push({ ...base, kind: "PAYMENT_ALLOCATED", amount: amount.toFixed(2) });
    } else if (amount.lt(0)) {
      out.push({ ...base, kind: "ALLOCATION_REVERSED", amount: amount.abs().toFixed(2) });
    }
  }

  // Korekcije salda (B2-Q8): dug lica raste (+) ili pada (−) na dan unosa.
  const corrections = await db.balanceCorrection.findMany({ where: { zevId, OR: [{ createdAt: { gte: from } }, { createdAt: late }] } });
  for (const c of corrections) {
    if (onOrAfter(c.createdAt) || isLate(c.createdAt)) out.push({ kind: "BALANCE_CORRECTION", sourceType: "BalanceCorrection", sourceId: c.id, eventDate: dayOf(c.createdAt), sourceCreatedAt: c.createdAt, amount: c.amount.toFixed(2) });
  }

  // Računi dobavljača: datum računa (bez datuma — dan unosa), storno na dan storna.
  const expenses = await db.expense.findMany({
    where: { zevId, OR: [{ invoiceDate: { gte: from } }, { invoiceDate: null, createdAt: { gte: from } }, { cancelledAt: { gte: from } }, { createdAt: late }, { cancelledAt: late }] },
  });
  for (const e of expenses) {
    const base = { sourceType: "Expense", sourceId: e.id, amount: e.amount.toFixed(2) };
    if (onOrAfter(expenseDate(e)) || isLate(e.createdAt)) out.push({ ...base, kind: "SUPPLIER_INVOICE", eventDate: dayOf(expenseDate(e)), sourceCreatedAt: e.createdAt });
    if (e.status === "CANCELLED" && e.cancelledAt && (onOrAfter(e.cancelledAt) || isLate(e.cancelledAt))) out.push({ ...base, kind: "SUPPLIER_INVOICE_CANCELLED", eventDate: dayOf(e.cancelledAt), sourceCreatedAt: e.cancelledAt });
  }

  // Promet bez uplate (K-2: promet uplate vlasnika knjiži se kroz uplatu): plaćanje troška ili ručni prihod/rashod.
  const txs = await db.finTransaction.findMany({
    where: { zevId, paymentId: null, type: { in: ["INCOME", "EXPENSE"] }, OR: [{ date: { gte: from } }, { cancelledAt: { gte: from } }, { createdAt: late }, { cancelledAt: late }] },
  });
  for (const t of txs) {
    const base = { sourceType: "FinTransaction", sourceId: t.id, amount: t.amount.toFixed(2) };
    if (onOrAfter(t.date) || isLate(t.createdAt)) out.push({ ...base, kind: transactionKind(t), eventDate: dayOf(t.date), sourceCreatedAt: t.createdAt });
    if (t.status === "CANCELLED" && t.cancelledAt && (onOrAfter(t.cancelledAt) || isLate(t.cancelledAt))) out.push({ ...base, kind: "TRANSACTION_CANCELLED", eventDate: dayOf(t.cancelledAt), sourceCreatedAt: t.cancelledAt });
  }

  if (out.length === 0) return 0;
  const res = await db.accountingEvent.createMany({ data: out.map((e) => ({ ...e, zevId })), skipDuplicates: true });
  return res.count;
}

/** Datum računa dobavljača; trošak bez datuma računa nastaje danom unosa. */
export const expenseDate = (e: { invoiceDate: Date | null; createdAt: Date }) => e.invoiceDate ?? e.createdAt;

/** Vrsta događaja prometa bez uplate: izlaz sa troškom je plaćanje dobavljaču, ostalo ručni prihod/rashod. */
const transactionKind = (t: { type: string; expenseId: string | null }): AccountingEventKind =>
  t.type === "EXPENSE" ? (t.expenseId ? "SUPPLIER_PAYMENT" : "CASH_EXPENSE") : "CASH_INCOME";

// ---------------------------------------------------------------------------
// Šeme
// ---------------------------------------------------------------------------

type Signed = {
  accountId: string; amount: Decimal; // + duguje, − potražuje
  partyId?: string | null; unitId?: string | null; supplierId?: string | null; projectId?: string | null; purposeId?: string | null;
  description?: string | null; ruleId?: string | null;
};
type Built =
  | { ok: true; lines: Signed[]; description: string; reversalOfId?: string | null }
  | { ok: false; status: Exclude<AccountingEventStatus, "PENDING" | "POSTED">; detail: string };

const wait = (status: Exclude<AccountingEventStatus, "PENDING" | "POSTED">, detail: string): Built => ({ ok: false, status, detail });

class Waiting extends Error {
  constructor(public status: Exclude<AccountingEventStatus, "PENDING" | "POSTED">, message: string) { super(message); }
}

/** Kontekst jednog obrađivanja: kontrolna konta, pravila i podešavanja na datum, sa kešom. */
function context(db: Db, zevId: string) {
  const controlsByDate = new Map<number, Awaited<ReturnType<typeof controlAccountsAt>>>();
  const purposes = new Map<string, { isCommonReserve: boolean; name: string }>();
  let fallback: string | null | undefined;
  let gate: boolean | undefined;
  let rule: AllocationSplitRule | undefined;
  return {
    async control(role: ControlRole, at: Date, opts: { moneyAccountId?: string | null; purposeId?: string | null } = {}) {
      let m = controlsByDate.get(at.getTime());
      if (!m) controlsByDate.set(at.getTime(), (m = await controlAccountsAt(db, zevId, at)));
      const exact = m.get(controlKey({ role, moneyAccountId: opts.moneyAccountId ?? null, purposeId: opts.purposeId ?? null }));
      // Potraživanja: konto bez namjene važi za namjene bez sopstvenog konta (A2).
      const c = exact ?? (role === "OWNER_RECEIVABLE" && opts.purposeId ? m.get(controlKey({ role, moneyAccountId: null, purposeId: null })) : undefined);
      if (!c) throw new Waiting("WAITING_RULE", `Nedostaje kontrolno konto (${ROLE_LABEL[role]}) važeće na ${formatDate(at)}`);
      return c.accountId;
    },
    async purpose(id: string | null) {
      if (!id) return null;
      if (purposes.size === 0) for (const p of await db.fundPurpose.findMany({ where: { zevId } })) purposes.set(p.id, p);
      return purposes.get(id) ?? null;
    },
    async fallbackPurpose() {
      if (fallback === undefined) fallback = await defaultPurposeId(db, zevId);
      return fallback;
    },
    async reserveGateOpen() {
      if (gate === undefined) {
        const last = await db.postingSchemaApproval.findFirst({ where: { zevId, schema: "COMMON_RESERVE_CLASSIFICATION" }, orderBy: { createdAt: "desc" } });
        gate = !!last && last.revokesId === null;
      }
      return gate;
    },
    async allocationRule(): Promise<AllocationSplitRule> {
      if (rule === undefined) rule = await allocationSplitRule(db, zevId);
      return rule;
    },
  };
}
type Ctx = ReturnType<typeof context>;

type InvoiceFull = Prisma.InvoiceGetPayload<{ include: { lines: { include: { chargeType: true; chargeItem: { select: { chargeTypeId: true } } } } } }>;

async function loadInvoice(db: Db, zevId: string, id: string): Promise<InvoiceFull> {
  return db.invoice.findUniqueOrThrow({
    where: { id, zevId },
    include: { lines: { orderBy: { order: "asc" }, include: { chargeType: true, chargeItem: { select: { chargeTypeId: true } } } } },
  });
}

/** Iznosi fakture po namjeni, redom prve linije (namjena: pravilo vrste, pa podrazumijevana namjena vrste, pa ZEV-a). */
async function invoicePurposes(db: Db, zevId: string, ctx: Ctx, inv: InvoiceFull) {
  const out = new Map<string, Decimal>();
  for (const l of inv.lines) {
    const typeId = l.chargeTypeId ?? l.chargeItem?.chargeTypeId ?? null;
    const purpose = (typeId ? await chargeTypePurpose(db, zevId, typeId, inv.issueDate) : null) ?? (await ctx.fallbackPurpose()) ?? "";
    out.set(purpose, (out.get(purpose) ?? ZERO).plus(dec(l.amount.toString())));
  }
  if (out.size === 0) out.set((await ctx.fallbackPurpose()) ?? "", dec(inv.total.toString()));
  return out;
}

async function assertReserveAllowed(ctx: Ctx, purposeId: string | null) {
  const p = await ctx.purpose(purposeId);
  if (p?.isCommonReserve && !(await ctx.reserveGateOpen())) {
    throw new Waiting("WAITING_SCHEMA", `Namjena „${p.name}” je zajednička rezerva — čeka potvrdu šeme knjiženja (bilansna klasifikacija rezerve).`);
  }
}

/** Zaduženje: D potraživanja (vlasnik, dio, namjena) / P protivkonto pravila — po paru za svaku vrstu zaduženja. */
async function chargeLines(db: Db, zevId: string, ctx: Ctx, inv: InvoiceFull, at: Date): Promise<Signed[]> {
  const byType = new Map<string, Decimal>();
  for (const l of inv.lines) {
    const typeId = l.chargeTypeId ?? l.chargeItem?.chargeTypeId ?? null;
    if (!typeId) throw new Waiting("WAITING_RULE", `Faktura ${inv.number} ima stavku bez vrste zaduženja („${l.description}”).`);
    byType.set(typeId, (byType.get(typeId) ?? ZERO).plus(dec(l.amount.toString())));
  }
  const lines: Signed[] = [];
  for (const [typeId, amount] of byType) {
    const ct = await db.chargeType.findUniqueOrThrow({ where: { id: typeId } });
    const rule = await confirmedChargeRule(db, zevId, typeId, at);
    const purposeId = rule?.purposeId ?? ct.defaultPurposeId ?? null;
    await assertReserveAllowed(ctx, purposeId);
    if (!rule) throw new Waiting("WAITING_RULE", `Vrsta zaduženja „${ct.name}” nema potvrđeno pravilo knjiženja na ${formatDate(at)}`);
    const receivable = await ctx.control("OWNER_RECEIVABLE", at, { purposeId });
    lines.push({ accountId: receivable, amount, partyId: inv.debtorId, unitId: inv.unitId, purposeId, description: `Faktura ${inv.number}` });
    lines.push({ accountId: rule.counterAccountId, amount: amount.negated(), unitId: inv.unitId, purposeId, ruleId: rule.id, description: ct.name });
  }
  return lines;
}

async function receiptLines(ctx: Ctx, p: { id: string; accountId: string; payerId: string | null; amount: Prisma.Decimal; date: Date }, at: Date): Promise<Signed[]> {
  const amount = dec(p.amount.toString());
  const money = await ctx.control("MONEY_ACCOUNT", at, { moneyAccountId: p.accountId });
  const other = p.payerId ? await ctx.control("OWNER_ADVANCE", at) : await ctx.control("UNIDENTIFIED_RECEIPTS", at);
  return [
    { accountId: money, amount, description: `Uplata ${formatDate(p.date)}` },
    { accountId: other, amount: amount.negated(), partyId: p.payerId, description: p.payerId ? "Avans" : "Neidentifikovana uplata" },
  ];
}

type AllocationFull = Prisma.PaymentAllocationGetPayload<{ include: { payment: true } }>;

/** Dio rasporeda po namjeni: kumulativno po pravilu raspodjele (B2-Q7), pa zbir rasporeda tačno zatvara fakturu. */
async function allocationByPurpose(db: Db, zevId: string, ctx: Ctx, inv: InvoiceFull, a: AllocationFull) {
  const purposes = await invoicePurposes(db, zevId, ctx, inv);
  const all = await db.paymentAllocation.findMany({ where: { invoiceId: inv.id }, orderBy: [{ createdAt: "asc" }, { id: "asc" }] });
  let before = ZERO;
  for (const x of all) {
    if (x.id === a.id) break;
    before = before.plus(dec(x.amount.toString()));
  }
  const amount = dec(a.amount.toString());
  const after = before.plus(amount);
  if (purposes.size === 1) return new Map([[[...purposes.keys()][0], amount]]);
  const total = sumDecimals([...purposes.values()]);
  let rule = await ctx.allocationRule();
  // Raspored koji odjednom pokriva cijelu fakturu ne traži pravilo.
  if (rule === "NOT_SET" && before.isZero() && after.eq(total)) rule = "PROPORTIONAL";
  if (rule === "NOT_SET") {
    throw new Waiting("WAITING_SCHEMA", `Djelimičan raspored na fakturu ${inv.number} sa više namjena — izaberite pravilo raspodjele djelimične uplate (tab „Pravila knjiženja”).`);
  }
  const a1 = purposeSplit(rule, purposes, after);
  const a0 = purposeSplit(rule, purposes, before);
  return new Map([...purposes.keys()].map((k) => [k, (a1.get(k) ?? ZERO).minus(a0.get(k) ?? ZERO)]));
}

async function allocatedLines(db: Db, zevId: string, ctx: Ctx, a: AllocationFull, at: Date): Promise<Signed[]> {
  const inv = await loadInvoice(db, zevId, a.invoiceId);
  const party = a.payment.payerId ?? inv.debtorId;
  const advance = await ctx.control("OWNER_ADVANCE", at);
  const split = await allocationByPurpose(db, zevId, ctx, inv, a);
  const lines: Signed[] = [{ accountId: advance, amount: dec(a.amount.toString()), partyId: party, description: `Raspored na fakturu ${inv.number}` }];
  for (const [purpose, amount] of split) {
    if (amount.isZero()) continue;
    const purposeId = purpose || null;
    await assertReserveAllowed(ctx, purposeId);
    const receivable = await ctx.control("OWNER_RECEIVABLE", at, { purposeId });
    lines.push({ accountId: receivable, amount: amount.negated(), partyId: inv.debtorId, unitId: inv.unitId, purposeId, description: `Faktura ${inv.number}` });
  }
  return lines;
}

async function identifiedLines(db: Db, zevId: string, ctx: Ctx, a: AllocationFull, at: Date): Promise<Signed[]> {
  const inv = await db.invoice.findUniqueOrThrow({ where: { id: a.invoiceId, zevId }, select: { debtorId: true, number: true } });
  const amount = dec(a.amount.toString());
  return [
    { accountId: await ctx.control("UNIDENTIFIED_RECEIPTS", at), amount, description: `Identifikacija uplate ${formatDate(a.payment.date)}` },
    { accountId: await ctx.control("OWNER_ADVANCE", at), amount: amount.negated(), partyId: inv.debtorId, description: `Dužnik fakture ${inv.number}` },
  ];
}

// ---------------------------------------------------------------------------
// Dobavljači, ručni promet, korekcije salda (B2b)
// ---------------------------------------------------------------------------

/** Potvrđeno pravilo po kategoriji (ili bez ključa — korekcija salda) na dan. */
async function confirmedRule(db: Db, zevId: string, kind: AccountingEventKind, categoryId: string | null, at: Date) {
  return db.postingRule.findFirst({
    where: { zevId, kind, categoryId, chargeTypeId: null, status: "CONFIRMED", validFrom: { lte: at } },
    orderBy: [{ validFrom: "desc" }, { createdAt: "desc" }],
  });
}

/** Pravilo kategorije sa namjenom (izričita namjena pravila, inače podrazumijevana namjena ZEV-a). */
async function categoryRule(db: Db, zevId: string, ctx: Ctx, kind: "SUPPLIER_INVOICE" | "CASH_INCOME" | "CASH_EXPENSE", categoryId: string | null, at: Date, what: string) {
  if (!categoryId) throw new Waiting("WAITING_RULE", `${what} nema kategoriju — bez kategorije nema pravila knjiženja.`);
  const cat = await db.transactionCategory.findUniqueOrThrow({ where: { id: categoryId, zevId } });
  const rule = await confirmedRule(db, zevId, kind, categoryId, at);
  if (!rule) throw new Waiting("WAITING_RULE", `Kategorija „${cat.name}” nema potvrđeno pravilo knjiženja (${KIND_LABEL[kind]}) na ${formatDate(at)}`);
  const purposeId = rule.purposeId ?? (await ctx.fallbackPurpose());
  await assertReserveAllowed(ctx, purposeId);
  return { rule, purposeId, categoryName: cat.name };
}

const KIND_LABEL: Partial<Record<AccountingEventKind, string>> = {
  SUPPLIER_INVOICE: "račun dobavljača", CASH_INCOME: "ručni prihod", CASH_EXPENSE: "ručni rashod",
};

type ExpenseFull = Prisma.ExpenseGetPayload<{ include: { supplier: { select: { name: true } } } }>;

const expenseLabel = (e: ExpenseFull) => `Račun ${e.supplier?.name ?? "bez dobavljača"}${e.invoiceNumber ? ` br. ${e.invoiceNumber}` : ""}`;

/** Račun dobavljača: D protivkonto pravila kategorije (projekat, namjena) / P dobavljači (dobavljač). */
async function supplierInvoiceLines(db: Db, zevId: string, ctx: Ctx, e: ExpenseFull, at: Date): Promise<Signed[]> {
  const { rule, purposeId, categoryName } = await categoryRule(db, zevId, ctx, "SUPPLIER_INVOICE", e.categoryId, at, "Trošak");
  const amount = dec(e.amount.toString());
  return [
    { accountId: rule.counterAccountId, amount, projectId: e.projectId, purposeId, ruleId: rule.id, description: categoryName },
    { accountId: await ctx.control("SUPPLIER_PAYABLE", at), amount: amount.negated(), supplierId: e.supplierId, description: expenseLabel(e) },
  ];
}

type TxFull = Prisma.FinTransactionGetPayload<object>;

/** Promet bez uplate: plaćanje dobavljaču (D dobavljači / P novac) ili ručni prihod/rashod po pravilu kategorije. */
async function transactionLines(db: Db, zevId: string, ctx: Ctx, t: TxFull, at: Date): Promise<Signed[]> {
  const amount = dec(t.amount.toString());
  const money = await ctx.control("MONEY_ACCOUNT", at, { moneyAccountId: t.accountId });
  const kind = transactionKind(t);
  if (kind === "SUPPLIER_PAYMENT") {
    const e = await db.expense.findUniqueOrThrow({ where: { id: t.expenseId!, zevId }, include: { supplier: { select: { name: true } } } });
    return [
      { accountId: await ctx.control("SUPPLIER_PAYABLE", at), amount, supplierId: e.supplierId, description: expenseLabel(e) },
      { accountId: money, amount: amount.negated(), description: `Plaćanje ${formatDate(t.date)}` },
    ];
  }
  const { rule, purposeId, categoryName } = await categoryRule(db, zevId, ctx, kind as "CASH_INCOME" | "CASH_EXPENSE", t.categoryId, at, "Transakcija");
  const sign = kind === "CASH_INCOME" ? amount : amount.negated();
  return [
    { accountId: money, amount: sign, description: t.counterpartyName ?? t.description ?? categoryName },
    { accountId: rule.counterAccountId, amount: sign.negated(), projectId: t.projectId, purposeId, ruleId: rule.id, description: categoryName },
  ];
}

/** Korekcija salda (B2-Q8): D/P potraživanja (lice, dio, namjena) / protivkonto pravila „Korekcija salda”. */
async function correctionLines(db: Db, zevId: string, ctx: Ctx, c: { amount: Prisma.Decimal; partyId: string; unitId: string | null; reason: string }, at: Date): Promise<Signed[]> {
  const rule = await confirmedRule(db, zevId, "BALANCE_CORRECTION", null, at);
  if (!rule) throw new Waiting("WAITING_RULE", `Nema potvrđenog pravila knjiženja „Korekcija salda” na ${formatDate(at)}`);
  const purposeId = rule.purposeId ?? (await ctx.fallbackPurpose());
  await assertReserveAllowed(ctx, purposeId);
  const amount = dec(c.amount.toString());
  return [
    { accountId: await ctx.control("OWNER_RECEIVABLE", at, { purposeId }), amount, partyId: c.partyId, unitId: c.unitId, purposeId, description: c.reason },
    { accountId: rule.counterAccountId, amount: amount.negated(), unitId: c.unitId, purposeId, ruleId: rule.id, description: "Korekcija salda" },
  ];
}

// ---------------------------------------------------------------------------
// Storno: suprotnost proknjiženog originala (ili šeme, ako je original prije početka)
// ---------------------------------------------------------------------------

const lineKey = (l: Signed) => [l.accountId, l.partyId ?? "", l.unitId ?? "", l.supplierId ?? "", l.projectId ?? "", l.purposeId ?? ""].join("|");

function netLines(lines: Signed[]): Signed[] {
  const m = new Map<string, Signed>();
  for (const l of lines) {
    const k = lineKey(l);
    const cur = m.get(k);
    if (cur) cur.amount = cur.amount.plus(l.amount);
    else m.set(k, { ...l, amount: l.amount });
  }
  return [...m.values()].filter((l) => !l.amount.isZero());
}

const negate = (lines: Signed[]) => lines.map((l) => ({ ...l, amount: l.amount.negated() }));

async function entryLines(db: Db, entryId: string): Promise<Signed[]> {
  const rows = await db.journalLine.findMany({ where: { entryId }, orderBy: { order: "asc" } });
  return rows.map((l) => ({
    accountId: l.accountId, amount: dec(l.debit.toString()).minus(dec(l.credit.toString())),
    partyId: l.partyId, unitId: l.unitId, supplierId: l.supplierId, projectId: l.projectId, purposeId: l.purposeId, description: l.description, ruleId: l.ruleId,
  }));
}

const ORIGINAL_LABEL: Partial<Record<AccountingEventKind, string>> = {
  CHARGE_ISSUED: "zaduženje", PAYMENT_RECEIVED: "priliv uplate", SUPPLIER_INVOICE: "račun dobavljača",
  SUPPLIER_PAYMENT: "plaćanje dobavljaču", CASH_INCOME: "prihod", CASH_EXPENSE: "rashod",
};

/** Linije koje je original dao: proknjižen događaj → njegov nalog; nema događaja (prije početka) → šema; inače čeka. */
async function originalLines(db: Db, zevId: string, sourceType: string, sourceId: string, kind: AccountingEventKind, fresh: () => Promise<Signed[]>) {
  const ev = await db.accountingEvent.findUnique({ where: { zevId_sourceType_sourceId_kind: { zevId, sourceType, sourceId, kind } } });
  if (!ev) return { lines: await fresh(), entryId: null as string | null };
  if (ev.status !== "POSTED" || !ev.journalEntryId) throw new Waiting("WAITING_PREDECESSOR", `Čeka da se proknjiži originalni događaj (${ORIGINAL_LABEL[ev.kind] ?? "raspored"}).`);
  return { lines: await entryLines(db, ev.journalEntryId), entryId: ev.journalEntryId };
}

/** Sve što je raspored (pozitivan ili negativan red) dao u knjizi, rekurzivno za storno redove. */
async function allocationRowLines(db: Db, zevId: string, ctx: Ctx, row: AllocationFull, at: Date): Promise<Signed[]> {
  if (dec(row.amount.toString()).gt(0)) {
    const lines: Signed[] = [];
    if (!row.payment.payerId) lines.push(...(await originalLines(db, zevId, "PaymentAllocation", row.id, "PAYMENT_IDENTIFIED", () => identifiedLines(db, zevId, ctx, row, at))).lines);
    lines.push(...(await originalLines(db, zevId, "PaymentAllocation", row.id, "PAYMENT_ALLOCATED", () => allocatedLines(db, zevId, ctx, row, at))).lines);
    return lines;
  }
  return (await originalLines(db, zevId, "PaymentAllocation", row.id, "ALLOCATION_REVERSED", async () => negate(await relatedAllocationLines(db, zevId, ctx, row, at)))).lines;
}

/** Redovi koje negativan red rasporeda poništava: izričito jedan (`reversalOfId`) ili, kod storna uplate, sve ranije za isti par uplata–faktura. */
async function relatedAllocationLines(db: Db, zevId: string, ctx: Ctx, row: AllocationFull, at: Date): Promise<Signed[]> {
  const related = row.reversalOfId
    ? await db.paymentAllocation.findMany({ where: { id: row.reversalOfId }, include: { payment: true } })
    : (await db.paymentAllocation.findMany({ where: { paymentId: row.paymentId, invoiceId: row.invoiceId }, include: { payment: true }, orderBy: [{ createdAt: "asc" }, { id: "asc" }] }))
      .filter((x) => x.id !== row.id && (x.createdAt < row.createdAt || (x.createdAt.getTime() === row.createdAt.getTime() && x.id < row.id)));
  const lines: Signed[] = [];
  for (const r of related) lines.push(...(await allocationRowLines(db, zevId, ctx, r, at)));
  return lines;
}

// ---------------------------------------------------------------------------
// Jedan događaj → linije naloga
// ---------------------------------------------------------------------------

async function build(db: Db, zevId: string, ctx: Ctx, ev: { kind: AccountingEventKind; sourceId: string; eventDate: Date }): Promise<Built> {
  const at = ev.eventDate;
  try {
    switch (ev.kind) {
      case "CHARGE_ISSUED": {
        const inv = await loadInvoice(db, zevId, ev.sourceId);
        return { ok: true, lines: await chargeLines(db, zevId, ctx, inv, at), description: `Zaduženje — faktura ${inv.number}` };
      }
      case "CHARGE_CANCELLED": {
        const inv = await loadInvoice(db, zevId, ev.sourceId);
        const o = await originalLines(db, zevId, "Invoice", inv.id, "CHARGE_ISSUED", () => chargeLines(db, zevId, ctx, inv, at));
        return { ok: true, lines: negate(o.lines), description: `Storno zaduženja — faktura ${inv.number}`, reversalOfId: o.entryId };
      }
      case "PAYMENT_RECEIVED": {
        const p = await db.payment.findUniqueOrThrow({ where: { id: ev.sourceId, zevId } });
        return { ok: true, lines: await receiptLines(ctx, p, at), description: `Uplata ${formatDate(p.date)}${p.payerNameRaw ? ` — ${p.payerNameRaw}` : ""}` };
      }
      case "PAYMENT_REVERSED": {
        const p = await db.payment.findUniqueOrThrow({ where: { id: ev.sourceId, zevId } });
        // Storno uplate čeka da se proknjiže svi stornirani rasporedi te uplate (inače avans u knjizi ide u minus).
        const pendingReversals = await db.accountingEvent.count({
          where: { zevId, kind: "ALLOCATION_REVERSED", status: { not: "POSTED" }, sourceId: { in: (await db.paymentAllocation.findMany({ where: { paymentId: p.id }, select: { id: true } })).map((x) => x.id) } },
        });
        if (pendingReversals > 0) return wait("WAITING_PREDECESSOR", "Čeka da se proknjiže storna rasporeda ove uplate.");
        const o = await originalLines(db, zevId, "Payment", p.id, "PAYMENT_RECEIVED", () => receiptLines(ctx, p, at));
        return { ok: true, lines: negate(o.lines), description: `Storno uplate ${formatDate(p.date)}`, reversalOfId: o.entryId };
      }
      case "PAYMENT_IDENTIFIED":
      case "PAYMENT_ALLOCATED": {
        const a = await db.paymentAllocation.findUniqueOrThrow({ where: { id: ev.sourceId }, include: { payment: true } });
        if (a.payment.zevId !== zevId) throw new Error("Raspored nije iz ovog ZEV-a.");
        // Prethodnici: priliv uplate, zaduženje fakture, a za raspored neidentifikovane uplate i identifikacija.
        await requirePosted(db, zevId, "Payment", a.paymentId, "PAYMENT_RECEIVED", `priliv uplate od ${formatDate(a.payment.date)}`);
        if (ev.kind === "PAYMENT_ALLOCATED") {
          const inv = await db.invoice.findUniqueOrThrow({ where: { id: a.invoiceId }, select: { number: true } });
          await requirePosted(db, zevId, "Invoice", a.invoiceId, "CHARGE_ISSUED", `zaduženje fakture ${inv.number}`);
          if (!a.payment.payerId) await requirePosted(db, zevId, "PaymentAllocation", a.id, "PAYMENT_IDENTIFIED", "identifikacija uplate");
          return { ok: true, lines: await allocatedLines(db, zevId, ctx, a, at), description: `Raspored uplate ${formatDate(a.payment.date)} na fakturu ${inv.number}` };
        }
        return { ok: true, lines: await identifiedLines(db, zevId, ctx, a, at), description: `Identifikacija uplate ${formatDate(a.payment.date)}` };
      }
      case "ALLOCATION_REVERSED": {
        const a = await db.paymentAllocation.findUniqueOrThrow({ where: { id: ev.sourceId }, include: { payment: true } });
        if (a.payment.zevId !== zevId) throw new Error("Raspored nije iz ovog ZEV-a.");
        const inv = await db.invoice.findUniqueOrThrow({ where: { id: a.invoiceId }, select: { number: true } });
        let reversalOfId: string | null = null;
        if (a.reversalOfId) {
          const orig = await db.accountingEvent.findUnique({ where: { zevId_sourceType_sourceId_kind: { zevId, sourceType: "PaymentAllocation", sourceId: a.reversalOfId, kind: "PAYMENT_ALLOCATED" } } });
          reversalOfId = orig?.journalEntryId ?? null;
        }
        const lines = negate(await relatedAllocationLines(db, zevId, ctx, a, at));
        return { ok: true, lines, description: `Storno rasporeda na fakturu ${inv.number}`, reversalOfId };
      }
      case "SUPPLIER_INVOICE": {
        const e = await db.expense.findUniqueOrThrow({ where: { id: ev.sourceId, zevId }, include: { supplier: { select: { name: true } } } });
        return { ok: true, lines: await supplierInvoiceLines(db, zevId, ctx, e, at), description: expenseLabel(e) };
      }
      case "SUPPLIER_INVOICE_CANCELLED": {
        const e = await db.expense.findUniqueOrThrow({ where: { id: ev.sourceId, zevId }, include: { supplier: { select: { name: true } } } });
        const o = await originalLines(db, zevId, "Expense", e.id, "SUPPLIER_INVOICE", () => supplierInvoiceLines(db, zevId, ctx, e, at));
        return { ok: true, lines: negate(o.lines), description: `Storno — ${expenseLabel(e)}`, reversalOfId: o.entryId };
      }
      case "SUPPLIER_PAYMENT":
      case "CASH_INCOME":
      case "CASH_EXPENSE": {
        const t = await db.finTransaction.findUniqueOrThrow({ where: { id: ev.sourceId, zevId } });
        if (t.expenseId) await requirePosted(db, zevId, "Expense", t.expenseId, "SUPPLIER_INVOICE", "račun dobavljača koji se plaća");
        return { ok: true, lines: await transactionLines(db, zevId, ctx, t, at), description: `${t.expenseId ? "Plaćanje dobavljaču" : t.type === "INCOME" ? "Prihod" : "Rashod"} ${formatDate(t.date)}${t.counterpartyName ? ` — ${t.counterpartyName}` : ""}` };
      }
      case "TRANSACTION_CANCELLED": {
        const t = await db.finTransaction.findUniqueOrThrow({ where: { id: ev.sourceId, zevId } });
        const o = await originalLines(db, zevId, "FinTransaction", t.id, transactionKind(t), () => transactionLines(db, zevId, ctx, t, at));
        return { ok: true, lines: negate(o.lines), description: `Storno transakcije ${formatDate(t.date)}${t.counterpartyName ? ` — ${t.counterpartyName}` : ""}`, reversalOfId: o.entryId };
      }
      case "BALANCE_CORRECTION": {
        const c = await db.balanceCorrection.findUniqueOrThrow({ where: { id: ev.sourceId, zevId } });
        return { ok: true, lines: await correctionLines(db, zevId, ctx, c, at), description: `Korekcija salda — ${c.reason}` };
      }
      default:
        return wait("WAITING_RULE", "Ova vrsta događaja se još ne knjiži automatski.");
    }
  } catch (e) {
    if (e instanceof Waiting) return wait(e.status, e.message);
    throw e;
  }
}

/** Prethodnik mora biti proknjižen; ako ne postoji (nastao prije početka knjiženja), sadržan je u početnom stanju. */
async function requirePosted(db: Db, zevId: string, sourceType: string, sourceId: string, kind: AccountingEventKind, what: string) {
  const ev = await db.accountingEvent.findUnique({ where: { zevId_sourceType_sourceId_kind: { zevId, sourceType, sourceId, kind } } });
  if (ev && ev.status !== "POSTED") throw new Waiting("WAITING_PREDECESSOR", `Čeka da se proknjiži ${what}.`);
}

// ---------------------------------------------------------------------------
// Obrada
// ---------------------------------------------------------------------------

/** Prvi otvoren period na ili poslije datuma (za „Proknjiži u tekući period”, B2-Q6 (b)). */
async function periodFor(db: Db, zevId: string, at: Date) {
  return db.fiscalPeriod.findFirst({ where: { zevId, startDate: { lte: at }, endDate: { gte: at } }, include: { year: true } });
}

/**
 * Knjiži jedan događaj u sopstvenoj transakciji. `intoOpenPeriod`: datum knjiženja je prvi dan prvog otvorenog
 * perioda poslije datuma događaja (datum dokumenta ostaje izvorni).
 */
export async function processEvent(zevId: string, eventId: string, userId: string, opts: { intoOpenPeriod?: boolean } = {}) {
  try {
    return await prisma.$transaction((tx) => processEventInTx(tx, zevId, eventId, userId, opts));
  } catch (e) {
    // Kontrole knjiženja (dimenzija, konto…) — događaj čeka sa porukom; poslovna radnja je već prošla.
    await markFailed(prisma, zevId, eventId, e);
    return null;
  }
}

async function markFailed(db: Db, zevId: string, eventId: string, e: unknown) {
  const detail = e instanceof Error ? e.message : "Greška pri knjiženju.";
  await db.accountingEvent.updateMany({ where: { id: eventId, zevId, status: { not: "POSTED" } }, data: { status: "WAITING_RULE", statusDetail: detail.slice(0, 500), processedAt: new Date() } });
}

/** Isto kao `processEvent`, u zadatoj transakciji (probno knjiženje, B4-Q2 (a)); greška se ne hvata. */
export async function processEventInTx(tx: Tx, zevId: string, eventId: string, userId: string, opts: { intoOpenPeriod?: boolean } = {}) {
  await tx.$queryRaw`SELECT id FROM "AccountingEvent" WHERE id = ${eventId} AND "zevId" = ${zevId} FOR UPDATE`;
  const ev = await tx.accountingEvent.findUniqueOrThrow({ where: { id: eventId, zevId } });
  if (ev.status === "POSTED") return ev;
  // Kasno unesen dokument (B4-Q5 (a)): datum prije početka knjiženja → šema i knjiženje na datum početka,
  // datum dokumenta ostaje izvorni.
  const start = await ledgerStart(tx, zevId);
  const lateEntry = !!start && ev.eventDate < start;
  const bookDate = lateEntry ? start! : ev.eventDate;
  const b = await build(tx, zevId, context(tx, zevId), { ...ev, eventDate: bookDate });
  if (!b.ok) return tx.accountingEvent.update({ where: { id: ev.id }, data: { status: b.status, statusDetail: b.detail, processedAt: new Date() } });
  const lines = netLines(b.lines);
  if (lines.length < 2) {
    // Ništa za knjižiti (npr. raspored nule) — događaj se zatvara bez naloga nije dozvoljen; ostavlja se vidljiv.
    return tx.accountingEvent.update({ where: { id: ev.id }, data: { status: "WAITING_RULE", statusDetail: "Događaj ne daje stavke za knjiženje.", processedAt: new Date() } });
  }

  let postingDate = bookDate;
  let period = await periodFor(tx, zevId, postingDate);
  if (opts.intoOpenPeriod) {
    const next = await tx.fiscalPeriod.findFirst({ where: { zevId, status: "OPEN", year: { status: "OPEN" }, endDate: { gte: bookDate } }, orderBy: { startDate: "asc" }, include: { year: true } });
    if (next) {
      period = next;
      if (next.startDate > postingDate) postingDate = next.startDate;
    }
  }
  if (!period) return tx.accountingEvent.update({ where: { id: ev.id }, data: { status: "WAITING_PERIOD", statusDetail: `Za ${formatDate(postingDate)} ne postoji poslovna godina.`, processedAt: new Date() } });
  if (period.status !== "OPEN" || period.year.status !== "OPEN") {
    return tx.accountingEvent.update({ where: { id: ev.id }, data: { status: "WAITING_PERIOD", statusDetail: `Period ${period.label} je zatvoren.`, processedAt: new Date() } });
  }

  // Storno se veže na original samo ako original još nije storniran (veza je jedinstvena).
  let reversalOfId = b.reversalOfId ?? null;
  if (reversalOfId && (await tx.journalEntry.count({ where: { reversalOfId } })) > 0) reversalOfId = null;
  const entry = await tx.journalEntry.create({
    data: {
      zevId, yearId: period.yearId, periodId: period.id, kind: "AUTO", documentDate: ev.eventDate, postingDate,
      description: lateEntry ? `${b.description} (${LATE_ENTRY_LABEL})` : b.description,
      sourceType: ev.sourceType, sourceId: ev.sourceId, reversalOfId, createdById: userId,
    },
  });
  await tx.journalLine.createMany({
    data: lines.map((l, i) => ({
      entryId: entry.id, zevId, order: i, accountId: l.accountId,
      debit: l.amount.gt(0) ? l.amount.toFixed(2) : "0", credit: l.amount.lt(0) ? l.amount.abs().toFixed(2) : "0",
      partyId: l.partyId ?? null, unitId: l.unitId ?? null, supplierId: l.supplierId ?? null, projectId: l.projectId ?? null,
      purposeId: l.purposeId ?? null, description: l.description ?? null, ruleId: l.ruleId ?? null,
    })),
  });
  await postEntryInTx(tx, zevId, entry.id, userId);
  return tx.accountingEvent.update({ where: { id: ev.id }, data: { status: "POSTED", statusDetail: null, journalEntryId: entry.id, processedAt: new Date() } });
}

/** Oznaka automatskog naloga za dokument sa datumom prije početka knjiženja, unesen poslije početnog stanja. */
export const LATE_ENTRY_LABEL = "kasno unesen dokument, datum prije početka knjiženja";

/** Obrađuje sve neproknjižene događaje redom datuma; ponavlja dok ima napretka (prethodnici u istom prolazu). */
export async function processEvents(zevId: string, userId: string, tx?: Tx) {
  let posted = 0;
  for (let pass = 0; pass < 10; pass++) {
    const events = await (tx ?? prisma).accountingEvent.findMany({ where: { zevId, status: { not: "POSTED" } }, select: { id: true, kind: true, eventDate: true, sourceCreatedAt: true } });
    events.sort((a, b) =>
      a.eventDate.getTime() - b.eventDate.getTime() || a.sourceCreatedAt.getTime() - b.sourceCreatedAt.getTime() || (KIND_ORDER[a.kind] ?? 9) - (KIND_ORDER[b.kind] ?? 9));
    let progress = 0;
    for (const e of events) {
      const r = tx ? await processInSavepoint(tx, zevId, e.id, userId) : await processEvent(zevId, e.id, userId);
      if (r?.status === "POSTED") progress++;
    }
    posted += progress;
    if (progress === 0) break;
  }
  return posted;
}

/** U spoljnoj transakciji (proba): greška jednog događaja se vraća na savepoint, kao zasebna transakcija van probe. */
async function processInSavepoint(tx: Tx, zevId: string, eventId: string, userId: string) {
  await tx.$executeRawUnsafe("SAVEPOINT ledger_event");
  try {
    const r = await processEventInTx(tx, zevId, eventId, userId);
    await tx.$executeRawUnsafe("RELEASE SAVEPOINT ledger_event");
    return r;
  } catch (e) {
    await tx.$executeRawUnsafe("ROLLBACK TO SAVEPOINT ledger_event");
    await markFailed(tx, zevId, eventId, e);
    return null;
  }
}

/**
 * Poziva se poslije poslovne radnje (faktura, uplata, raspored…): izvede nove događaje i proknjiži šta može.
 * Nikad ne ruši radnju koja ga je pozvala — događaj u najgorem slučaju ostaje na čekanju za „Obradi na čekanju”.
 */
export async function afterLedgerChange(zevId: string | null | undefined, userId: string) {
  if (!zevId) return;
  try {
    if ((await syncEvents(zevId)) === 0 && (await prisma.accountingEvent.count({ where: { zevId, status: { not: "POSTED" } } })) === 0) return;
    await processEvents(zevId, userId);
  } catch (e) {
    console.error("[ledger] automatsko knjiženje nije uspjelo", e);
  }
}

// ---------------------------------------------------------------------------
// Ekran „Događaji” (prava provjerava servis)
// ---------------------------------------------------------------------------

const EXPENSES_HREF = "/troskovi?tab=troskovi";

export type EventRow = {
  id: string; kind: AccountingEventKind; status: AccountingEventStatus; statusDetail: string | null; eventDate: Date; amount: string;
  sourceLabel: string; sourceHref: string | null; entryId: string | null; entryNumber: string | null;
};

/** Oznaka i veza izvora događaja (faktura, uplata; raspored vodi na uplatu). */
export async function describeSources(zevId: string, events: { sourceType: string; sourceId: string }[]) {
  const ids = (t: string) => [...new Set(events.filter((e) => e.sourceType === t).map((e) => e.sourceId))];
  const [invoices, payments, allocations, expenses, txs, corrections] = await Promise.all([
    prisma.invoice.findMany({ where: { zevId, id: { in: ids("Invoice") } }, select: { id: true, number: true } }),
    prisma.payment.findMany({ where: { zevId, id: { in: ids("Payment") } }, select: { id: true, date: true, payerNameRaw: true } }),
    prisma.paymentAllocation.findMany({ where: { id: { in: ids("PaymentAllocation") } }, select: { id: true, paymentId: true, invoice: { select: { number: true } } } }),
    prisma.expense.findMany({ where: { zevId, id: { in: ids("Expense") } }, include: { supplier: { select: { name: true } } } }),
    prisma.finTransaction.findMany({ where: { zevId, id: { in: ids("FinTransaction") } }, select: { id: true, date: true, type: true, expenseId: true, counterpartyName: true } }),
    prisma.balanceCorrection.findMany({ where: { zevId, id: { in: ids("BalanceCorrection") } }, select: { id: true, reason: true, party: { select: { kind: true, firstName: true, lastName: true, orgName: true } } } }),
  ]);
  const out = new Map<string, { label: string; href: string | null }>();
  for (const i of invoices) out.set(`Invoice:${i.id}`, { label: `Faktura ${i.number}`, href: `/fakture/${i.id}` });
  for (const p of payments) out.set(`Payment:${p.id}`, { label: `Uplata ${formatDate(p.date)}${p.payerNameRaw ? ` — ${p.payerNameRaw}` : ""}`, href: `/fakture/uplate/${p.id}` });
  for (const a of allocations) out.set(`PaymentAllocation:${a.id}`, { label: `Raspored na fakturu ${a.invoice.number}`, href: `/fakture/uplate/${a.paymentId}` });
  for (const e of expenses) out.set(`Expense:${e.id}`, { label: expenseLabel(e), href: EXPENSES_HREF });
  for (const t of txs) {
    const what = t.expenseId ? "Plaćanje dobavljaču" : t.type === "INCOME" ? "Prihod" : "Rashod";
    out.set(`FinTransaction:${t.id}`, { label: `${what} ${formatDate(t.date)}${t.counterpartyName ? ` — ${t.counterpartyName}` : ""}`, href: t.expenseId ? EXPENSES_HREF : null });
  }
  for (const c of corrections) out.set(`BalanceCorrection:${c.id}`, { label: `Korekcija salda — ${displayNameOf(c.party, "")}`, href: null });
  return out;
}

export async function listEvents(actor: Actor, filter: { status?: string | null } = {}) {
  requireCapability(actor, "ledger.view");
  const zevId = requireZev(actor);
  const start = await ledgerStart(prisma, zevId);
  const grouped = await prisma.accountingEvent.groupBy({ by: ["status"], where: { zevId }, _count: { _all: true } });
  const counts = Object.fromEntries(grouped.map((g) => [g.status, g._count._all])) as Partial<Record<AccountingEventStatus, number>>;
  const status = filter.status === "POSTED" ? "POSTED" : filter.status === "ALL" ? undefined : { not: "POSTED" as const };
  const events = await prisma.accountingEvent.findMany({
    where: { zevId, status }, include: { journalEntry: { select: { id: true, number: true } } },
    orderBy: [{ eventDate: "desc" }, { sourceCreatedAt: "desc" }], take: 300,
  });
  const sources = await describeSources(zevId, events);
  const rows: EventRow[] = events.map((e) => {
    const s = sources.get(`${e.sourceType}:${e.sourceId}`);
    return {
      id: e.id, kind: e.kind, status: e.status, statusDetail: e.statusDetail, eventDate: e.eventDate, amount: e.amount.toFixed(2),
      sourceLabel: s?.label ?? e.sourceType, sourceHref: s?.href ?? null, entryId: e.journalEntry?.id ?? null, entryNumber: e.journalEntry?.number ?? null,
    };
  });
  return { start, counts, rows };
}

/** „Obradi na čekanju”: izvede događaje koji nedostaju i proknjiži šta se može. */
export async function processPending(actor: Actor) {
  requireCapability(actor, "journal.post");
  const zevId = requireZev(actor);
  if (!(await ledgerStart(prisma, zevId))) throw new Error("Knjiženje još nije aktivno — prvo proknjižite početno stanje.");
  const added = await syncEvents(zevId);
  const posted = await processEvents(zevId, actor.userId);
  const waiting = await prisma.accountingEvent.count({ where: { zevId, status: { not: "POSTED" } } });
  await audit(actor, { action: "journal.events_process", targetType: "Zev", targetId: zevId, after: { added, posted, waiting } });
  return { added, posted, waiting };
}

/** B2-Q6 (b): događaj iz zatvorenog perioda se izričito knjiži u prvi otvoren period (datum dokumenta ostaje). */
export async function postEventIntoOpenPeriod(actor: Actor, eventId: string) {
  requireCapability(actor, "journal.post");
  const zevId = requireZev(actor);
  const before = await prisma.accountingEvent.findUniqueOrThrow({ where: { id: eventId, zevId } });
  if (before.status !== "WAITING_PERIOD") throw new Error("Događaj ne čeka otvoren period.");
  const r = await processEvent(zevId, eventId, actor.userId, { intoOpenPeriod: true });
  if (r?.status !== "POSTED") throw new Error(r?.statusDetail ?? "Događaj nije proknjižen.");
  await audit(actor, { action: "journal.event_into_period", targetType: "AccountingEvent", targetId: eventId, after: { journalEntryId: r.journalEntryId } });
  return r;
}

/** Veza na dokument iz kojeg je nastao automatski nalog (raspored vodi na svoju uplatu). */
export async function autoEntrySource(actor: Actor, type: string | null, id: string | null): Promise<{ type: string; href: string } | null> {
  requireCapability(actor, "ledger.view");
  const zevId = requireZev(actor);
  if (!type || !id) return null;
  if (type === "Invoice") return { type, href: `/fakture/${id}` };
  if (type === "Payment") return { type, href: `/fakture/uplate/${id}` };
  if (type === "PaymentAllocation") {
    const a = await prisma.paymentAllocation.findFirst({ where: { id, payment: { zevId } }, select: { paymentId: true } });
    return a ? { type, href: `/fakture/uplate/${a.paymentId}` } : null;
  }
  if (type === "Expense") return { type, href: EXPENSES_HREF };
  if (type === "FinTransaction") {
    const t = await prisma.finTransaction.findFirst({ where: { id, zevId }, select: { expenseId: true } });
    return t?.expenseId ? { type, href: EXPENSES_HREF } : null;
  }
  return null;
}

export type PostingNote = { kind: AccountingEventKind; status: AccountingEventStatus; detail: string | null; entryId: string | null; entryNumber: string | null };

/**
 * Stanje knjiženja dokumenata za oznaku na fakturi, uplati i trošku (§5) — samo za uloge sa pregledom knjige i
 * samo kad je knjiženje aktivno (inače null). Ključ mape je id dokumenta; događaji redom nastanka.
 */
export async function postingNotes(actor: Actor, sourceType: "Invoice" | "Payment" | "PaymentAllocation" | "Expense", ids: string[]): Promise<Map<string, PostingNote[]> | null> {
  if (!hasCapability(actor.roles, "ledger.view") || !actor.zevId || ids.length === 0) return null;
  if (!(await ledgerStart(prisma, actor.zevId))) return null;
  // Trošak nosi i događaje svojih plaćanja (promet sa vezom na trošak).
  const owner = new Map(ids.map((id) => [id, id]));
  const sources: Prisma.AccountingEventWhereInput[] = [{ sourceType, sourceId: { in: ids } }];
  if (sourceType === "Expense") {
    const txs = await prisma.finTransaction.findMany({ where: { zevId: actor.zevId, expenseId: { in: ids } }, select: { id: true, expenseId: true } });
    for (const t of txs) owner.set(t.id, t.expenseId!);
    if (txs.length > 0) sources.push({ sourceType: "FinTransaction", sourceId: { in: txs.map((t) => t.id) } });
  }
  const events = await prisma.accountingEvent.findMany({
    where: { zevId: actor.zevId, OR: sources },
    include: { journalEntry: { select: { id: true, number: true } } },
    orderBy: [{ eventDate: "asc" }, { sourceCreatedAt: "asc" }],
  });
  const out = new Map<string, PostingNote[]>();
  for (const e of events) {
    const key = owner.get(e.sourceId) ?? e.sourceId;
    const list = out.get(key) ?? [];
    list.push({ kind: e.kind, status: e.status, detail: e.statusDetail, entryId: e.journalEntry?.id ?? null, entryNumber: e.journalEntry?.number ?? null });
    out.set(key, list);
  }
  return out;
}

/** Broj naloga kojim je događaj izvora proknjižen (null = nije proknjižen ili ne postoji). */
export async function postedEntryNumber(db: Db, zevId: string, sourceType: string, sourceId: string, kind: AccountingEventKind): Promise<string | null> {
  const ev = await db.accountingEvent.findUnique({
    where: { zevId_sourceType_sourceId_kind: { zevId, sourceType, sourceId, kind } }, include: { journalEntry: { select: { number: true } } },
  });
  return ev?.status === "POSTED" ? ev.journalEntry?.number ?? "" : null;
}

/** B2-Q9 (b): kad je knjiženje aktivno, ručni prihod/rashod i trošak od datuma početka moraju imati kategoriju. */
export async function categoryRequired(db: Db, zevId: string, date: Date): Promise<boolean> {
  const start = await ledgerStart(db, zevId);
  return !!start && dayOf(date) >= start;
}

/** Neproknjiženi događaj se izvodi ponovo (npr. poslije izmjene troška prije knjiženja). */
export async function dropUnpostedEvents(db: Db, zevId: string, sourceType: string, sourceId: string) {
  await db.accountingEvent.deleteMany({ where: { zevId, sourceType, sourceId, status: { not: "POSTED" } } });
}
