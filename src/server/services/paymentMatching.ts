// SMS ↔ izvod usklađivanje (Plans/sms-statement-payment-matching-plan.md).
//
// The same bank transaction can reach the books twice: once from a confirmed Nova Banka SMS
// (bankSms.ts confirmBankSms) and once from the PDF statement or a manual entry. The import
// screens already warn about that before anything is booked (markRowsAlreadyBookedFromSms,
// listBankSmsReview); this file covers what is ALREADY booked:
//   - detection of probable duplicates (an SMS-booked record + a record from another channel),
//   - merging an inflow duplicate (reverse one Payment, move its allocations to the survivor),
//   - "nisu iste" / manual confirmation decisions, kept in BankRecordMatch (append-only).
// An SMS with a SAME link is "potvrđen izvodom"; one without it, older than a few days, is
// listed as unconfirmed — the statement is the only real proof an SMS was genuine.
import { prisma } from "@/lib/prisma";
import { audit } from "@/server/audit";
import { requireRole, requireZev, type Actor } from "@/server/auth/guards";
import { dec, sumDecimals } from "@/lib/money";
import { toZonedDateIso } from "@/lib/i18n";
import { namesSimilar } from "@/server/services/bankSms";
import {
  netAllocationsByInvoice,
  refreshInvoiceStatus,
  refreshPaymentStatus,
  reversePaymentInTx,
} from "@/server/services/payments";

const DAY = 86400000;
/** SMS receipt vs. statement/booking date: same window the import-time checks use. */
const WINDOW_DAYS = 3;
/** An SMS-booked record with no statement link after this many days is "bez potvrde izvodom" (P4). */
export const UNCONFIRMED_AFTER_DAYS = 3;

/** OTHER: a bank outflow (FinTransaction) — it does not record whether it came from a statement or by hand. */
export type ChannelSource = "SMS" | "PDF" | "CSV" | "MANUAL" | "OTHER";

export type ChannelRecord = {
  kind: "PAYMENT" | "TRANSACTION";
  id: string;
  /** yyyy-mm-dd (booking date). */
  date: string;
  amount: string;
  name: string | null;
  purpose: string | null;
  source: ChannelSource;
  /** Invoice numbers this payment is (net) allocated to — inflows only. */
  invoices: string[];
};

export type ChannelDuplicate = {
  smsId: string;
  direction: "IN" | "OUT";
  confidence: "HIGH" | "POSSIBLE";
  dayDiff: number;
  accountName: string;
  smsReceivedAt: string; // ISO
  sms: ChannelRecord;
  other: ChannelRecord;
  /** Inflows only (decision P3): outflows are detected and decided, never merged here. */
  canMerge: boolean;
  /** OUT only: already marked as the same transaction, but both outflows are still active. */
  linkedButBothActive: boolean;
};

export type UnconfirmedSms = {
  smsId: string;
  direction: "IN" | "OUT";
  accountName: string;
  smsReceivedAt: string;
  ageDays: number;
  record: ChannelRecord;
};

export type ChannelReconciliation = {
  duplicates: ChannelDuplicate[];
  unconfirmed: UnconfirmedSms[];
  confirmedCount: number;
};

function dayNumber(d: Date): number {
  return Math.round(Date.parse(`${toZonedDateIso(d)}T00:00:00Z`) / DAY);
}

function paymentSource(p: { importBatch: { sourceType: string } | null }, smsPaymentIds: Set<string>, id: string): ChannelSource {
  if (smsPaymentIds.has(id)) return "SMS";
  const t = p.importBatch?.sourceType;
  return t === "PDF" || t === "CSV" || t === "SMS" ? t : "MANUAL";
}

/** Probable duplicates and SMS records the statement never confirmed. Writes nothing. */
export async function getChannelReconciliation(actor: Actor): Promise<ChannelReconciliation> {
  requireRole(actor, "PRESIDENT", "ACCOUNTANT");
  const zevId = requireZev(actor);

  const [smsRows, allSmsLinks, matches] = await Promise.all([
    prisma.incomingBankSms.findMany({
      where: { zevId, status: "CONFIRMED", OR: [{ paymentId: { not: null } }, { transactionId: { not: null } }] },
      include: { account: true },
      orderBy: { receivedAt: "desc" },
      take: 500,
    }),
    prisma.incomingBankSms.findMany({
      where: { zevId, OR: [{ paymentId: { not: null } }, { transactionId: { not: null } }] },
      select: { paymentId: true, transactionId: true },
    }),
    prisma.bankRecordMatch.findMany({ where: { zevId }, orderBy: { createdAt: "asc" } }),
  ]);
  const smsPaymentIds = new Set(allSmsLinks.flatMap((s) => (s.paymentId ? [s.paymentId] : [])));
  const smsTxIds = new Set(allSmsLinks.flatMap((s) => (s.transactionId ? [s.transactionId] : [])));

  const sameBySms = new Map<string, (typeof matches)[number][]>();
  const notSamePairs = new Set<string>();
  const claimedOthers = new Set<string>(); // records already accounted for by a SAME decision
  for (const m of matches) {
    if (m.decision === "SAME") {
      sameBySms.set(m.smsId, [...(sameBySms.get(m.smsId) ?? []), m]);
      for (const id of [m.statementPaymentId, m.statementTransactionId, m.survivorPaymentId, m.reversedPaymentId]) {
        if (id) claimedOthers.add(id);
      }
    } else if (m.decision === "NOT_SAME") {
      notSamePairs.add(`${m.smsId}|${m.statementPaymentId ?? m.statementTransactionId}`);
    }
  }

  if (smsRows.length === 0) return { duplicates: [], unconfirmed: [], confirmedCount: 0 };

  const minAt = new Date(Math.min(...smsRows.map((s) => s.receivedAt.getTime())) - (WINDOW_DAYS + 1) * DAY);
  const maxAt = new Date(Math.max(...smsRows.map((s) => s.receivedAt.getTime())) + (WINDOW_DAYS + 1) * DAY);
  const ownPaymentIds = smsRows.flatMap((s) => (s.paymentId ? [s.paymentId] : []));
  const ownTxIds = smsRows.flatMap((s) => (s.transactionId ? [s.transactionId] : []));

  const paymentInclude = { importBatch: { select: { sourceType: true } }, allocations: { include: { invoice: { select: { number: true } } } } } as const;
  const [ownPayments, ownTxs, otherPayments, otherTxs] = await Promise.all([
    prisma.payment.findMany({ where: { zevId, id: { in: ownPaymentIds } }, include: paymentInclude }),
    prisma.finTransaction.findMany({ where: { zevId, id: { in: ownTxIds } } }),
    prisma.payment.findMany({
      where: { zevId, reversedAt: null, reversalOfId: null, date: { gte: minAt, lt: maxAt }, id: { notIn: [...smsPaymentIds] } },
      include: paymentInclude,
    }),
    prisma.finTransaction.findMany({
      where: {
        zevId, type: "EXPENSE", status: "ACTIVE", cancelOfId: null, paymentMethod: "BANK",
        date: { gte: minAt, lt: maxAt }, id: { notIn: [...smsTxIds] },
      },
    }),
  ]);
  const ownPaymentById = new Map(ownPayments.map((p) => [p.id, p]));
  const ownTxById = new Map(ownTxs.map((t) => [t.id, t]));
  const otherTxById = new Map(otherTxs.map((t) => [t.id, t]));

  const paymentRecord = (p: (typeof ownPayments)[number]): ChannelRecord => {
    const net = netAllocationsByInvoice(p.allocations);
    const numbers = new Map(p.allocations.map((a) => [a.invoiceId, a.invoice.number]));
    return {
      kind: "PAYMENT",
      id: p.id,
      date: toZonedDateIso(p.date),
      amount: dec(p.amount.toString()).toFixed(2),
      name: p.payerNameRaw,
      purpose: p.purposeRaw,
      source: paymentSource(p, smsPaymentIds, p.id),
      invoices: [...net].filter(([, amt]) => amt.greaterThan(0)).map(([id]) => numbers.get(id) ?? id),
    };
  };
  const txRecord = (t: (typeof ownTxs)[number], source: ChannelSource): ChannelRecord => ({
    kind: "TRANSACTION",
    id: t.id,
    date: toZonedDateIso(t.date),
    amount: dec(t.amount.toString()).toFixed(2),
    name: t.counterpartyName,
    purpose: t.description,
    source,
    invoices: [],
  });

  type Candidate = { dup: ChannelDuplicate; otherKey: string };
  const candidates: Candidate[] = [];
  const duplicates: ChannelDuplicate[] = [];
  const unconfirmed: UnconfirmedSms[] = [];
  const settledSms = new Set<string>();
  let confirmedCount = 0;

  for (const s of smsRows) {
    const isIn = s.kind === "PRILIV";
    const own = isIn ? (s.paymentId ? ownPaymentById.get(s.paymentId) : undefined) : (s.transactionId ? ownTxById.get(s.transactionId) : undefined);
    const ownActive = own && ("reversedAt" in own ? !own.reversedAt : own.status === "ACTIVE");
    const sameLinks = sameBySms.get(s.id) ?? [];
    if (sameLinks.length > 0) {
      confirmedCount++;
      settledSms.add(s.id);
      // Decision P3: a linked outflow pair whose two outflows are both still active is a double
      // booking the reviewer must still resolve by hand — keep showing it.
      if (!isIn && ownActive && own && !("reversedAt" in own)) {
        const linkedTx = sameLinks
          .map((m) => (m.statementTransactionId ? otherTxById.get(m.statementTransactionId) : undefined))
          .find((t) => t !== undefined);
        if (linkedTx) {
          duplicates.push({
            smsId: s.id, direction: "OUT", confidence: "HIGH",
            dayDiff: Math.abs(dayNumber(s.receivedAt) - dayNumber(linkedTx.date)),
            accountName: s.account?.name ?? "",
            smsReceivedAt: s.receivedAt.toISOString(),
            sms: txRecord(own, "SMS"),
            other: txRecord(linkedTx, "OTHER"),
            canMerge: false,
            linkedButBothActive: true,
          });
        }
      }
      continue;
    }
    if (!own || !ownActive) {
      settledSms.add(s.id); // nothing booked from this SMS any more — nothing to duplicate or confirm
      continue;
    }
    const smsDay = dayNumber(s.receivedAt);
    const amount = dec((s.amount ?? 0).toString());
    const smsRecord = "reversedAt" in own ? paymentRecord(own) : txRecord(own, "SMS");

    const pool = isIn
      ? otherPayments.map((p) => ({ id: p.id, accountId: p.accountId, amount: p.amount, date: p.date, name: p.payerNameRaw, rec: () => paymentRecord(p) }))
      : otherTxs.map((t) => ({ id: t.id, accountId: t.accountId, amount: t.amount, date: t.date, name: t.counterpartyName, rec: () => txRecord(t, "OTHER") }));
    for (const o of pool) {
      if (claimedOthers.has(o.id) || notSamePairs.has(`${s.id}|${o.id}`)) continue;
      if (o.accountId !== s.accountId || !dec(o.amount.toString()).equals(amount)) continue;
      const dayDiff = Math.abs(smsDay - dayNumber(o.date));
      if (dayDiff > WINDOW_DAYS) continue;
      const confidence = dayDiff <= 1 && s.counterpartyName && namesSimilar(o.name, s.counterpartyName) ? "HIGH" : "POSSIBLE";
      candidates.push({ otherKey: o.id, dup: {
        smsId: s.id,
        direction: isIn ? "IN" : "OUT",
        confidence,
        dayDiff,
        accountName: s.account?.name ?? "",
        smsReceivedAt: s.receivedAt.toISOString(),
        sms: smsRecord,
        other: o.rec(),
        canMerge: isIn,
        linkedButBothActive: false,
      } });
    }
  }

  // One-to-one, greedily: surest pairs first (same principle as markRowsAlreadyBookedFromSms).
  candidates.sort((a, b) =>
    a.dup.confidence === b.dup.confidence ? a.dup.dayDiff - b.dup.dayDiff : a.dup.confidence === "HIGH" ? -1 : 1
  );
  const usedSms = new Set<string>();
  const usedOther = new Set<string>();
  for (const c of candidates) {
    if (usedSms.has(c.dup.smsId) || usedOther.has(c.otherKey)) continue;
    usedSms.add(c.dup.smsId);
    usedOther.add(c.otherKey);
    duplicates.push(c.dup);
  }

  const now = Date.now();
  for (const s of smsRows) {
    if (settledSms.has(s.id) || usedSms.has(s.id)) continue;
    const ageDays = Math.floor((now - s.receivedAt.getTime()) / DAY);
    if (ageDays < UNCONFIRMED_AFTER_DAYS) continue;
    const own = s.kind === "PRILIV" ? ownPaymentById.get(s.paymentId ?? "") : ownTxById.get(s.transactionId ?? "");
    if (!own) continue;
    unconfirmed.push({
      smsId: s.id,
      direction: s.kind === "PRILIV" ? "IN" : "OUT",
      accountName: s.account?.name ?? "",
      smsReceivedAt: s.receivedAt.toISOString(),
      ageDays,
      record: "reversedAt" in own ? paymentRecord(own) : txRecord(own, "SMS"),
    });
  }

  duplicates.sort((a, b) => b.smsReceivedAt.localeCompare(a.smsReceivedAt));
  return { duplicates, unconfirmed, confirmedCount };
}

/** Loads a CONFIRMED SMS of the actor's ZEV that booked something, or throws. */
async function loadConfirmedSms(zevId: string, smsId: string) {
  const sms = await prisma.incomingBankSms.findFirst({ where: { id: smsId, zevId, status: "CONFIRMED" } });
  if (!sms || (!sms.paymentId && !sms.transactionId)) throw new Error("SMS obavještenje nije pronađeno ili nije proknjiženo.");
  return sms;
}

/**
 * "Ista uplata — spoji" (inflows only). Keeps ONE of the two Payments (decision P1 (c): the one
 * with allocations; if both or neither have them, the statement/manual one) and reverses the other
 * through the regular append-only storno. Whatever the duplicate had allocated is re-allocated to
 * the survivor as far as the survivor's free amount allows; anything beyond that simply stays
 * reversed (the invoice reopens — the money arrived only once).
 */
export async function mergeChannelDuplicate(actor: Actor, input: { smsId: string; otherPaymentId: string }) {
  requireRole(actor, "ACCOUNTANT");
  const zevId = requireZev(actor);
  const sms = await loadConfirmedSms(zevId, input.smsId);
  if (sms.kind !== "PRILIV" || !sms.paymentId) throw new Error("Spajanje je moguće samo za uplate (priliv).");
  const smsPaymentId = sms.paymentId;
  if (smsPaymentId === input.otherPaymentId) throw new Error("Izaberite drugu uplatu.");

  return prisma.$transaction(async (tx) => {
    const include = { allocations: true } as const;
    const smsPayment = await tx.payment.findUniqueOrThrow({ where: { id: smsPaymentId, zevId }, include });
    const other = await tx.payment.findUniqueOrThrow({ where: { id: input.otherPaymentId, zevId }, include });
    const otherFromSms = await tx.incomingBankSms.findFirst({ where: { zevId, paymentId: other.id }, select: { id: true } });
    if (otherFromSms) throw new Error("Obje uplate potiču iz SMS-a — to nije par SMS ↔ izvod.");
    if (smsPayment.reversedAt || other.reversedAt) throw new Error("Jedna od uplata je već stornirana.");
    if (smsPayment.accountId !== other.accountId) throw new Error("Uplate su na različitim računima.");
    if (!dec(smsPayment.amount.toString()).equals(dec(other.amount.toString()))) throw new Error("Uplate nemaju isti iznos.");

    const allocated = (p: typeof other) => sumDecimals(p.allocations.map((a) => dec(a.amount.toString())));
    const smsHas = allocated(smsPayment).greaterThan(0);
    const otherHas = allocated(other).greaterThan(0);
    const survivor = smsHas && !otherHas ? smsPayment : other;
    const duplicate = survivor === other ? smsPayment : other;

    const dupNet = [...netAllocationsByInvoice(duplicate.allocations)].filter(([, amt]) => amt.greaterThan(0));
    const reason = `Duplikat uplate (SMS ↔ izvod), zadržana uplata ${survivor.id}`;
    await reversePaymentInTx(tx, actor, zevId, duplicate.id, reason);

    let free = dec(survivor.amount.toString()).minus(allocated(survivor));
    let moved = dec(0);
    let notMoved = dec(0);
    for (const [invoiceId, amt] of dupNet) {
      const inv = await tx.invoice.findUniqueOrThrow({ where: { id: invoiceId, zevId }, include: { allocations: true } });
      const open = dec(inv.total.toString()).minus(sumDecimals(inv.allocations.map((a) => dec(a.amount.toString()))));
      const available = inv.status === "ISSUED" || inv.status === "PAID";
      let take = available ? amt : dec(0);
      if (take.greaterThan(free)) take = free;
      if (take.greaterThan(open)) take = open;
      if (take.greaterThan(0)) {
        const alloc = await tx.paymentAllocation.create({
          data: {
            paymentId: survivor.id, invoiceId, amount: take.toFixed(2),
            reason: `Prenos sa duplikata uplate ${duplicate.id} (usklađivanje SMS ↔ izvod)`,
            createdById: actor.userId,
          },
        });
        await refreshInvoiceStatus(tx, zevId, invoiceId);
        await audit(actor, {
          action: "payment.allocate", targetType: "PaymentAllocation", targetId: alloc.id,
          after: { paymentId: survivor.id, invoiceId, amount: take.toFixed(2), source: "channel_merge" },
        }, tx);
        free = free.minus(take);
        moved = moved.plus(take);
      }
      notMoved = notMoved.plus(amt.minus(take));
    }
    await refreshPaymentStatus(tx, zevId, survivor.id);

    const otherBatch = other.importBatchId
      ? await tx.bankImportBatch.findFirst({ where: { id: other.importBatchId, zevId }, select: { id: true, sourceType: true } })
      : null;
    const m = await tx.bankRecordMatch.create({
      data: {
        zevId, smsId: sms.id,
        statementBatchId: otherBatch?.sourceType === "PDF" ? otherBatch.id : null,
        statementPaymentId: other.id,
        decision: "SAME", origin: "MERGE",
        survivorPaymentId: survivor.id, reversedPaymentId: duplicate.id,
        createdById: actor.userId,
      },
    });
    await audit(actor, {
      action: "payment.channel_merge", targetType: "BankRecordMatch", targetId: m.id,
      after: { smsId: sms.id, survivorPaymentId: survivor.id, reversedPaymentId: duplicate.id, moved: moved.toFixed(2), notMoved: notMoved.toFixed(2) },
    }, tx);
    return { survivorPaymentId: survivor.id, reversedPaymentId: duplicate.id, moved: moved.toFixed(2), notMoved: notMoved.toFixed(2) };
  });
}

/** "Ista transakcija" for an outflow pair (decision P3: link only, nothing is reversed). */
export async function linkChannelTransaction(actor: Actor, input: { smsId: string; otherTransactionId: string }) {
  requireRole(actor, "ACCOUNTANT");
  const zevId = requireZev(actor);
  const sms = await loadConfirmedSms(zevId, input.smsId);
  if (sms.kind !== "ODLIV") throw new Error("Povezivanje transakcije je samo za odlive.");
  const t = await prisma.finTransaction.findFirst({ where: { id: input.otherTransactionId, zevId, type: "EXPENSE" } });
  if (!t || t.id === sms.transactionId) throw new Error("Transakcija nije pronađena.");
  const m = await prisma.bankRecordMatch.create({
    data: { zevId, smsId: sms.id, statementTransactionId: t.id, decision: "SAME", origin: "MANUAL_LINK", createdById: actor.userId },
  });
  await audit(actor, {
    action: "bank_match.link", targetType: "BankRecordMatch", targetId: m.id,
    after: { smsId: sms.id, statementTransactionId: t.id, origin: "MANUAL_LINK" },
  });
  return m;
}

/** "Potvrđeno izvodom": the reviewer checked the statement by hand (e.g. the row was skipped at
 *  import before links were recorded). No other record is involved. */
export async function confirmSmsByStatement(actor: Actor, smsId: string) {
  requireRole(actor, "ACCOUNTANT");
  const zevId = requireZev(actor);
  const sms = await loadConfirmedSms(zevId, smsId);
  const m = await prisma.bankRecordMatch.create({
    data: { zevId, smsId: sms.id, decision: "SAME", origin: "MANUAL_LINK", createdById: actor.userId },
  });
  await audit(actor, {
    action: "bank_match.link", targetType: "BankRecordMatch", targetId: m.id,
    after: { smsId: sms.id, origin: "MANUAL_LINK" },
  });
  return m;
}

/** "Nisu iste": two real transactions that merely look alike — never suggest this pair again. */
export async function markChannelNotSame(
  actor: Actor,
  input: { smsId: string; otherPaymentId?: string | null; otherTransactionId?: string | null }
) {
  requireRole(actor, "ACCOUNTANT");
  const zevId = requireZev(actor);
  const sms = await loadConfirmedSms(zevId, input.smsId);
  const otherPaymentId = input.otherPaymentId || null;
  const otherTransactionId = input.otherTransactionId || null;
  if (Boolean(otherPaymentId) === Boolean(otherTransactionId)) throw new Error("Navedite tačno jedan drugi zapis.");
  const exists = otherPaymentId
    ? await prisma.payment.count({ where: { id: otherPaymentId, zevId } })
    : await prisma.finTransaction.count({ where: { id: otherTransactionId!, zevId } });
  if (!exists) throw new Error("Drugi zapis nije pronađen.");
  const m = await prisma.bankRecordMatch.create({
    data: {
      zevId, smsId: sms.id, statementPaymentId: otherPaymentId, statementTransactionId: otherTransactionId,
      decision: "NOT_SAME", origin: "NOT_SAME", createdById: actor.userId,
    },
  });
  await audit(actor, {
    action: "bank_match.not_same", targetType: "BankRecordMatch", targetId: m.id,
    after: { smsId: sms.id, otherPaymentId, otherTransactionId },
  });
  return m;
}

export type PaymentChannelInfo = {
  /** Booked from a confirmed SMS. */
  fromSms: boolean;
  /** SMS payments only: true once a statement link exists. */
  statementConfirmed: boolean;
  /** Set when this payment took part in an SMS ↔ izvod merge. */
  merge: { role: "SURVIVOR" | "DUPLICATE"; otherPaymentId: string } | null;
};

/** Badge data for the payment detail page. */
export async function getPaymentChannelInfo(actor: Actor, paymentId: string): Promise<PaymentChannelInfo> {
  requireRole(actor, "PRESIDENT", "ACCOUNTANT");
  const zevId = requireZev(actor);
  const [sms, mergeRow] = await Promise.all([
    prisma.incomingBankSms.findFirst({ where: { zevId, paymentId }, include: { matches: { where: { decision: "SAME" }, select: { id: true } } } }),
    prisma.bankRecordMatch.findFirst({
      where: { zevId, origin: "MERGE", OR: [{ survivorPaymentId: paymentId }, { reversedPaymentId: paymentId }] },
      orderBy: { createdAt: "desc" },
    }),
  ]);
  const merge = mergeRow
    ? mergeRow.survivorPaymentId === paymentId
      ? { role: "SURVIVOR" as const, otherPaymentId: mergeRow.reversedPaymentId! }
      : { role: "DUPLICATE" as const, otherPaymentId: mergeRow.survivorPaymentId! }
    : null;
  return { fromSms: Boolean(sms), statementConfirmed: Boolean(sms && sms.matches.length > 0), merge };
}
