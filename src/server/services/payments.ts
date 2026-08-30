// Payments, CSV bank import, allocation to invoices, reversals, owner balances.
// PaymentAllocation rows are append-only (DB trigger); reversals are negative rows.
import { prisma } from "@/lib/prisma";
import { audit } from "@/server/audit";
import { requireRole, requireSelfOrRole, requireAnyUser, type Actor } from "@/server/auth/guards";
import { dec, ZERO, sumDecimals, type Decimal } from "@/lib/money";
import type { Prisma } from "@/generated/prisma/client";

// ---- Manual entry ----

export async function enterPayment(
  actor: Actor,
  data: {
    accountId: string;
    date: Date;
    amount: string;
    payerId?: string | null;
    payerNameRaw?: string | null;
    reference?: string | null;
    method?: string;
    note?: string | null;
  }
) {
  requireRole(actor, "ACCOUNTANT");
  if (dec(data.amount).lessThanOrEqualTo(0)) throw new Error("Iznos uplate mora biti pozitivan.");
  const p = await prisma.$transaction(async (tx) => {
    const payment = await tx.payment.create({
      data: {
        accountId: data.accountId,
        date: data.date,
        amount: data.amount,
        payerId: data.payerId ?? null,
        payerNameRaw: data.payerNameRaw ?? null,
        reference: data.reference ?? null,
        method: data.method ?? "BANK",
        note: data.note ?? null,
        createdById: actor.userId,
      },
    });
    await tx.finTransaction.create({
      data: {
        accountId: data.accountId,
        date: data.date,
        type: "INCOME",
        amount: data.amount,
        counterpartyName: data.payerNameRaw ?? null,
        paymentMethod: data.method ?? "BANK",
        description: "Uplata vlasnika",
        paymentId: payment.id,
        createdById: actor.userId,
      },
    });
    await audit(actor, {
      action: "payment.enter", targetType: "Payment", targetId: payment.id,
      after: { amount: data.amount, payerId: data.payerId ?? null, reference: data.reference ?? null },
    }, tx);
    return payment;
  });
  return p;
}

// ---- CSV bank-statement import ----

export type CsvMapping = {
  /** 0-based column indexes */
  dateCol: number;
  amountCol: number;
  payerCol: number;
  referenceCol: number;
  /** date format: "DD.MM.YYYY" | "YYYY-MM-DD" */
  dateFormat: string;
  delimiter: string;
  skipRows: number;
  /** decimal comma ("1.234,56") vs decimal point */
  decimalComma: boolean;
};

export const DEFAULT_CSV_MAPPING: CsvMapping = {
  dateCol: 0,
  amountCol: 1,
  payerCol: 2,
  referenceCol: 3,
  dateFormat: "DD.MM.YYYY",
  delimiter: ";",
  skipRows: 1,
  decimalComma: true,
};

function parseCsvDate(value: string, format: string): Date {
  const v = value.trim();
  if (format === "DD.MM.YYYY") {
    const m = v.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})\.?$/);
    if (!m) throw new Error(`Neispravan datum: "${v}"`);
    return new Date(Date.UTC(Number(m[3]), Number(m[2]) - 1, Number(m[1])));
  }
  const d = new Date(v);
  if (isNaN(d.getTime())) throw new Error(`Neispravan datum: "${v}"`);
  return d;
}

function parseCsvAmount(value: string, decimalComma: boolean): Decimal {
  let v = value.trim().replace(/\s|KM|BAM/g, "");
  if (decimalComma) v = v.replace(/\./g, "").replace(",", ".");
  const d = dec(v);
  if (d.isNaN()) throw new Error(`Neispravan iznos: "${value}"`);
  return d;
}

export async function importBankCsv(
  actor: Actor,
  input: { accountId: string; filename: string; content: string; mapping?: Partial<CsvMapping> }
) {
  requireRole(actor, "ACCOUNTANT");
  const mapping: CsvMapping = { ...DEFAULT_CSV_MAPPING, ...input.mapping };
  const lines = input.content.split(/\r?\n/).filter((l) => l.trim().length > 0).slice(mapping.skipRows);
  const rows: { date: Date; amount: Decimal; payer: string; reference: string }[] = [];
  const errors: { line: number; error: string }[] = [];
  lines.forEach((line, i) => {
    try {
      const cols = line.split(mapping.delimiter).map((c) => c.replace(/^"|"$/g, "").trim());
      const amount = parseCsvAmount(cols[mapping.amountCol] ?? "", mapping.decimalComma);
      if (amount.lessThanOrEqualTo(0)) return; // outgoing rows are not owner payments
      rows.push({
        date: parseCsvDate(cols[mapping.dateCol] ?? "", mapping.dateFormat),
        amount,
        payer: cols[mapping.payerCol] ?? "",
        reference: cols[mapping.referenceCol] ?? "",
      });
    } catch (e) {
      errors.push({ line: i + mapping.skipRows + 1, error: e instanceof Error ? e.message : String(e) });
    }
  });

  const batch = await prisma.$transaction(async (tx) => {
    const b = await tx.bankImportBatch.create({
      data: {
        filename: input.filename,
        mapping: mapping as unknown as Prisma.InputJsonValue,
        importedById: actor.userId,
      },
    });
    for (const r of rows) {
      const payment = await tx.payment.create({
        data: {
          accountId: input.accountId,
          date: r.date,
          amount: r.amount.toFixed(2),
          payerNameRaw: r.payer || null,
          reference: r.reference || null,
          method: "BANK",
          importBatchId: b.id,
          createdById: actor.userId,
        },
      });
      await tx.finTransaction.create({
        data: {
          accountId: input.accountId,
          date: r.date,
          type: "INCOME",
          amount: r.amount.toFixed(2),
          counterpartyName: r.payer || null,
          paymentMethod: "BANK",
          description: `Uvoz izvoda: ${input.filename}`,
          paymentId: payment.id,
          createdById: actor.userId,
        },
      });
    }
    await audit(actor, {
      action: "payment.import_csv", targetType: "BankImportBatch", targetId: b.id,
      after: { filename: input.filename, imported: rows.length, failed: errors.length },
    }, tx);
    return b;
  }, { timeout: 30000 });

  return { batchId: batch.id, imported: rows.length, errors };
}

// ---- Matching ----

/** Suggest invoices for an unapplied payment (by reference, payer, amount). */
export async function suggestMatches(actor: Actor, paymentId: string) {
  requireRole(actor, "ACCOUNTANT");
  const payment = await prisma.payment.findUniqueOrThrow({ where: { id: paymentId }, include: { payer: true } });
  const openInvoices = await prisma.invoice.findMany({
    where: { status: "ISSUED" },
    include: { allocations: true, debtor: true, unit: true },
  });
  const remaining = (inv: (typeof openInvoices)[number]) =>
    dec(inv.total.toString()).minus(sumDecimals(inv.allocations.map((a) => dec(a.amount.toString()))));
  const candidates = openInvoices
    .map((inv) => ({ inv, open: remaining(inv) }))
    .filter(({ open }) => open.greaterThan(0));

  const scored = candidates.map(({ inv, open }) => {
    let score = 0;
    const reasons: string[] = [];
    if (payment.reference && inv.paymentReference && payment.reference.includes(inv.paymentReference)) {
      score += 100; reasons.push("poziv na broj");
    }
    if (payment.payerId && payment.payerId === inv.debtorId) { score += 50; reasons.push("isti platilac"); }
    if (payment.payerNameRaw) {
      const dn = inv.debtor.kind === "PERSON"
        ? `${inv.debtor.firstName ?? ""} ${inv.debtor.lastName ?? ""}`.toLowerCase()
        : (inv.debtor.orgName ?? "").toLowerCase();
      const raw = payment.payerNameRaw.toLowerCase();
      if (dn && (raw.includes(dn) || dn.split(" ").every((part) => part && raw.includes(part)))) {
        score += 40; reasons.push("naziv platioca");
      }
    }
    if (open.equals(dec(payment.amount.toString()))) { score += 30; reasons.push("tačan iznos"); }
    return { invoiceId: inv.id, number: inv.number, unitLabel: inv.unit.label, open: open.toFixed(2), score, reasons };
  });
  return scored.filter((s) => s.score > 0).sort((a, b) => b.score - a.score).slice(0, 10);
}

// ---- Allocation (transactional) ----

async function refreshPaymentStatus(tx: Prisma.TransactionClient, paymentId: string) {
  const payment = await tx.payment.findUniqueOrThrow({ where: { id: paymentId }, include: { allocations: true } });
  const allocated = sumDecimals(payment.allocations.map((a) => dec(a.amount.toString())));
  const amount = dec(payment.amount.toString());
  const status = payment.reversedAt
    ? "REVERSED"
    : allocated.isZero()
      ? "UNAPPLIED"
      : allocated.greaterThanOrEqualTo(amount)
        ? "APPLIED"
        : "PARTIALLY_APPLIED";
  await tx.payment.update({ where: { id: paymentId }, data: { status } });
  return { allocated, amount };
}

async function refreshInvoiceStatus(tx: Prisma.TransactionClient, invoiceId: string) {
  const inv = await tx.invoice.findUniqueOrThrow({ where: { id: invoiceId }, include: { allocations: true } });
  if (inv.status === "CANCELLED" || inv.status === "CORRECTED" || inv.status === "DRAFT") return;
  const paid = sumDecimals(inv.allocations.map((a) => dec(a.amount.toString())));
  const status = paid.greaterThanOrEqualTo(dec(inv.total.toString())) && !dec(inv.total.toString()).isZero() ? "PAID" : "ISSUED";
  await tx.invoice.update({ where: { id: invoiceId }, data: { status } });
}

/**
 * Allocate (part of) a payment to an invoice. One payment may cover several
 * invoices and several payments may cover one invoice. Overpayment beyond the
 * invoice total is rejected — the surplus stays as an unapplied advance.
 */
export async function allocatePayment(
  actor: Actor,
  data: { paymentId: string; invoiceId: string; amount: string; reason?: string }
) {
  requireRole(actor, "ACCOUNTANT");
  const amount = dec(data.amount);
  if (amount.lessThanOrEqualTo(0)) throw new Error("Iznos alokacije mora biti pozitivan.");
  return prisma.$transaction(async (tx) => {
    const payment = await tx.payment.findUniqueOrThrow({ where: { id: data.paymentId }, include: { allocations: true } });
    if (payment.reversedAt) throw new Error("Stornirana uplata se ne može raspoređivati.");
    const invoice = await tx.invoice.findUniqueOrThrow({ where: { id: data.invoiceId }, include: { allocations: true } });
    if (invoice.status === "CANCELLED" || invoice.status === "DRAFT") throw new Error("Faktura nije raspoloživa za uplate.");

    const paymentAllocated = sumDecimals(payment.allocations.map((a) => dec(a.amount.toString())));
    const paymentFree = dec(payment.amount.toString()).minus(paymentAllocated);
    if (amount.greaterThan(paymentFree)) {
      throw new Error(`Uplata ima raspoloživo ${paymentFree.toFixed(2)} KM.`);
    }
    const invoicePaid = sumDecimals(invoice.allocations.map((a) => dec(a.amount.toString())));
    const invoiceOpen = dec(invoice.total.toString()).minus(invoicePaid);
    if (amount.greaterThan(invoiceOpen)) {
      throw new Error(`Faktura ima otvoreno ${invoiceOpen.toFixed(2)} KM — višak ostaje kao avans (nealocirano).`);
    }

    const alloc = await tx.paymentAllocation.create({
      data: {
        paymentId: data.paymentId,
        invoiceId: data.invoiceId,
        amount: amount.toFixed(2),
        reason: data.reason ?? null,
        createdById: actor.userId,
      },
    });
    await refreshPaymentStatus(tx, data.paymentId);
    await refreshInvoiceStatus(tx, data.invoiceId);
    await audit(actor, {
      action: "payment.allocate", targetType: "PaymentAllocation", targetId: alloc.id,
      after: { paymentId: data.paymentId, invoiceId: data.invoiceId, amount: amount.toFixed(2) },
    }, tx);
    return alloc;
  });
}

/** Reverse an allocation: append-only negative allocation row. */
export async function reverseAllocation(actor: Actor, allocationId: string, reason: string) {
  requireRole(actor, "ACCOUNTANT");
  if (!reason.trim()) throw new Error("Storniranje alokacije zahtijeva razlog.");
  return prisma.$transaction(async (tx) => {
    const orig = await tx.paymentAllocation.findUniqueOrThrow({ where: { id: allocationId } });
    if (dec(orig.amount.toString()).lessThanOrEqualTo(0)) throw new Error("Storno zapis se ne može stornirati.");
    const already = await tx.paymentAllocation.findUnique({ where: { reversalOfId: allocationId } });
    if (already) throw new Error("Alokacija je već stornirana.");
    const rev = await tx.paymentAllocation.create({
      data: {
        paymentId: orig.paymentId,
        invoiceId: orig.invoiceId,
        amount: dec(orig.amount.toString()).negated().toFixed(2),
        reversalOfId: allocationId,
        reason,
        createdById: actor.userId,
      },
    });
    await refreshPaymentStatus(tx, orig.paymentId);
    await refreshInvoiceStatus(tx, orig.invoiceId);
    await audit(actor, {
      action: "payment.allocation.reverse", targetType: "PaymentAllocation", targetId: rev.id,
      before: { originalAllocationId: allocationId, amount: orig.amount.toString() },
      reason,
    }, tx);
    return rev;
  });
}

/** Reverse a whole payment (e.g. bank recall). All its allocations are reversed too. */
export async function reversePayment(actor: Actor, paymentId: string, reason: string) {
  requireRole(actor, "ACCOUNTANT");
  if (!reason.trim()) throw new Error("Storniranje uplate zahtijeva razlog.");
  return prisma.$transaction(async (tx) => {
    const payment = await tx.payment.findUniqueOrThrow({ where: { id: paymentId }, include: { allocations: true, transaction: true } });
    if (payment.reversedAt) throw new Error("Uplata je već stornirana.");
    // Reverse outstanding allocations.
    const net = new Map<string, Decimal>();
    for (const a of payment.allocations) {
      const cur = net.get(a.invoiceId) ?? ZERO;
      net.set(a.invoiceId, cur.plus(dec(a.amount.toString())));
    }
    for (const [invoiceId, amount] of net) {
      if (amount.greaterThan(0)) {
        await tx.paymentAllocation.create({
          data: {
            paymentId,
            invoiceId,
            amount: amount.negated().toFixed(2),
            reason: `Storno uplate: ${reason}`,
            createdById: actor.userId,
          },
        });
        await refreshInvoiceStatus(tx, invoiceId);
      }
    }
    const updated = await tx.payment.update({
      where: { id: paymentId },
      data: { reversedAt: new Date(), reversalReason: reason, status: "REVERSED" },
    });
    if (payment.transaction) {
      await tx.finTransaction.update({
        where: { id: payment.transaction.id },
        data: { status: "CANCELLED", cancelledAt: new Date(), cancelReason: `Storno uplate: ${reason}` },
      });
    }
    await audit(actor, {
      action: "payment.reverse", targetType: "Payment", targetId: paymentId,
      before: { amount: payment.amount.toString(), status: payment.status },
      reason,
    }, tx);
    return updated;
  });
}

export async function listPayments(actor: Actor, filter?: { status?: string; payerId?: string }) {
  requireAnyUser(actor);
  const isManagement = actor.roles.includes("PRESIDENT") || actor.roles.includes("ACCOUNTANT");
  const payerId = isManagement ? filter?.payerId : actor.partyId ?? "__none__";
  return prisma.payment.findMany({
    where: { status: filter?.status as never, payerId: payerId ?? undefined },
    include: { payer: true, account: true, allocations: { include: { invoice: true } } },
    orderBy: { date: "desc" },
  });
}

// ---- Balances ----

export type OwnerBalance = {
  partyId: string;
  charged: string;
  paid: string;
  corrections: string;
  balance: string; // positive = owner owes
};

/**
 * Owner balance as of a date:
 * charges (issued invoices) − allocated payments ± corrections.
 * Historical liability follows the invoice debtor, not the current unit owner.
 */
export async function ownerBalance(actor: Actor, partyId: string, asOf?: Date): Promise<OwnerBalance> {
  requireSelfOrRole(actor, partyId, "PRESIDENT", "ACCOUNTANT");
  const dateFilter = asOf ? { lte: asOf } : undefined;
  const invoices = await prisma.invoice.findMany({
    where: { debtorId: partyId, status: { in: ["ISSUED", "PAID"] }, issueDate: dateFilter },
    include: { allocations: asOf ? { where: { createdAt: { lte: asOf } } } : true },
  });
  const charged = sumDecimals(invoices.map((i) => dec(i.total.toString())));
  const paid = sumDecimals(invoices.flatMap((i) => i.allocations.map((a) => dec(a.amount.toString()))));
  const correctionsRows = await prisma.balanceCorrection.findMany({
    where: { partyId, createdAt: dateFilter },
  });
  const corrections = sumDecimals(correctionsRows.map((c) => dec(c.amount.toString())));
  const balance = charged.minus(paid).plus(corrections);
  return {
    partyId,
    charged: charged.toFixed(2),
    paid: paid.toFixed(2),
    corrections: corrections.toFixed(2),
    balance: balance.toFixed(2),
  };
}

/** Unapplied (advance) amount standing on a payer's payments. */
export async function ownerAdvance(actor: Actor, partyId: string): Promise<string> {
  requireSelfOrRole(actor, partyId, "PRESIDENT", "ACCOUNTANT");
  const payments = await prisma.payment.findMany({
    where: { payerId: partyId, reversedAt: null },
    include: { allocations: true },
  });
  let free = ZERO;
  for (const p of payments) {
    const allocated = sumDecimals(p.allocations.map((a) => dec(a.amount.toString())));
    free = free.plus(dec(p.amount.toString()).minus(allocated));
  }
  return free.toFixed(2);
}

/** Audited manual balance correction (e.g. authorized debt transfer on sale). */
export async function addBalanceCorrection(
  actor: Actor,
  data: { partyId: string; unitId?: string | null; amount: string; reason: string; authority?: string | null }
) {
  requireRole(actor, "ACCOUNTANT", "PRESIDENT");
  if (!data.reason.trim()) throw new Error("Korekcija salda zahtijeva razlog.");
  const c = await prisma.balanceCorrection.create({
    data: { ...data, createdById: actor.userId },
  });
  await audit(actor, {
    action: "balance.correction", targetType: "BalanceCorrection", targetId: c.id,
    after: { partyId: data.partyId, amount: data.amount, authority: data.authority ?? null },
    reason: data.reason,
  });
  return c;
}
