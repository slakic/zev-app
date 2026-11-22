// Faza B3b — usklađivanje i pregledi (Plans/kontni-plan-b3-izvjestaji-plan.md §4).
//
// Knjiga (samo proknjiženo, do dana knjiženja) se poredi sa operativnom evidencijom na isti dan
// (`operationalSnapshot`). Razlika koju objašnjavaju događaji koji još nisu proknjiženi (ili su proknjiženi u
// kasniji period) prikazuje se odvojeno od neobjašnjenog ostatka (B3-Q5). Otvorene stavke idu iz evidencije uz
// kontrolni zbir prema knjizi (B3-Q3).
import { prisma } from "@/lib/prisma";
import { requireCapability, requireZev, type Actor } from "@/server/auth/guards";
import type { AccountingEventKind, ControlRole } from "@/generated/prisma/client";
import { dec, sumDecimals, ZERO, type Decimal } from "@/lib/money";
import { toZonedDateIso } from "@/lib/i18n";
import { audit } from "@/server/audit";
import { toCsv } from "@/server/services/reports";
import { operationalSnapshot, ROLE_LABEL, type OpeningItem } from "@/server/services/openingBalance";
import { ledgerStart, postedEntryNumber } from "@/server/services/ledgerEvents";
import { partyDisplayName } from "@/server/services/ownership";
import { purposeOverview, type PurposeRow } from "@/server/services/ledgerReports";

const dateOnly = (s: string) => new Date(`${s}T00:00:00Z`);
const isIso = (s: string | null | undefined): s is string => !!s && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(dateOnly(s).getTime());
const iso = (d: Date) => d.toISOString().slice(0, 10);
const money = (d: Decimal) => d.toFixed(2);

/** Dan izvještaja: zadati ako je ispravan, inače današnji. */
export const asOfDay = (s: string | null | undefined) => (isIso(s) ? s : toZonedDateIso(new Date()));

const LIABILITY: ControlRole[] = ["OWNER_ADVANCE", "UNIDENTIFIED_RECEIPTS", "SUPPLIER_PAYABLE"];
const DIMENSION_OF: Partial<Record<ControlRole, "partyId" | "supplierId">> = {
  OWNER_RECEIVABLE: "partyId", OWNER_ADVANCE: "partyId", SUPPLIER_PAYABLE: "supplierId",
};
const ROLE_ORDER: ControlRole[] = ["MONEY_ACCOUNT", "OWNER_RECEIVABLE", "OWNER_ADVANCE", "UNIDENTIFIED_RECEIPTS", "SUPPLIER_PAYABLE"];
const groupKey = (role: ControlRole, moneyAccountId: string | null) => `${role}:${role === "MONEY_ACCOUNT" ? moneyAccountId ?? "-" : "-"}`;
/** Saldo u prirodnoj strani uloge: imovina D−P, obaveze P−D. */
const signed = (role: ControlRole, debit: Decimal, credit: Decimal) => (LIABILITY.includes(role) ? credit.minus(debit) : debit.minus(credit));
const itemValue = (it: OpeningItem) => (it.side === "D" ? signed(it.role, it.amount, ZERO) : signed(it.role, ZERO, it.amount));

/** Mapa konto → (uloga, račun novca) iz svih redova kontrolnih konta, pa i ranije važećih (stavke ostaju na starom kontu). */
async function controlMap(zevId: string) {
  const rows = await prisma.zevControlAccount.findMany({ where: { zevId }, select: { accountId: true, role: true, moneyAccountId: true } });
  return new Map(rows.map((r) => [r.accountId, { role: r.role, moneyAccountId: r.moneyAccountId }]));
}

/** Saldo kontrolnih konta u knjizi do dana (samo proknjiženo), po stavci — za usklađivanje i preglede. */
async function controlLines(zevId: string, asOfIso: string, accountIds: string[]) {
  return prisma.journalLine.findMany({
    where: { zevId, accountId: { in: accountIds }, entry: { status: "POSTED", postingDate: { lte: dateOnly(asOfIso) } } },
    select: {
      accountId: true, debit: true, credit: true, partyId: true, supplierId: true, openingSourceType: true, openingSourceId: true,
      entry: { select: { sourceType: true, sourceId: true } },
    },
  });
}

// ---------------------------------------------------------------------------
// Uticaj događaja koji nije u knjizi na dan (B3-Q5)
// ---------------------------------------------------------------------------

/** Uticaj na ulogu; za avans i neidentifikovane i na vlasnika odnosno uplatu (pregled §4.2). */
type Effect = { key: string; value: Decimal; party?: string | null; payment?: string | null };

/**
 * Za šta bi događaj promijenio saldo kontrolnih konta da je proknjižen (u prirodnoj strani uloge). Isto pravilo kao
 * šeme knjiženja B2 (ledgerEvents.ts), ali samo na nivou uloge — iznos po namjeni se ovdje ne dijeli.
 */
function eventEffects(
  kind: AccountingEventKind, amount: Decimal,
  src: { moneyAccountId?: string | null; payerId?: string | null; txType?: string; expenseId?: string | null; advanceParty?: string | null; paymentId?: string | null },
): Effect[] {
  const cash = (v: Decimal) => ({ key: groupKey("MONEY_ACCOUNT", src.moneyAccountId ?? null), value: v });
  const role = (r: ControlRole, v: Decimal): Effect => ({
    key: groupKey(r, null), value: v,
    party: r === "OWNER_ADVANCE" ? src.advanceParty ?? null : undefined,
    payment: r === "UNIDENTIFIED_RECEIPTS" ? src.paymentId ?? null : undefined,
  });
  const free = src.payerId ? "OWNER_ADVANCE" : "UNIDENTIFIED_RECEIPTS";
  switch (kind) {
    case "CHARGE_ISSUED": return [role("OWNER_RECEIVABLE", amount)];
    case "CHARGE_CANCELLED": return [role("OWNER_RECEIVABLE", amount.neg())];
    case "BALANCE_CORRECTION": return [role("OWNER_RECEIVABLE", amount)];
    case "PAYMENT_RECEIVED": return [cash(amount), role(free, amount)];
    case "PAYMENT_REVERSED": return [cash(amount.neg()), role(free, amount.neg())];
    case "PAYMENT_IDENTIFIED": return [role("UNIDENTIFIED_RECEIPTS", amount.neg()), role("OWNER_ADVANCE", amount)];
    case "PAYMENT_ALLOCATED": return [role("OWNER_ADVANCE", amount.neg()), role("OWNER_RECEIVABLE", amount.neg())];
    case "ALLOCATION_REVERSED": return [role("OWNER_ADVANCE", amount), role("OWNER_RECEIVABLE", amount)];
    case "SUPPLIER_INVOICE": return [role("SUPPLIER_PAYABLE", amount)];
    case "SUPPLIER_INVOICE_CANCELLED": return [role("SUPPLIER_PAYABLE", amount.neg())];
    case "SUPPLIER_PAYMENT": return [role("SUPPLIER_PAYABLE", amount.neg()), cash(amount.neg())];
    case "CASH_INCOME": return [cash(amount)];
    case "CASH_EXPENSE": return [cash(amount.neg())];
    case "TRANSACTION_CANCELLED":
      if (src.txType === "INCOME") return [cash(amount.neg())];
      return src.expenseId ? [role("SUPPLIER_PAYABLE", amount), cash(amount)] : [cash(amount)];
    default: return [];
  }
}

/** Događaji sa datumom do dana koji u knjizi na taj dan nisu: čekaju, ili su proknjiženi u kasniji period. */
async function pendingEffects(zevId: string, asOfIso: string) {
  const day = dateOnly(asOfIso);
  const events = await prisma.accountingEvent.findMany({
    where: {
      zevId, eventDate: { lte: day },
      OR: [{ status: { not: "POSTED" } }, { journalEntry: { postingDate: { gt: day } } }],
    },
    select: { kind: true, sourceType: true, sourceId: true, amount: true },
  });
  const ids = (t: string) => events.filter((e) => e.sourceType === t).map((e) => e.sourceId);
  const allocIds = ids("PaymentAllocation");
  const [payments, txs, allocations] = await Promise.all([
    prisma.payment.findMany({ where: { zevId, id: { in: ids("Payment") } }, select: { id: true, accountId: true, payerId: true } }),
    prisma.finTransaction.findMany({ where: { zevId, id: { in: ids("FinTransaction") } }, select: { id: true, accountId: true, type: true, expenseId: true } }),
    prisma.paymentAllocation.findMany({
      where: { id: { in: allocIds }, payment: { zevId } },
      select: { id: true, paymentId: true, payment: { select: { payerId: true } }, invoice: { select: { debtorId: true } } },
    }),
  ]);
  const pay = new Map(payments.map((p) => [p.id, p]));
  const tx = new Map(txs.map((t) => [t.id, t]));
  const alloc = new Map(allocations.map((a) => [a.id, a]));
  type Sum = { value: Decimal; count: number };
  const add = (m: Map<string, Sum>, k: string, v: Decimal) => { const s = m.get(k) ?? { value: ZERO, count: 0 }; m.set(k, { value: s.value.plus(v), count: s.count + 1 }); };
  const byKey = new Map<string, Sum>();
  const byParty = new Map<string, Sum>();
  const byPayment = new Map<string, Sum>();
  for (const e of events) {
    const p = pay.get(e.sourceId);
    const a = alloc.get(e.sourceId);
    const src =
      e.sourceType === "Payment" ? { moneyAccountId: p?.accountId, payerId: p?.payerId, advanceParty: p?.payerId, paymentId: e.sourceId }
        : e.sourceType === "FinTransaction" ? { moneyAccountId: tx.get(e.sourceId)?.accountId, txType: tx.get(e.sourceId)?.type, expenseId: tx.get(e.sourceId)?.expenseId }
          // Raspored uplate bez platioca ide na avans dužnika fakture (B2-Q4).
          : e.sourceType === "PaymentAllocation" ? { payerId: a?.payment.payerId, advanceParty: a?.payment.payerId ?? a?.invoice.debtorId, paymentId: a?.paymentId }
            : {};
    for (const f of eventEffects(e.kind, dec(e.amount.toString()), src)) {
      add(byKey, f.key, f.value);
      if (f.party) add(byParty, f.party, f.value);
      if (f.payment) add(byPayment, f.payment, f.value);
    }
  }
  return { byKey, byParty, byPayment };
}

// ---------------------------------------------------------------------------
// Usklađivanje na dan (§4.1)
// ---------------------------------------------------------------------------

export type ReconRow = {
  key: string; role: ControlRole; roleLabel: string; moneyAccount: string | null; accounts: string[];
  ledger: string; analytics: string; operational: string; difference: string; waiting: string; waitingCount: number; unexplained: string; ok: boolean;
};

/**
 * Po ulozi kontrolnog konta (račun novca posebno po računu): glavna knjiga, analitika (stavke sa dimenzijom uloge),
 * evidencija na dan, razlika (evidencija − knjiga), dio razlike koji čeka knjiženje i neobjašnjen ostatak.
 */
export async function reconcileAt(actor: Actor, asOfIso: string) {
  requireCapability(actor, "ledger.view");
  const zevId = requireZev(actor);
  const start = await ledgerStart(prisma, zevId);
  if (!start || asOfIso < iso(start)) return { asOfIso, start: start ? iso(start) : null, active: false, rows: [] as ReconRow[], ok: true };

  const controls = await controlMap(zevId);
  const [lines, items, pending, moneyAccounts, accounts] = await Promise.all([
    controlLines(zevId, asOfIso, [...controls.keys()]),
    operationalSnapshot(prisma, zevId, asOfIso),
    pendingEffects(zevId, asOfIso),
    prisma.moneyAccount.findMany({ where: { zevId }, select: { id: true, name: true } }),
    prisma.zevAccount.findMany({ where: { zevId, id: { in: [...controls.keys()] } }, select: { id: true, code: true } }),
  ]);
  type G = { role: ControlRole; moneyAccountId: string | null; accounts: Set<string>; ledger: Decimal; analytics: Decimal; operational: Decimal };
  const groups = new Map<string, G>();
  const get = (role: ControlRole, moneyAccountId: string | null) => {
    const k = groupKey(role, moneyAccountId);
    let g = groups.get(k);
    if (!g) groups.set(k, (g = { role, moneyAccountId: role === "MONEY_ACCOUNT" ? moneyAccountId : null, accounts: new Set(), ledger: ZERO, analytics: ZERO, operational: ZERO }));
    return g;
  };
  const code = new Map(accounts.map((a) => [a.id, a.code]));
  for (const l of lines) {
    const c = controls.get(l.accountId)!;
    const g = get(c.role, c.moneyAccountId);
    g.accounts.add(code.get(l.accountId) ?? "?");
    const v = signed(c.role, dec(l.debit.toString()), dec(l.credit.toString()));
    g.ledger = g.ledger.plus(v);
    const dim = DIMENSION_OF[c.role];
    if (!dim || l[dim]) g.analytics = g.analytics.plus(v);
  }
  for (const it of items) {
    const g = get(it.role, it.moneyAccountId);
    g.operational = g.operational.plus(itemValue(it));
  }
  for (const [accountId, c] of controls) get(c.role, c.moneyAccountId).accounts.add(code.get(accountId) ?? "?");
  for (const k of pending.byKey.keys()) {
    const [role, ma] = k.split(":") as [ControlRole, string];
    get(role, ma === "-" ? null : ma);
  }
  const maName = new Map(moneyAccounts.map((m) => [m.id, m.name]));
  const rows: ReconRow[] = [...groups.entries()]
    .map(([key, g]) => {
      const p = pending.byKey.get(key) ?? { value: ZERO, count: 0 };
      const difference = g.operational.minus(g.ledger);
      const unexplained = difference.minus(p.value);
      return {
        key, role: g.role, roleLabel: ROLE_LABEL[g.role], moneyAccount: g.moneyAccountId ? maName.get(g.moneyAccountId) ?? "?" : null,
        accounts: [...g.accounts].sort(),
        ledger: money(g.ledger), analytics: money(g.analytics), operational: money(g.operational),
        difference: money(difference), waiting: money(p.value), waitingCount: p.count, unexplained: money(unexplained),
        ok: unexplained.isZero() && g.ledger.eq(g.analytics),
      };
    })
    .filter((r) => !(r.ledger === "0.00" && r.operational === "0.00" && r.waitingCount === 0))
    .sort((a, b) => ROLE_ORDER.indexOf(a.role) - ROLE_ORDER.indexOf(b.role) || (a.moneyAccount ?? "").localeCompare(b.moneyAccount ?? "", "sr-Latn"));
  return { asOfIso, start: iso(start), active: true, rows, ok: rows.every((r) => r.ok) };
}

// ---------------------------------------------------------------------------
// Avansi i neidentifikovane uplate (§4.2)
// ---------------------------------------------------------------------------

export type AdvanceRow = { partyId: string; name: string; ledger: string; operational: string; waiting: string; unexplained: string; ok: boolean };
export type UnidentifiedRow = { paymentId: string | null; date: string | null; payer: string; ledger: string; operational: string; waiting: string; unexplained: string; ok: boolean };

/** Avans po vlasniku i neidentifikovane uplate po uplati: knjiga (kontrolna konta) i evidencija na dan, red po red. */
export async function advancesAt(actor: Actor, asOfIso: string) {
  requireCapability(actor, "ledger.view");
  const zevId = requireZev(actor);
  const controls = await controlMap(zevId);
  const ids = (r: ControlRole) => [...controls.entries()].filter(([, c]) => c.role === r).map(([id]) => id);
  const [advLines, unidLines, items, pending] = await Promise.all([
    controlLines(zevId, asOfIso, ids("OWNER_ADVANCE")),
    controlLines(zevId, asOfIso, ids("UNIDENTIFIED_RECEIPTS")),
    operationalSnapshot(prisma, zevId, asOfIso),
    pendingEffects(zevId, asOfIso),
  ]);
  const net = (l: { debit: unknown; credit: unknown }) => dec(String(l.credit)).minus(dec(String(l.debit)));

  // Avansi po licu.
  const adv = new Map<string, { ledger: Decimal; operational: Decimal }>();
  const advGet = (id: string) => { let a = adv.get(id); if (!a) adv.set(id, (a = { ledger: ZERO, operational: ZERO })); return a; };
  for (const l of advLines) advGet(l.partyId ?? "").ledger = advGet(l.partyId ?? "").ledger.plus(net(l));
  for (const it of items.filter((i) => i.role === "OWNER_ADVANCE")) advGet(it.partyId ?? "").operational = advGet(it.partyId ?? "").operational.plus(itemValue(it));
  for (const k of pending.byParty.keys()) advGet(k);

  // Neidentifikovane po uplati: izvor stavke je uplata (AUTO), raspored uplate (identifikacija) ili stavka početnog stanja.
  const allocIds = unidLines.filter((l) => l.entry.sourceType === "PaymentAllocation").map((l) => l.entry.sourceId!);
  const allocs = await prisma.paymentAllocation.findMany({ where: { id: { in: allocIds }, payment: { zevId } }, select: { id: true, paymentId: true } });
  const allocPayment = new Map(allocs.map((a) => [a.id, a.paymentId]));
  const paymentOf = (l: (typeof unidLines)[number]) =>
    l.openingSourceType === "UNIDENTIFIED" ? l.openingSourceId
      : l.entry.sourceType === "Payment" ? l.entry.sourceId
        : l.entry.sourceType === "PaymentAllocation" ? allocPayment.get(l.entry.sourceId ?? "") ?? null
          : null;
  const unid = new Map<string, { ledger: Decimal; operational: Decimal }>();
  const unidGet = (id: string) => { let a = unid.get(id); if (!a) unid.set(id, (a = { ledger: ZERO, operational: ZERO })); return a; };
  for (const l of unidLines) { const k = paymentOf(l) ?? ""; unidGet(k).ledger = unidGet(k).ledger.plus(net(l)); }
  for (const it of items.filter((i) => i.role === "UNIDENTIFIED_RECEIPTS")) unidGet(it.sourceId).operational = unidGet(it.sourceId).operational.plus(itemValue(it));
  for (const k of pending.byPayment.keys()) unidGet(k);

  const [parties, payments] = await Promise.all([
    prisma.party.findMany({ where: { zevId, id: { in: [...adv.keys()] } }, select: { id: true, kind: true, firstName: true, lastName: true, orgName: true } }),
    prisma.payment.findMany({ where: { zevId, id: { in: [...unid.keys()] } }, select: { id: true, date: true, payerNameRaw: true } }),
  ]);
  const partyName = new Map(parties.map((p) => [p.id, partyDisplayName(p)]));
  const pay = new Map(payments.map((p) => [p.id, p]));
  const nonZero = (a: { ledger: Decimal; operational: Decimal }) => !(a.ledger.isZero() && a.operational.isZero());
  /** Razlika (evidencija − knjiga) umanjena za ono što čeka knjiženje. */
  const explain = (a: { ledger: Decimal; operational: Decimal }, waiting: Decimal) => {
    const unexplained = a.operational.minus(a.ledger).minus(waiting);
    return { ledger: money(a.ledger), operational: money(a.operational), waiting: money(waiting), unexplained: money(unexplained), ok: unexplained.isZero() };
  };

  const advances: AdvanceRow[] = [...adv.entries()].filter(([, a]) => nonZero(a)).map(([partyId, a]) => ({
    partyId, name: partyName.get(partyId) ?? "—", ...explain(a, pending.byParty.get(partyId)?.value ?? ZERO),
  })).sort((a, b) => a.name.localeCompare(b.name, "sr-Latn"));
  const unidentified: UnidentifiedRow[] = [...unid.entries()].filter(([, a]) => nonZero(a)).map(([id, a]) => {
    const p = pay.get(id);
    return { paymentId: p ? id : null, date: p ? iso(p.date) : null, payer: p?.payerNameRaw ?? "", ...explain(a, pending.byPayment.get(id)?.value ?? ZERO) };
  }).sort((a, b) => (a.date ?? "").localeCompare(b.date ?? ""));
  const total = (rows: { ledger: string; operational: string }[]) => ({
    ledger: money(sumDecimals(rows.map((r) => dec(r.ledger)))), operational: money(sumDecimals(rows.map((r) => dec(r.operational)))),
  });
  return { asOfIso, advances, advancesTotal: total(advances), unidentified, unidentifiedTotal: total(unidentified) };
}

// ---------------------------------------------------------------------------
// Otvorene stavke po dospijeću (§4.3, B3-Q3 (a))
// ---------------------------------------------------------------------------

export const AGE_BUCKETS = ["notDue", "d30", "d60", "d90", "over90"] as const;
export type AgeBucket = (typeof AGE_BUCKETS)[number];
const bucketOf = (asOfIso: string, due: Date | null): AgeBucket => {
  if (!due) return "notDue";
  const days = Math.floor((dateOnly(asOfIso).getTime() - dateOnly(iso(due)).getTime()) / 86_400_000);
  return days <= 0 ? "notDue" : days <= 30 ? "d30" : days <= 60 ? "d60" : days <= 90 ? "d90" : "over90";
};

export type OpenItem = { id: string; number: string; dueDate: string | null; days: number; bucket: AgeBucket; amount: string; entryId: string | null; entryNumber: string | null };
export type OpenGroup = { id: string; name: string; buckets: Record<AgeBucket, string>; total: string; items: OpenItem[] };

/**
 * Neplaćene fakture vlasnika i računi dobavljača na dan, po starosti dospijeća, grupisani po dužniku odnosno
 * dobavljaču. Kontrolni zbir: ukupno iz evidencije prema saldu kontrolnog konta u knjizi (potraživanja bez korekcija
 * salda, jer korekcija nema dospijeće).
 */
export async function openItemsAt(actor: Actor, asOfIso: string) {
  requireCapability(actor, "ledger.view");
  const zevId = requireZev(actor);
  const items = await operationalSnapshot(prisma, zevId, asOfIso);
  const invoiceOpen = new Map<string, Decimal>();
  for (const it of items) {
    if (it.sourceType !== "INVOICE") continue;
    const id = it.sourceId.split(":")[0];
    invoiceOpen.set(id, (invoiceOpen.get(id) ?? ZERO).plus(itemValue(it)));
  }
  const expenseOpen = new Map(items.filter((i) => i.sourceType === "SUPPLIER").map((i) => [i.sourceId, i.amount]));
  const [invoices, expenses] = await Promise.all([
    prisma.invoice.findMany({
      where: { zevId, id: { in: [...invoiceOpen.keys()] } },
      select: { id: true, number: true, dueDate: true, debtor: { select: { id: true, kind: true, firstName: true, lastName: true, orgName: true } } },
    }),
    prisma.expense.findMany({
      where: { zevId, id: { in: [...expenseOpen.keys()] } },
      select: { id: true, invoiceNumber: true, dueDate: true, supplier: { select: { id: true, name: true } } },
    }),
  ]);

  const build = async (
    rows: { id: string; groupId: string; groupName: string; number: string; due: Date | null; amount: Decimal }[],
    sourceType: string, kind: AccountingEventKind,
  ): Promise<OpenGroup[]> => {
    const groups = new Map<string, { name: string; items: OpenItem[] }>();
    for (const r of rows) {
      const days = r.due ? Math.floor((dateOnly(asOfIso).getTime() - dateOnly(iso(r.due)).getTime()) / 86_400_000) : 0;
      const ev = await prisma.accountingEvent.findUnique({
        where: { zevId_sourceType_sourceId_kind: { zevId, sourceType, sourceId: r.id, kind } },
        select: { journalEntryId: true, status: true },
      });
      const g = groups.get(r.groupId) ?? { name: r.groupName, items: [] };
      g.items.push({
        id: r.id, number: r.number, dueDate: r.due ? iso(r.due) : null, days: Math.max(days, 0), bucket: bucketOf(asOfIso, r.due), amount: money(r.amount),
        entryId: ev?.status === "POSTED" ? ev.journalEntryId : null,
        entryNumber: ev?.status === "POSTED" ? await postedEntryNumber(prisma, zevId, sourceType, r.id, kind) : null,
      });
      groups.set(r.groupId, g);
    }
    return [...groups.entries()].map(([id, g]) => {
      const buckets = Object.fromEntries(AGE_BUCKETS.map((b) => [b, money(sumDecimals(g.items.filter((i) => i.bucket === b).map((i) => dec(i.amount))))])) as Record<AgeBucket, string>;
      return {
        id, name: g.name, buckets, total: money(sumDecimals(g.items.map((i) => dec(i.amount)))),
        items: g.items.sort((a, b) => (a.dueDate ?? "").localeCompare(b.dueDate ?? "")),
      };
    }).sort((a, b) => a.name.localeCompare(b.name, "sr-Latn"));
  };
  const owners = await build(
    invoices.map((i) => ({ id: i.id, groupId: i.debtor.id, groupName: partyDisplayName(i.debtor), number: i.number, due: i.dueDate, amount: invoiceOpen.get(i.id)! })),
    "Invoice", "CHARGE_ISSUED",
  );
  const suppliers = await build(
    expenses.map((e) => ({ id: e.id, groupId: e.supplier?.id ?? "", groupName: e.supplier?.name ?? "—", number: e.invoiceNumber ?? "—", due: e.dueDate, amount: expenseOpen.get(e.id)! })),
    "Expense", "SUPPLIER_INVOICE",
  );
  const sumBuckets = (gs: OpenGroup[]) => ({
    buckets: Object.fromEntries(AGE_BUCKETS.map((b) => [b, money(sumDecimals(gs.map((g) => dec(g.buckets[b]))))])) as Record<AgeBucket, string>,
    total: money(sumDecimals(gs.map((g) => dec(g.total)))),
  });

  // Kontrolni zbir prema knjizi.
  const recon = await reconcileAt(actor, asOfIso);
  const ledgerOf = (r: ControlRole) => recon.rows.find((x) => x.role === r)?.ledger ?? null;
  const corrections = sumDecimals(items.filter((i) => i.sourceType === "CORRECTION").map(itemValue));
  return {
    asOfIso, owners, ownersTotal: sumBuckets(owners), suppliers, suppliersTotal: sumBuckets(suppliers),
    control: recon.active ? {
      receivableLedger: ledgerOf("OWNER_RECEIVABLE"), receivableCorrections: money(corrections),
      payableLedger: ledgerOf("SUPPLIER_PAYABLE"),
    } : null,
  };
}

// ---------------------------------------------------------------------------
// Godišnji pregled iz knjige (§4.5, B3-Q7 (a))
// ---------------------------------------------------------------------------

export type AnnualAccount = { accountId: string; code: string; name: string; group: string; amount: string };

/** Prihodi i rashodi po kontu za poslovnu godinu (bez naloga početnog stanja) i pregled po namjeni. */
export async function annualOverview(actor: Actor, yearLabel?: string | null) {
  requireCapability(actor, "ledger.view");
  const zevId = requireZev(actor);
  const years = await prisma.fiscalYear.findMany({ where: { zevId }, orderBy: { startDate: "desc" }, select: { label: true, startDate: true, endDate: true } });
  const today = toZonedDateIso(new Date());
  const year = years.find((y) => y.label === yearLabel) ?? years.find((y) => iso(y.startDate) <= today && today <= iso(y.endDate)) ?? years[0];
  if (!year) return { years: [], year: null, income: [], expense: [], incomeTotal: "0.00", expenseTotal: "0.00", result: "0.00", purposes: [] as PurposeRow[] };
  const range = { from: iso(year.startDate), to: iso(year.endDate) };
  const [lines, accounts] = await Promise.all([
    prisma.journalLine.findMany({
      where: {
        zevId, account: { nature: { in: ["INCOME", "EXPENSE"] } },
        entry: { status: "POSTED", kind: { not: "OPENING" }, postingDate: { gte: dateOnly(range.from), lte: dateOnly(range.to) } },
      },
      select: { accountId: true, debit: true, credit: true },
    }),
    prisma.zevAccount.findMany({ where: { zevId }, select: { id: true, code: true, name: true, nature: true, parentId: true } }),
  ]);
  const byId = new Map(accounts.map((a) => [a.id, a]));
  const sums = new Map<string, Decimal>();
  for (const l of lines) {
    const a = byId.get(l.accountId)!;
    const v = a.nature === "INCOME" ? dec(l.credit.toString()).minus(dec(l.debit.toString())) : dec(l.debit.toString()).minus(dec(l.credit.toString()));
    sums.set(l.accountId, (sums.get(l.accountId) ?? ZERO).plus(v));
  }
  const rows = (nature: "INCOME" | "EXPENSE"): AnnualAccount[] =>
    [...sums.entries()]
      .filter(([id, v]) => byId.get(id)!.nature === nature && !v.isZero())
      .map(([id, v]) => {
        const a = byId.get(id)!;
        const parent = a.parentId ? byId.get(a.parentId) : null;
        return { accountId: id, code: a.code, name: a.name, group: parent ? `${parent.code} ${parent.name}` : "", amount: money(v) };
      })
      .sort((x, y) => (x.code < y.code ? -1 : 1));
  const income = rows("INCOME");
  const expense = rows("EXPENSE");
  const incomeTotal = sumDecimals(income.map((r) => dec(r.amount)));
  const expenseTotal = sumDecimals(expense.map((r) => dec(r.amount)));
  return {
    years: years.map((y) => y.label), year: { label: year.label, ...range },
    income, expense, incomeTotal: money(incomeTotal), expenseTotal: money(expenseTotal), result: money(incomeTotal.minus(expenseTotal)),
    purposes: await purposeOverview(actor, range),
  };
}

// ---------------------------------------------------------------------------
// CSV (§2.4)
// ---------------------------------------------------------------------------

export const RECON_CSV_TYPES = ["uskladjivanje", "avansi", "otvorene-stavke", "godisnji"] as const;
export type ReconCsvType = (typeof RECON_CSV_TYPES)[number];

export async function reconciliationCsv(actor: Actor, type: ReconCsvType, p: { asOf: string; year?: string | null }): Promise<string> {
  requireCapability(actor, "ledger.view");
  let csv = "";
  if (type === "uskladjivanje") {
    const r = await reconcileAt(actor, p.asOf);
    csv = toCsv(r.rows.map((x) => ({ ...x, name: x.moneyAccount ? `${x.roleLabel}: ${x.moneyAccount}` : x.roleLabel, accounts: x.accounts.join(", "), ok: x.ok ? "da" : "ne" })), [
      { key: "name", label: "Kontrolno konto" }, { key: "accounts", label: "Konta" }, { key: "ledger", label: "Glavna knjiga" }, { key: "analytics", label: "Analitika" },
      { key: "operational", label: "Evidencija" }, { key: "difference", label: "Razlika" }, { key: "waiting", label: "Čeka knjiženje" },
      { key: "unexplained", label: "Neobjašnjeno" }, { key: "ok", label: "Usklađeno" },
    ]);
  } else if (type === "avansi") {
    const r = await advancesAt(actor, p.asOf);
    csv = toCsv([
      ...r.advances.map((a) => ({ vrsta: "Avans", naziv: a.name, datum: "", ...a })),
      ...r.unidentified.map((u) => ({ vrsta: "Neidentifikovana uplata", naziv: u.payer, datum: u.date ?? "", ...u })),
    ], [
      { key: "vrsta", label: "Vrsta" }, { key: "naziv", label: "Vlasnik / platilac" }, { key: "datum", label: "Datum uplate" },
      { key: "ledger", label: "Knjiga" }, { key: "operational", label: "Evidencija" }, { key: "waiting", label: "Čeka knjiženje" }, { key: "unexplained", label: "Neobjašnjeno" },
    ]);
  } else if (type === "otvorene-stavke") {
    const r = await openItemsAt(actor, p.asOf);
    const flat = (vrsta: string, gs: OpenGroup[]) => gs.flatMap((g) => g.items.map((i) => ({ vrsta, naziv: g.name, broj: i.number, rok: i.dueDate ?? "", dana: i.days, iznos: i.amount, nalog: i.entryNumber ?? "" })));
    csv = toCsv([...flat("Vlasnik", r.owners), ...flat("Dobavljač", r.suppliers)], [
      { key: "vrsta", label: "Vrsta" }, { key: "naziv", label: "Vlasnik / dobavljač" }, { key: "broj", label: "Broj" }, { key: "rok", label: "Rok plaćanja" },
      { key: "dana", label: "Dana kašnjenja" }, { key: "iznos", label: "Otvoreno" }, { key: "nalog", label: "Nalog" },
    ]);
  } else if (type === "godisnji") {
    const r = await annualOverview(actor, p.year);
    csv = toCsv([
      ...r.income.map((a) => ({ vrsta: "Prihod", konto: a.code, naziv: a.name, iznos: a.amount })),
      { vrsta: "Prihodi ukupno", konto: "", naziv: "", iznos: r.incomeTotal },
      ...r.expense.map((a) => ({ vrsta: "Rashod", konto: a.code, naziv: a.name, iznos: a.amount })),
      { vrsta: "Rashodi ukupno", konto: "", naziv: "", iznos: r.expenseTotal },
      { vrsta: "Rezultat", konto: "", naziv: "", iznos: r.result },
    ], [{ key: "vrsta", label: "Vrsta" }, { key: "konto", label: "Konto" }, { key: "naziv", label: "Naziv" }, { key: "iznos", label: "Iznos" }]);
  }
  await audit(actor, { action: "ledger.report.export", targetType: "LedgerReport", targetId: type, after: { asOf: p.asOf, year: p.year ?? null } });
  return csv;
}

