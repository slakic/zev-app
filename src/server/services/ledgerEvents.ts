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
import { Prisma, type AccountingEventKind, type AccountingEventStatus, type ControlRole } from "@/generated/prisma/client";
import { dec, sumDecimals, ZERO } from "@/lib/money";
import { formatDate, toZonedDateIso } from "@/lib/i18n";
import { postEntryInTx } from "@/server/services/journal";
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
};

export const OWNER_EVENT_KINDS: AccountingEventKind[] = [
  "CHARGE_ISSUED", "CHARGE_CANCELLED", "PAYMENT_RECEIVED", "PAYMENT_IDENTIFIED", "PAYMENT_ALLOCATED", "ALLOCATION_REVERSED", "PAYMENT_REVERSED",
];

// ---------------------------------------------------------------------------
// Aktivnost knjiženja
// ---------------------------------------------------------------------------

/** Datum početka knjiženja: datum proknjiženog, nestorniranog početnog stanja; null = knjiženje nije aktivno. */
export async function ledgerStart(db: Db, zevId: string): Promise<Date | null> {
  const e = await db.journalEntry.findFirst({ where: { zevId, kind: "OPENING", status: "POSTED", reversedBy: null }, select: { postingDate: true } });
  return e?.postingDate ?? null;
}

// ---------------------------------------------------------------------------
// Izvođenje događaja iz evidencije
// ---------------------------------------------------------------------------

type NewEvent = { kind: AccountingEventKind; sourceType: string; sourceId: string; eventDate: Date; sourceCreatedAt: Date; amount: string };

/**
 * Upisuje događaje koji nedostaju za sve zapise evidencije od datuma početka. Idempotentno (skipDuplicates na
 * jedinstvenom ključu izvora). Vraća broj novih događaja.
 */
export async function syncEvents(zevId: string): Promise<number> {
  const start = await ledgerStart(prisma, zevId);
  if (!start) return 0;
  // Granica upita sa danom rezerve (zona); tačan dan se provjerava ispod.
  const from = new Date(start.getTime() - 36 * 3600 * 1000);
  const onOrAfter = (d: Date) => dayOf(d) >= start;
  const out: NewEvent[] = [];

  const invoices = await prisma.invoice.findMany({
    where: {
      zevId, status: { in: ["ISSUED", "PAID", "CANCELLED", "CORRECTED"] },
      OR: [{ issueDate: { gte: from } }, { cancelledAt: { gte: from } }, { status: "CORRECTED" }],
    },
    include: { batch: { select: { status: true } }, correctedBy: { select: { issueDate: true, createdAt: true } } },
  });
  for (const inv of invoices) {
    // Faktura iz serije koja nije izdata nikad nije bila zaduženje (storniran nacrt).
    const wasIssued = !inv.batch || inv.batch.status === "ISSUED";
    if (!wasIssued) continue;
    if (onOrAfter(inv.issueDate)) {
      out.push({ kind: "CHARGE_ISSUED", sourceType: "Invoice", sourceId: inv.id, eventDate: dayOf(inv.issueDate), sourceCreatedAt: inv.createdAt, amount: inv.total.toFixed(2) });
    }
    const cancelAt = inv.status === "CANCELLED" ? inv.cancelledAt : inv.status === "CORRECTED" ? inv.correctedBy?.issueDate ?? null : null;
    if (cancelAt && onOrAfter(cancelAt)) {
      out.push({ kind: "CHARGE_CANCELLED", sourceType: "Invoice", sourceId: inv.id, eventDate: dayOf(cancelAt), sourceCreatedAt: inv.status === "CORRECTED" ? inv.correctedBy!.createdAt : cancelAt, amount: inv.total.toFixed(2) });
    }
  }

  const payments = await prisma.payment.findMany({ where: { zevId, OR: [{ date: { gte: from } }, { reversedAt: { gte: from } }] } });
  for (const p of payments) {
    if (onOrAfter(p.date)) out.push({ kind: "PAYMENT_RECEIVED", sourceType: "Payment", sourceId: p.id, eventDate: dayOf(p.date), sourceCreatedAt: p.createdAt, amount: p.amount.toFixed(2) });
    if (p.reversedAt && onOrAfter(p.reversedAt)) out.push({ kind: "PAYMENT_REVERSED", sourceType: "Payment", sourceId: p.id, eventDate: dayOf(p.reversedAt), sourceCreatedAt: p.reversedAt, amount: p.amount.toFixed(2) });
  }

  const allocations = await prisma.paymentAllocation.findMany({ where: { payment: { zevId }, createdAt: { gte: from } }, include: { payment: { select: { payerId: true } } } });
  for (const a of allocations) {
    if (!onOrAfter(a.createdAt)) continue;
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

  if (out.length === 0) return 0;
  const res = await prisma.accountingEvent.createMany({ data: out.map((e) => ({ ...e, zevId })), skipDuplicates: true });
  return res.count;
}

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
      if (!c) throw new Waiting("WAITING_RULE", `Nedostaje kontrolno konto (${ROLE_LABEL[role]}) važeće na ${formatDate(at)}.`);
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
    if (!rule) throw new Waiting("WAITING_RULE", `Vrsta zaduženja „${ct.name}” nema potvrđeno pravilo knjiženja na ${formatDate(at)}.`);
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

/** Linije koje je original dao: proknjižen događaj → njegov nalog; nema događaja (prije početka) → šema; inače čeka. */
async function originalLines(db: Db, zevId: string, sourceType: string, sourceId: string, kind: AccountingEventKind, fresh: () => Promise<Signed[]>) {
  const ev = await db.accountingEvent.findUnique({ where: { zevId_sourceType_sourceId_kind: { zevId, sourceType, sourceId, kind } } });
  if (!ev) return { lines: await fresh(), entryId: null as string | null };
  if (ev.status !== "POSTED" || !ev.journalEntryId) throw new Waiting("WAITING_PREDECESSOR", `Čeka da se proknjiži originalni događaj (${ev.kind === "CHARGE_ISSUED" ? "zaduženje" : ev.kind === "PAYMENT_RECEIVED" ? "priliv uplate" : "raspored"}).`);
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
    return await prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "AccountingEvent" WHERE id = ${eventId} AND "zevId" = ${zevId} FOR UPDATE`;
      const ev = await tx.accountingEvent.findUniqueOrThrow({ where: { id: eventId, zevId } });
      if (ev.status === "POSTED") return ev;
      const b = await build(tx, zevId, context(tx, zevId), ev);
      if (!b.ok) return tx.accountingEvent.update({ where: { id: ev.id }, data: { status: b.status, statusDetail: b.detail, processedAt: new Date() } });
      const lines = netLines(b.lines);
      if (lines.length < 2) {
        // Ništa za knjižiti (npr. raspored nule) — događaj se zatvara bez naloga nije dozvoljen; ostavlja se vidljiv.
        return tx.accountingEvent.update({ where: { id: ev.id }, data: { status: "WAITING_RULE", statusDetail: "Događaj ne daje stavke za knjiženje.", processedAt: new Date() } });
      }

      let postingDate = ev.eventDate;
      let period = await periodFor(tx, zevId, postingDate);
      if (opts.intoOpenPeriod) {
        const next = await tx.fiscalPeriod.findFirst({ where: { zevId, status: "OPEN", year: { status: "OPEN" }, endDate: { gte: ev.eventDate } }, orderBy: { startDate: "asc" }, include: { year: true } });
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
          description: b.description, sourceType: ev.sourceType, sourceId: ev.sourceId, reversalOfId, createdById: userId,
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
    });
  } catch (e) {
    // Kontrole knjiženja (dimenzija, konto…) — događaj čeka sa porukom; poslovna radnja je već prošla.
    const detail = e instanceof Error ? e.message : "Greška pri knjiženju.";
    await prisma.accountingEvent.updateMany({ where: { id: eventId, zevId, status: { not: "POSTED" } }, data: { status: "WAITING_RULE", statusDetail: detail.slice(0, 500), processedAt: new Date() } });
    return null;
  }
}

/** Obrađuje sve neproknjižene događaje redom datuma; ponavlja dok ima napretka (prethodnici u istom prolazu). */
export async function processEvents(zevId: string, userId: string) {
  let posted = 0;
  for (let pass = 0; pass < 10; pass++) {
    const events = await prisma.accountingEvent.findMany({ where: { zevId, status: { not: "POSTED" } }, select: { id: true, kind: true, eventDate: true, sourceCreatedAt: true } });
    events.sort((a, b) =>
      a.eventDate.getTime() - b.eventDate.getTime() || a.sourceCreatedAt.getTime() - b.sourceCreatedAt.getTime() || (KIND_ORDER[a.kind] ?? 9) - (KIND_ORDER[b.kind] ?? 9));
    let progress = 0;
    for (const e of events) {
      const r = await processEvent(zevId, e.id, userId);
      if (r?.status === "POSTED") progress++;
    }
    posted += progress;
    if (progress === 0) break;
  }
  return posted;
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

export type EventRow = {
  id: string; kind: AccountingEventKind; status: AccountingEventStatus; statusDetail: string | null; eventDate: Date; amount: string;
  sourceLabel: string; sourceHref: string | null; entryId: string | null; entryNumber: string | null;
};

/** Oznaka i veza izvora događaja (faktura, uplata; raspored vodi na uplatu). */
async function describeSources(zevId: string, events: { sourceType: string; sourceId: string }[]) {
  const ids = (t: string) => [...new Set(events.filter((e) => e.sourceType === t).map((e) => e.sourceId))];
  const [invoices, payments, allocations] = await Promise.all([
    prisma.invoice.findMany({ where: { zevId, id: { in: ids("Invoice") } }, select: { id: true, number: true } }),
    prisma.payment.findMany({ where: { zevId, id: { in: ids("Payment") } }, select: { id: true, date: true, payerNameRaw: true } }),
    prisma.paymentAllocation.findMany({ where: { id: { in: ids("PaymentAllocation") } }, select: { id: true, paymentId: true, invoice: { select: { number: true } } } }),
  ]);
  const out = new Map<string, { label: string; href: string | null }>();
  for (const i of invoices) out.set(`Invoice:${i.id}`, { label: `Faktura ${i.number}`, href: `/fakture/${i.id}` });
  for (const p of payments) out.set(`Payment:${p.id}`, { label: `Uplata ${formatDate(p.date)}${p.payerNameRaw ? ` — ${p.payerNameRaw}` : ""}`, href: `/fakture/uplate/${p.id}` });
  for (const a of allocations) out.set(`PaymentAllocation:${a.id}`, { label: `Raspored na fakturu ${a.invoice.number}`, href: `/fakture/uplate/${a.paymentId}` });
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
  return null;
}
