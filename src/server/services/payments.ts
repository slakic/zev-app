// Payments, CSV bank import, allocation to invoices, reversals, owner balances.
// PaymentAllocation rows are append-only (DB trigger); reversals are negative rows.
import { prisma } from "@/lib/prisma";
import { audit } from "@/server/audit";
import { requireRole, requireSelfOrRole, requireAnyUser, type Actor } from "@/server/auth/guards";
import { dec, ZERO, sumDecimals, type Decimal } from "@/lib/money";
import type { Prisma } from "@/generated/prisma/client";
import { extractPdfText, parseNovaBankaStatement, extractUnitNumberCandidates } from "@/server/services/bankStatementPdf";
import { partyDisplayName } from "@/server/services/ownership";

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
  /** svrha uplate / opis plaćanja — a column separate from "poziv na broj" some banks export;
   *  optional (-1 or omitted = not present in this bank's export). */
  purposeCol?: number;
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
  purposeCol: -1,
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
  const rows: { date: Date; amount: Decimal; payer: string; reference: string; purpose: string }[] = [];
  const errors: { line: number; error: string }[] = [];
  const purposeCol = mapping.purposeCol ?? -1;
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
        purpose: purposeCol >= 0 ? (cols[purposeCol] ?? "") : "",
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
          purposeRaw: r.purpose || null,
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

// ---- PDF bank-statement import (preview, then explicit commit) ----
//
// Unlike CSV (structured columns, imported directly), reading a PDF statement means
// reading a text layer and guessing which lines are transactions. That guess can be
// wrong, so a PDF import is NEVER written to the database directly: importPdfPreview()
// only parses and returns rows for a human to review/edit/uncheck, and commitPdfImport()
// writes exactly what was reviewed. Never call commitPdfImport() with unreviewed rows.

export type PdfPreviewRow = {
  include: boolean;
  /** IN = uplata (credit) matched against open invoices; OUT = isplata (debit), mapped to a Trošak. */
  direction: "IN" | "OUT";
  date: string; // yyyy-mm-dd, editable
  amount: string; // editable, always positive — sign implied by `direction`
  payerNameRaw: string; // payer (IN) or recipient/counterparty (OUT), as printed
  purposeRaw: string;
  reference: string;
  /** IN rows: invoice the reviewer accepted/chose to allocate this payment to (nullable — "decide later"). */
  invoiceId: string | null;
  /** OUT rows: open Trošak (Expense) this outflow settles (nullable — record as unlinked outflow). */
  expenseId: string | null;
  /** OUT rows only, used when expenseId is empty: free-text category for the unlinked transaction. */
  categoryName: string;
  /** Human-readable reasons behind the best automatic suggestion, for the reviewer's benefit only. */
  matchHint: string | null;
};

export type PdfImportPreview = {
  filename: string;
  rawText: string;
  statementDateIso: string | null;
  ownAccountNumber: string | null;
  accountMismatch: boolean;
  rows: PdfPreviewRow[];
  /** Open invoices, for the per-row "Faktura" dropdown (IN rows). */
  invoiceOptions: { id: string; label: string }[];
  /** Unpaid/partially paid expenses, for the per-row "Trošak" dropdown (OUT rows). */
  expenseOptions: { id: string; label: string }[];
  skipped: number; // lines with neither a debit nor a credit amount (should be rare)
};

/** Parses a PDF bank statement and returns rows for review. Writes nothing. */
export async function importPdfPreview(
  actor: Actor,
  input: { accountId: string; filename: string; buffer: Buffer }
): Promise<PdfImportPreview> {
  requireRole(actor, "ACCOUNTANT");
  const account = await prisma.moneyAccount.findUniqueOrThrow({ where: { id: input.accountId } });
  const text = await extractPdfText(input.buffer);
  const parsed = parseNovaBankaStatement(text);

  const invoiceCandidates = await fetchOpenInvoiceCandidates();
  const invoiceOptions = invoiceCandidates.map(({ inv, open }) => ({
    id: inv.id,
    label: `${inv.number} — ${partyDisplayName(inv.debtor)} (${inv.unit.label}) — otvoreno ${open.toFixed(2)} KM`,
  }));

  const unpaidExpenses = await prisma.expense.findMany({
    where: { status: { in: ["UNPAID", "PARTIALLY_PAID"] } },
    include: { supplier: true },
  });
  const expenseOptions = unpaidExpenses.map((e) => {
    const open = dec(e.amount.toString()).minus(dec(e.paidAmount.toString()));
    return {
      id: e.id,
      label: `${e.supplier?.name ?? "bez dobavljača"}${e.invoiceNumber ? " — " + e.invoiceNumber : ""} — otvoreno ${open.toFixed(2)} KM`,
    };
  });

  const dateIso = parsed.statementDate ? parsed.statementDate.toISOString().slice(0, 10) : "";
  let skipped = 0;
  const rows: PdfPreviewRow[] = [];
  for (const r of parsed.rows) {
    if (r.credit.greaterThan(0)) {
      const amount = r.credit;
      const best = invoiceCandidates
        .map(({ inv, open }) =>
          scoreInvoiceMatch(inv, open, { reference: r.bankReference, payerId: null, payerNameRaw: r.partnerName, purposeRaw: r.purposeRaw, amount })
        )
        .filter((s) => s.score > 0)
        .sort((a, b) => b.score - a.score)[0];
      rows.push({
        include: true,
        direction: "IN",
        date: dateIso,
        amount: amount.toFixed(2),
        payerNameRaw: r.partnerName ?? "",
        purposeRaw: r.purposeRaw,
        reference: r.bankReference ?? "",
        invoiceId: best && best.score >= 70 ? best.invoiceId : null,
        expenseId: null,
        categoryName: "",
        matchHint: best ? `${best.number} (${best.unitLabel}) — ${best.reasons.join(", ")}` : null,
      });
    } else if (r.debit.greaterThan(0)) {
      const amount = r.debit;
      const best = unpaidExpenses
        .map((e) => scoreExpenseMatch(e, { payerNameRaw: r.partnerName, purposeRaw: r.purposeRaw, amount }))
        .filter((s) => s.score > 0)
        .sort((a, b) => b.score - a.score)[0];
      rows.push({
        include: true,
        direction: "OUT",
        date: dateIso,
        amount: amount.toFixed(2),
        payerNameRaw: r.partnerName ?? "",
        purposeRaw: r.purposeRaw,
        reference: r.bankReference ?? "",
        invoiceId: null,
        expenseId: best && best.score >= 50 ? best.expenseId : null,
        categoryName: "",
        matchHint: best ? `${best.label} — ${best.reasons.join(", ")}` : null,
      });
    } else {
      skipped++;
    }
  }

  const accountDigits = (account.iban ?? "").replace(/\D/g, "");
  const statementDigits = (parsed.ownAccountNumber ?? "").replace(/\D/g, "");
  const accountMismatch = Boolean(accountDigits && statementDigits && accountDigits !== statementDigits);

  return {
    filename: input.filename,
    rawText: text,
    statementDateIso: parsed.statementDate ? dateIso : null,
    ownAccountNumber: parsed.ownAccountNumber,
    accountMismatch,
    rows,
    invoiceOptions,
    expenseOptions,
    skipped,
  };
}

/** Writes reviewed PDF-import rows (only rows the reviewer left checked). IN rows become
 *  Payments — allocated straight away when the reviewer accepted/chose an invoice, otherwise
 *  left unapplied for the usual "uparivanje" screen. OUT rows become expense-side
 *  FinTransactions, optionally settling a chosen Trošak (Expense). */
export async function commitPdfImport(
  actor: Actor,
  input: {
    accountId: string;
    filename: string;
    rawText: string;
    rows: {
      direction: "IN" | "OUT";
      date: string;
      amount: string;
      payerNameRaw: string;
      purposeRaw: string;
      reference: string;
      invoiceId?: string | null;
      expenseId?: string | null;
      categoryName?: string | null;
    }[];
  }
) {
  requireRole(actor, "ACCOUNTANT");
  if (input.rows.length === 0) throw new Error("Nema stavki za uvoz.");

  // Never partially commit a batch: if a chosen expense would end up overpaid, fail the
  // whole commit up front with a clear message so the reviewer can fix that one row.
  for (const r of input.rows) {
    if (r.direction === "OUT" && r.expenseId) {
      const exp = await prisma.expense.findUniqueOrThrow({ where: { id: r.expenseId } });
      const open = dec(exp.amount.toString()).minus(dec(exp.paidAmount.toString()));
      if (dec(r.amount).greaterThan(open)) {
        throw new Error(
          `Trošak "${exp.invoiceNumber ?? exp.id}" ima otvoreno ${open.toFixed(2)} KM, a stavka je ${dec(r.amount).toFixed(2)} KM — otkačite vezu ili ispravite iznos.`
        );
      }
    }
  }

  const batch = await prisma.$transaction(async (tx) => {
    const b = await tx.bankImportBatch.create({
      data: {
        filename: input.filename,
        mapping: { source: "pdf-nova-banka" } as unknown as Prisma.InputJsonValue,
        sourceType: "PDF",
        rawText: input.rawText,
        importedById: actor.userId,
      },
    });

    let importedIn = 0;
    let importedOut = 0;

    for (const r of input.rows) {
      const amount = dec(r.amount);
      if (amount.lessThanOrEqualTo(0)) throw new Error(`Neispravan iznos: "${r.amount}"`);
      const date = new Date(r.date);
      if (isNaN(date.getTime())) throw new Error(`Neispravan datum: "${r.date}"`);

      if (r.direction === "OUT") {
        let categoryId: string | null = null;
        const categoryName = r.categoryName?.trim();
        if (categoryName) {
          const cat = await tx.transactionCategory.upsert({
            where: { name: categoryName }, create: { name: categoryName, kind: "EXPENSE" }, update: {},
          });
          categoryId = cat.id;
        }
        const t = await tx.finTransaction.create({
          data: {
            accountId: input.accountId,
            date,
            type: "EXPENSE",
            amount: amount.toFixed(2),
            counterpartyName: r.payerNameRaw || null,
            categoryId,
            paymentMethod: "BANK",
            description: r.purposeRaw || `Uvoz PDF izvoda: ${input.filename}`,
            expenseId: r.expenseId || null,
            createdById: actor.userId,
          },
        });
        if (r.expenseId) {
          const exp = await tx.expense.findUniqueOrThrow({ where: { id: r.expenseId } });
          const newPaid = dec(exp.paidAmount.toString()).plus(amount);
          await tx.expense.update({
            where: { id: exp.id },
            data: {
              paidAmount: newPaid.toFixed(2),
              status: newPaid.greaterThanOrEqualTo(dec(exp.amount.toString())) ? "PAID" : "PARTIALLY_PAID",
              paidDate: date,
            },
          });
          await audit(actor, {
            action: "expense.pay", targetType: "Expense", targetId: exp.id,
            after: { amount: amount.toFixed(2), transactionId: t.id, source: "pdf_import" },
          }, tx);
        }
        importedOut++;
        continue;
      }

      const payment = await tx.payment.create({
        data: {
          accountId: input.accountId,
          date,
          amount: amount.toFixed(2),
          payerNameRaw: r.payerNameRaw || null,
          purposeRaw: r.purposeRaw || null,
          reference: r.reference || null,
          method: "BANK",
          importBatchId: b.id,
          createdById: actor.userId,
        },
      });
      await tx.finTransaction.create({
        data: {
          accountId: input.accountId,
          date,
          type: "INCOME",
          amount: amount.toFixed(2),
          counterpartyName: r.payerNameRaw || null,
          paymentMethod: "BANK",
          description: `Uvoz PDF izvoda: ${input.filename}`,
          paymentId: payment.id,
          createdById: actor.userId,
        },
      });
      if (r.invoiceId) {
        const invoice = await tx.invoice.findUnique({ where: { id: r.invoiceId }, include: { allocations: true } });
        if (invoice && invoice.status !== "CANCELLED" && invoice.status !== "DRAFT") {
          const invoicePaid = sumDecimals(invoice.allocations.map((a) => dec(a.amount.toString())));
          const invoiceOpen = dec(invoice.total.toString()).minus(invoicePaid);
          const allocAmount = invoiceOpen.lessThan(amount) ? invoiceOpen : amount;
          if (allocAmount.greaterThan(0)) {
            const alloc = await tx.paymentAllocation.create({
              data: {
                paymentId: payment.id, invoiceId: invoice.id, amount: allocAmount.toFixed(2),
                reason: "Automatski uparen pri uvozu PDF izvoda", createdById: actor.userId,
              },
            });
            await refreshInvoiceStatus(tx, invoice.id);
            await audit(actor, {
              action: "payment.allocate", targetType: "PaymentAllocation", targetId: alloc.id,
              after: { paymentId: payment.id, invoiceId: invoice.id, amount: allocAmount.toFixed(2), source: "pdf_import" },
            }, tx);
          }
        }
      }
      await refreshPaymentStatus(tx, payment.id);
      importedIn++;
    }

    await audit(actor, {
      action: "payment.import_pdf", targetType: "BankImportBatch", targetId: b.id,
      after: { filename: input.filename, importedIn, importedOut },
    }, tx);
    return b;
  }, { timeout: 30000 });

  return { batchId: batch.id, imported: input.rows.length };
}

// ---- Matching ----

/** Last run of digits in a unit label ("Stan 12" -> "12"). Units without a number in their
 *  label (e.g. "Potkrovlje") simply never match on this signal — safe by construction. */
function unitNumberFromLabel(label: string): string | null {
  const m = label.match(/(\d+)(?!.*\d)/);
  return m ? m[1] : null;
}

function nameMatchesText(nameLower: string, textLower: string): boolean {
  if (!nameLower) return false;
  return textLower.includes(nameLower) || nameLower.split(" ").every((part) => part && textLower.includes(part));
}

type OpenInvoiceCandidate = {
  inv: Prisma.InvoiceGetPayload<{ include: { allocations: true; debtor: true; unit: true } }>;
  open: Decimal;
};

/** All ISSUED invoices with a remaining open balance, for matching against payments (or,
 *  pre-commit, against parsed PDF rows that aren't Payments yet). */
async function fetchOpenInvoiceCandidates(): Promise<OpenInvoiceCandidate[]> {
  const openInvoices = await prisma.invoice.findMany({
    where: { status: "ISSUED" },
    include: { allocations: true, debtor: true, unit: true },
    orderBy: { number: "asc" },
  });
  const remaining = (inv: (typeof openInvoices)[number]) =>
    dec(inv.total.toString()).minus(sumDecimals(inv.allocations.map((a) => dec(a.amount.toString()))));
  return openInvoices
    .map((inv) => ({ inv, open: remaining(inv) }))
    .filter(({ open }) => open.greaterThan(0));
}

/** Scores one open invoice against a payment signal (reference, payer, purpose text, amount) —
 *  shared by suggestMatches() (an existing Payment) and importPdfPreview() (a parsed row that
 *  isn't a Payment yet). */
function scoreInvoiceMatch(
  inv: OpenInvoiceCandidate["inv"],
  open: Decimal,
  signal: { reference?: string | null; payerId?: string | null; payerNameRaw?: string | null; purposeRaw?: string | null; amount: Decimal }
) {
  let score = 0;
  const reasons: string[] = [];
  if (signal.reference && inv.paymentReference && signal.reference.includes(inv.paymentReference)) {
    score += 100; reasons.push("poziv na broj");
  }
  if (signal.payerId && signal.payerId === inv.debtorId) { score += 50; reasons.push("isti platilac"); }
  const dn = inv.debtor.kind === "PERSON"
    ? `${inv.debtor.firstName ?? ""} ${inv.debtor.lastName ?? ""}`.toLowerCase().trim()
    : (inv.debtor.orgName ?? "").toLowerCase().trim();
  if (signal.payerNameRaw && nameMatchesText(dn, signal.payerNameRaw.toLowerCase())) {
    score += 40; reasons.push("naziv platioca");
  }
  const unitCandidates = signal.purposeRaw ? extractUnitNumberCandidates(signal.purposeRaw) : null;
  if (unitCandidates) {
    const unitNo = unitNumberFromLabel(inv.unit.label);
    if (unitNo && unitCandidates.keyword.includes(unitNo)) {
      score += 70; reasons.push("broj stana u svrsi uplate");
    } else if (unitNo && unitCandidates.bare.includes(unitNo)) {
      score += 15; reasons.push("mogući broj stana u svrsi (provjeriti)");
    }
  }
  if (signal.purposeRaw && dn && nameMatchesText(dn, signal.purposeRaw.toLowerCase())) {
    score += 35; reasons.push("ime vlasnika pomenuto u svrsi uplate");
  }
  if (open.equals(signal.amount)) { score += 30; reasons.push("tačan iznos"); }
  return { invoiceId: inv.id, number: inv.number, unitLabel: inv.unit.label, open: open.toFixed(2), score, reasons };
}

/** Scores one open (unpaid/partially paid) expense against an outgoing bank-statement row —
 *  used to suggest which Trošak a PDF-imported isplata should settle. */
function scoreExpenseMatch(
  exp: Prisma.ExpenseGetPayload<{ include: { supplier: true } }>,
  signal: { payerNameRaw?: string | null; purposeRaw?: string | null; amount: Decimal }
) {
  let score = 0;
  const reasons: string[] = [];
  const open = dec(exp.amount.toString()).minus(dec(exp.paidAmount.toString()));
  const supplierLower = (exp.supplier?.name ?? "").toLowerCase().trim();
  const textLower = `${signal.payerNameRaw ?? ""} ${signal.purposeRaw ?? ""}`.toLowerCase();
  if (supplierLower && nameMatchesText(supplierLower, textLower)) { score += 40; reasons.push("naziv dobavljača"); }
  if (exp.invoiceNumber && textLower.includes(exp.invoiceNumber.toLowerCase())) {
    score += 50; reasons.push("broj fakture dobavljača");
  }
  if (open.equals(signal.amount)) { score += 30; reasons.push("tačan iznos"); }
  const label = `${exp.supplier?.name ?? "bez dobavljača"}${exp.invoiceNumber ? " — " + exp.invoiceNumber : ""} — otvoreno ${open.toFixed(2)} KM`;
  return { expenseId: exp.id, label, open: open.toFixed(2), score, reasons };
}

/** Suggest invoices for an unapplied payment (by reference, payer, amount, and — for
 *  statements where the payment purpose carries a unit number or the real owner's name —
 *  by what the payer actually wrote in "svrha uplate"). */
export async function suggestMatches(actor: Actor, paymentId: string) {
  requireRole(actor, "ACCOUNTANT");
  const payment = await prisma.payment.findUniqueOrThrow({ where: { id: paymentId }, include: { payer: true } });
  const candidates = await fetchOpenInvoiceCandidates();
  const signal = {
    reference: payment.reference,
    payerId: payment.payerId,
    payerNameRaw: payment.payerNameRaw,
    purposeRaw: payment.purposeRaw,
    amount: dec(payment.amount.toString()),
  };
  const scored = candidates.map(({ inv, open }) => scoreInvoiceMatch(inv, open, signal));
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
