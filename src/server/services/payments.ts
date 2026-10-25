// Payments, CSV bank import, allocation to invoices, reversals, owner balances.
// PaymentAllocation rows are append-only (DB trigger); reversals are negative rows.
import { createHash } from "node:crypto";
import { prisma } from "@/lib/prisma";
import { audit } from "@/server/audit";
import { requireRole, requireSelfOrRole, requireAnyUser, requireZev, type Actor } from "@/server/auth/guards";
import { dec, ZERO, sumDecimals, type Decimal } from "@/lib/money";
import type { Prisma, PaymentStatus } from "@/generated/prisma/client";
import { extractPdfText, parseNovaBankaStatement, extractUnitNumberCandidates } from "@/server/services/bankStatementPdf";
import { partyDisplayName } from "@/server/services/ownership";
import { foldDiacritics } from "@/lib/text";

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
  const zevId = requireZev(actor);
  if (dec(data.amount).lessThanOrEqualTo(0)) throw new Error("Iznos uplate mora biti pozitivan.");
  await prisma.moneyAccount.findUniqueOrThrow({ where: { id: data.accountId, zevId } });
  if (data.payerId) await prisma.party.findUniqueOrThrow({ where: { id: data.payerId, zevId } });
  const p = await prisma.$transaction(async (tx) => {
    const payment = await tx.payment.create({
      data: {
        zevId,
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
        zevId,
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
  const zevId = requireZev(actor);
  await prisma.moneyAccount.findUniqueOrThrow({ where: { id: input.accountId, zevId } });
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
        zevId,
        filename: input.filename,
        mapping: mapping as unknown as Prisma.InputJsonValue,
        importedById: actor.userId,
      },
    });
    for (const r of rows) {
      const payment = await tx.payment.create({
        data: {
          zevId,
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
          zevId,
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
  /** This row was already booked from a confirmed SMS notification (Plans/bank-sms-ingestion-plan.md
   *  O4) — it arrives un-ticked so the same money is not booked twice; the reviewer can re-tick it. */
  duplicateOf: { smsId: string; paymentId: string | null; transactionId: string | null } | null;
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
  const zevId = requireZev(actor);
  const account = await prisma.moneyAccount.findUniqueOrThrow({ where: { id: input.accountId, zevId } });
  const text = await extractPdfText(input.buffer);
  const parsed = parseNovaBankaStatement(text);

  const invoiceCandidates = await fetchOpenInvoiceCandidates(zevId);
  const invoiceOptions = invoiceCandidates.map(({ inv, open }) => ({
    id: inv.id,
    label: `${inv.number} — ${partyDisplayName(inv.debtor)} (${inv.unit.label}) — otvoreno ${open.toFixed(2)} KM`,
  }));

  const unpaidExpenses = await prisma.expense.findMany({
    where: { zevId, status: { in: ["UNPAID", "PARTIALLY_PAID"] } },
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
  const partnerAccounts: (string | null)[] = []; // parallel to `rows`, for the SMS de-duplication below
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
        duplicateOf: null,
      });
      partnerAccounts.push(r.partnerAccount);
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
        duplicateOf: null,
      });
      partnerAccounts.push(r.partnerAccount);
    } else {
      skipped++;
    }
  }

  await markRowsAlreadyBookedFromSms(zevId, input.accountId, parsed.statementDate, rows, partnerAccounts);

  const accountDigits = (account.iban ?? "").replace(/\D/g, "");
  const statementDigits = (parsed.ownAccountNumber ?? "").replace(/\D/g, "");
  const accountMismatch = Boolean(accountDigits && statementDigits && !accountDigitsMatch(accountDigits, statementDigits));

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

/**
 * Un-ticks statement-preview rows that were already booked from a CONFIRMED SMS notification
 * (Plans/bank-sms-ingestion-plan.md, O4): same account, same amount, same direction, the other
 * party's account agrees (or is unknown on either side), and the SMS was received within a couple
 * of days of the statement date. One SMS accounts for at most one statement row. The reviewer can
 * still re-tick a row. Mutates `rows` in place; `partnerAccounts` is parallel to `rows`.
 */
export async function markRowsAlreadyBookedFromSms(
  zevId: string,
  accountId: string,
  statementDate: Date | null,
  rows: PdfPreviewRow[],
  partnerAccounts: (string | null)[]
): Promise<void> {
  if (!statementDate || rows.length === 0) return;
  const day = 86400000;
  const smsPool = await prisma.incomingBankSms.findMany({
    where: {
      zevId,
      accountId,
      status: "CONFIRMED",
      receivedAt: { gte: new Date(statementDate.getTime() - 2 * day), lt: new Date(statementDate.getTime() + 3 * day) },
    },
  });
  rows.forEach((row, i) => {
    const wantKind = row.direction === "IN" ? "PRILIV" : "ODLIV";
    const hit = smsPool.findIndex(
      (s) =>
        s.kind === wantKind &&
        s.amount != null &&
        dec(s.amount.toString()).equals(dec(row.amount)) &&
        (!s.counterpartyAccount || !partnerAccounts[i] || accountDigitsMatch(s.counterpartyAccount, partnerAccounts[i]))
    );
    if (hit < 0) return;
    const [sms] = smsPool.splice(hit, 1);
    row.include = false;
    row.duplicateOf = { smsId: sms.id, paymentId: sms.paymentId, transactionId: sms.transactionId };
  });
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
    rows: StatementRowInput[];
    /** SMS ids from `PdfPreviewRow.duplicateOf` of rows the reviewer LEFT UN-TICKED: the statement
     *  confirms those already-booked SMS records, and that link is kept (BankRecordMatch,
     *  Plans/sms-statement-payment-matching-plan.md R2). Re-checked server-side. */
    skippedSmsIds?: string[];
  }
) {
  requireRole(actor, "ACCOUNTANT");
  const zevId = requireZev(actor);
  const skippedSmsIds = input.skippedSmsIds ?? [];
  if (input.rows.length === 0 && skippedSmsIds.length === 0) throw new Error("Nema stavki za uvoz.");
  await prisma.moneyAccount.findUniqueOrThrow({ where: { id: input.accountId, zevId } });
  await assertStatementRowsCommittable(zevId, input.rows);

  const batch = await prisma.$transaction(
    async (tx) => {
      const res = await commitStatementRowsInTx(tx, actor, zevId, { source: "PDF", ...input });
      const linked = await recordStatementSkipsInTx(tx, actor, zevId, {
        accountId: input.accountId,
        batchId: res.batchId,
        smsIds: skippedSmsIds,
      });
      return { ...res, linked };
    },
    { timeout: 30000 }
  );
  return { batchId: batch.batchId, imported: input.rows.length, linkedToSms: batch.linked };
}

// ---- Several PDF statements at once (v2.39.0) ----
// The single-statement functions above stay as they are; these run them for a batch of files and
// add what only matters across files: the same file chosen twice, a statement imported before,
// and one SMS matching rows in two different statements.

export const MAX_PDF_STATEMENTS_PER_IMPORT = 31;

export type PdfStatementPreview = PdfImportPreview & {
  sha256: string;
  /** A statement with exactly this text was imported before (ISO time) — its rows arrive un-ticked. */
  alreadyImportedAt: string | null;
};

export async function importPdfPreviews(
  actor: Actor,
  input: { accountId: string; files: { filename: string; buffer: Buffer }[] }
): Promise<{ previews: PdfStatementPreview[]; failures: { filename: string; error: string }[] }> {
  requireRole(actor, "ACCOUNTANT");
  const zevId = requireZev(actor);
  if (input.files.length === 0) throw new Error("Odaberite bar jedan PDF izvod.");
  if (input.files.length > MAX_PDF_STATEMENTS_PER_IMPORT) {
    throw new Error(`Najviše ${MAX_PDF_STATEMENTS_PER_IMPORT} izvoda odjednom.`);
  }

  const previews: PdfStatementPreview[] = [];
  const failures: { filename: string; error: string }[] = [];
  const seenSha = new Set<string>();
  for (const f of input.files) {
    const sha256 = createHash("sha256").update(f.buffer).digest("hex");
    if (seenSha.has(sha256)) {
      failures.push({ filename: f.filename, error: "Isti fajl je izabran više puta." });
      continue;
    }
    seenSha.add(sha256);
    try {
      const p = await importPdfPreview(actor, { accountId: input.accountId, filename: f.filename, buffer: f.buffer });
      if (p.rows.length === 0) {
        failures.push({ filename: f.filename, error: "Nije prepoznata nijedna stavka (provjerite da li je ovo izvod banke)." });
        continue;
      }
      const earlier = await prisma.bankImportBatch.findFirst({
        where: { zevId, sourceType: "PDF", rawText: p.rawText },
        orderBy: { importedAt: "desc" },
        select: { importedAt: true },
      });
      if (earlier) for (const r of p.rows) r.include = false;
      previews.push({ ...p, sha256, alreadyImportedAt: earlier ? earlier.importedAt.toISOString() : null });
    } catch (e) {
      failures.push({ filename: f.filename, error: e instanceof Error ? e.message : "Greška pri čitanju PDF-a." });
    }
  }

  previews.sort((a, b) => (a.statementDateIso ?? "").localeCompare(b.statementDateIso ?? ""));
  // One SMS accounts for at most one statement row across ALL the statements (each preview only
  // de-duplicated within itself). A later match is not that SMS after all: tick it back.
  const usedSms = new Set<string>();
  for (const p of previews) {
    for (const r of p.rows) {
      if (!r.duplicateOf) continue;
      if (usedSms.has(r.duplicateOf.smsId)) {
        r.duplicateOf = null;
        r.include = !p.alreadyImportedAt;
      } else {
        usedSms.add(r.duplicateOf.smsId);
      }
    }
  }
  return { previews, failures };
}

/** Writes several reviewed statements at once — each as its own BankImportBatch, exactly as
 *  commitPdfImport would — inside ONE transaction, so a failing statement books nothing. */
export async function commitPdfImports(
  actor: Actor,
  input: {
    accountId: string;
    statements: { filename: string; rawText: string; rows: StatementRowInput[]; skippedSmsIds?: string[] }[];
  }
) {
  requireRole(actor, "ACCOUNTANT");
  const zevId = requireZev(actor);
  const statements = input.statements.filter((st) => st.rows.length > 0 || (st.skippedSmsIds ?? []).length > 0);
  if (statements.length === 0) throw new Error("Nema stavki za uvoz.");
  await prisma.moneyAccount.findUniqueOrThrow({ where: { id: input.accountId, zevId } });
  await assertStatementRowsCommittable(zevId, statements.flatMap((st) => st.rows));

  const result = await prisma.$transaction(
    async (tx) => {
      let imported = 0;
      let linkedToSms = 0;
      for (const st of statements) {
        const res = await commitStatementRowsInTx(tx, actor, zevId, {
          source: "PDF",
          accountId: input.accountId,
          filename: st.filename,
          rawText: st.rawText,
          rows: st.rows,
        });
        linkedToSms += await recordStatementSkipsInTx(tx, actor, zevId, {
          accountId: input.accountId,
          batchId: res.batchId,
          smsIds: st.skippedSmsIds ?? [],
        });
        imported += st.rows.length;
      }
      return { imported, linkedToSms };
    },
    { timeout: 60000 }
  );
  return { ...result, statements: statements.length };
}

/** Links PDF-statement rows the reviewer left un-ticked as "already booked from SMS" to that SMS
 *  (BankRecordMatch SAME / IMPORT_SKIP — Plans/sms-statement-payment-matching-plan.md R2). Never
 *  trusts the client: only CONFIRMED SMS of this ZEV on the same account count, and an SMS that
 *  already has a SAME link is not linked again. Returns how many links were written. */
export async function recordStatementSkipsInTx(
  tx: Prisma.TransactionClient,
  actor: Actor,
  zevId: string,
  input: { accountId: string; batchId: string; smsIds: string[] }
): Promise<number> {
  const ids = [...new Set(input.smsIds)];
  if (ids.length === 0) return 0;
  const sms = await tx.incomingBankSms.findMany({
    where: { id: { in: ids }, zevId, accountId: input.accountId, status: "CONFIRMED", matches: { none: { decision: "SAME" } } },
    select: { id: true },
  });
  for (const s of sms) {
    const m = await tx.bankRecordMatch.create({
      data: { zevId, smsId: s.id, statementBatchId: input.batchId, decision: "SAME", origin: "IMPORT_SKIP", createdById: actor.userId },
    });
    await audit(actor, {
      action: "bank_match.link", targetType: "BankRecordMatch", targetId: m.id,
      after: { smsId: s.id, statementBatchId: input.batchId, origin: "IMPORT_SKIP" },
    }, tx);
  }
  return sms.length;
}

/** One reviewed bank-statement row, as confirmed by a human — shared by the PDF import and the
 *  SMS confirmation (Plans/bank-sms-ingestion-plan.md), which book through the same code. */
export type StatementRowInput = {
  direction: "IN" | "OUT";
  date: string;
  amount: string;
  payerNameRaw: string;
  purposeRaw: string;
  reference: string;
  invoiceId?: string | null;
  expenseId?: string | null;
  categoryName?: string | null;
};

/** What a committed row became: an IN row -> a Payment, an OUT row -> an expense-side FinTransaction. */
export type CommittedStatementRow = { paymentId: string | null; transactionId: string | null };

/** Never partially commit a batch: if a chosen expense would end up overpaid, fail the whole
 *  commit up front with a clear message so the reviewer can fix that one row. Callers run this
 *  BEFORE opening the transaction, with the actor's own zevId. */
export async function assertStatementRowsCommittable(zevId: string, rows: StatementRowInput[]) {
  for (const r of rows) {
    if (r.direction === "OUT" && r.expenseId) {
      const exp = await prisma.expense.findUniqueOrThrow({ where: { id: r.expenseId, zevId } });
      const open = dec(exp.amount.toString()).minus(dec(exp.paidAmount.toString()));
      if (dec(r.amount).greaterThan(open)) {
        throw new Error(
          `Trošak "${exp.invoiceNumber ?? exp.id}" ima otvoreno ${open.toFixed(2)} KM, a stavka je ${dec(r.amount).toFixed(2)} KM — otkačite vezu ili ispravite iznos.`
        );
      }
    }
  }
}

/**
 * Writes reviewed statement rows inside the CALLER's transaction (so the SMS confirmation can
 * flip its queue rows to CONFIRMED atomically with the booking). Extracted from the original
 * commitPdfImport body without changing its behaviour; `source` only selects labels
 * (batch sourceType/mapping, descriptions, audit action/`source`). The caller must have
 * checked the role, the account (and that it belongs to `zevId`) and assertStatementRowsCommittable.
 */
export async function commitStatementRowsInTx(
  tx: Prisma.TransactionClient,
  actor: Actor,
  zevId: string,
  input: {
    source: "PDF" | "SMS";
    accountId: string;
    filename: string;
    rawText: string;
    rows: StatementRowInput[];
    /** SMS only: the IncomingBankSms ids this batch was booked from (kept in the audit trail). */
    smsIds?: string[];
  }
): Promise<{ batchId: string; importedIn: number; importedOut: number; committed: CommittedStatementRow[] }> {
  const isPdf = input.source === "PDF";
  const sourceLabel = isPdf ? "pdf_import" : "sms_import";
  const b = await tx.bankImportBatch.create({
    data: {
      zevId,
      filename: input.filename,
      mapping: { source: isPdf ? "pdf-nova-banka" : "sms-nova-banka" } as unknown as Prisma.InputJsonValue,
      sourceType: input.source,
      rawText: input.rawText,
      importedById: actor.userId,
    },
  });

  let importedIn = 0;
  let importedOut = 0;
  const committed: CommittedStatementRow[] = [];

  for (const r of input.rows) {
    const amount = dec(r.amount);
    if (amount.lessThanOrEqualTo(0)) throw new Error(`Neispravan iznos: "${r.amount}"`);
    const date = new Date(r.date);
    if (isNaN(date.getTime())) throw new Error(`Neispravan datum: "${r.date}"`);

    if (r.direction === "OUT") {
      let categoryId: string | null = null;
      const categoryName = r.categoryName?.trim();
      if (categoryName) {
        const existingCat = await tx.transactionCategory.findFirst({ where: { zevId, name: categoryName } });
        const cat = existingCat ?? await tx.transactionCategory.create({ data: { zevId, name: categoryName, kind: "EXPENSE" } });
        categoryId = cat.id;
      }
      const t = await tx.finTransaction.create({
        data: {
          zevId,
          accountId: input.accountId,
          date,
          type: "EXPENSE",
          amount: amount.toFixed(2),
          counterpartyName: r.payerNameRaw || null,
          categoryId,
          paymentMethod: "BANK",
          description: r.purposeRaw || (isPdf ? `Uvoz PDF izvoda: ${input.filename}` : "SMS obavještenje banke"),
          expenseId: r.expenseId || null,
          createdById: actor.userId,
        },
      });
      if (r.expenseId) {
        const exp = await tx.expense.findUniqueOrThrow({ where: { id: r.expenseId, zevId } });
        const newPaid = dec(exp.paidAmount.toString()).plus(amount);
        await tx.expense.update({
          where: { id: exp.id, zevId },
          data: {
            paidAmount: newPaid.toFixed(2),
            status: newPaid.greaterThanOrEqualTo(dec(exp.amount.toString())) ? "PAID" : "PARTIALLY_PAID",
            paidDate: date,
          },
        });
        await audit(actor, {
          action: "expense.pay", targetType: "Expense", targetId: exp.id,
          after: { amount: amount.toFixed(2), transactionId: t.id, source: sourceLabel },
        }, tx);
      }
      importedOut++;
      committed.push({ paymentId: null, transactionId: t.id });
      continue;
    }

    const payment = await tx.payment.create({
      data: {
        zevId,
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
        zevId,
        accountId: input.accountId,
        date,
        type: "INCOME",
        amount: amount.toFixed(2),
        counterpartyName: r.payerNameRaw || null,
        paymentMethod: "BANK",
        description: isPdf ? `Uvoz PDF izvoda: ${input.filename}` : "Uplata vlasnika (SMS obavještenje banke)",
        paymentId: payment.id,
        createdById: actor.userId,
      },
    });
    if (r.invoiceId) {
      const invoice = await tx.invoice.findUnique({ where: { id: r.invoiceId, zevId }, include: { allocations: true } });
      if (invoice && invoice.status !== "CANCELLED" && invoice.status !== "DRAFT") {
        const invoicePaid = sumDecimals(invoice.allocations.map((a) => dec(a.amount.toString())));
        const invoiceOpen = dec(invoice.total.toString()).minus(invoicePaid);
        const allocAmount = invoiceOpen.lessThan(amount) ? invoiceOpen : amount;
        if (allocAmount.greaterThan(0)) {
          const alloc = await tx.paymentAllocation.create({
            data: {
              paymentId: payment.id, invoiceId: invoice.id, amount: allocAmount.toFixed(2),
              reason: isPdf ? "Automatski uparen pri uvozu PDF izvoda" : "Uparen pri potvrdi SMS obavještenja banke",
              createdById: actor.userId,
            },
          });
          await refreshInvoiceStatus(tx, zevId, invoice.id);
          await audit(actor, {
            action: "payment.allocate", targetType: "PaymentAllocation", targetId: alloc.id,
            after: { paymentId: payment.id, invoiceId: invoice.id, amount: allocAmount.toFixed(2), source: sourceLabel },
          }, tx);
        }
      }
    }
    await refreshPaymentStatus(tx, zevId, payment.id);
    importedIn++;
    committed.push({ paymentId: payment.id, transactionId: null });
  }

  await audit(actor, {
    action: isPdf ? "payment.import_pdf" : "payment.import_sms", targetType: "BankImportBatch", targetId: b.id,
    after: { filename: input.filename, importedIn, importedOut, ...(input.smsIds ? { smsIds: input.smsIds } : {}) },
  }, tx);
  return { batchId: b.id, importedIn, importedOut, committed };
}

// ---- Matching ----

/** Last run of digits in a unit label ("Stan 12" -> "12"). Units without a number in their
 *  label (e.g. "Potkrovlje") simply never match on this signal — safe by construction. */
function unitNumberFromLabel(label: string): string | null {
  const m = label.match(/(\d+)(?!.*\d)/);
  return m ? m[1] : null;
}

/** Does `textLower` mention the name `nameLower`? Compared with diacritics folded on both sides:
 *  banks print "ZELJKO GALIC" for "Željko Galić" (and "DJURIC" or "DURIC" for "Đurić"), which a
 *  plain lower-case comparison never matched — found while designing the SMS import
 *  (Plans/bank-sms-ingestion-plan.md), and it equally affected PDF statement matching. */
export function nameMatchesText(nameLower: string, textLower: string): boolean {
  if (!nameLower) return false;
  return (["dj", "d"] as const).some((mode) => {
    const name = foldDiacritics(nameLower, mode);
    const text = foldDiacritics(textLower, mode);
    return text.includes(name) || name.split(" ").every((part) => part && text.includes(part));
  });
}

/** Do two account numbers denote the same account? Banks print them with dashes in one place
 *  ("555-10000515469-32") and bare digits in another ("5551000051546932"). */
export function accountDigitsMatch(a: string | null | undefined, b: string | null | undefined): boolean {
  const da = (a ?? "").replace(/\D/g, "");
  const db = (b ?? "").replace(/\D/g, "");
  return Boolean(da && db && da === db);
}

export type OpenInvoiceCandidate = {
  inv: Prisma.InvoiceGetPayload<{ include: { allocations: true; debtor: true; unit: true } }>;
  open: Decimal;
};

/** All ISSUED invoices with a remaining open balance, for matching against payments (or,
 *  pre-commit, against parsed PDF rows that aren't Payments yet). Callers must pass the
 *  actor's own zevId — never a caller-supplied one — see requireZev(). */
export async function fetchOpenInvoiceCandidates(zevId: string): Promise<OpenInvoiceCandidate[]> {
  const openInvoices = await prisma.invoice.findMany({
    where: { zevId, status: "ISSUED" },
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
export function scoreInvoiceMatch(
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
export function scoreExpenseMatch(
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
  // Matches PaymentDetailPage's own access level (ACCOUNTANT or PRESIDENT) — it calls
  // this unconditionally for any unmatched/partially-applied payment with a free
  // balance, so requiring ACCOUNTANT alone here crashed the page for a president-only
  // account with a raw ForbiddenError (reported in production, 2026-09-17).
  requireRole(actor, "ACCOUNTANT", "PRESIDENT");
  const zevId = requireZev(actor);
  const payment = await prisma.payment.findUniqueOrThrow({ where: { id: paymentId, zevId }, include: { payer: true } });
  const candidates = await fetchOpenInvoiceCandidates(zevId);
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

/** Callers must pass the actor's own zevId — never a caller-supplied one. */
export async function refreshPaymentStatus(tx: Prisma.TransactionClient, zevId: string, paymentId: string) {
  const payment = await tx.payment.findUniqueOrThrow({ where: { id: paymentId, zevId }, include: { allocations: true } });
  const allocated = sumDecimals(payment.allocations.map((a) => dec(a.amount.toString())));
  const amount = dec(payment.amount.toString());
  const status = payment.reversedAt
    ? "REVERSED"
    : allocated.isZero()
      ? "UNAPPLIED"
      : allocated.greaterThanOrEqualTo(amount)
        ? "APPLIED"
        : "PARTIALLY_APPLIED";
  await tx.payment.update({ where: { id: paymentId, zevId }, data: { status } });
  return { allocated, amount };
}

/** Callers must pass the actor's own zevId — never a caller-supplied one. */
export async function refreshInvoiceStatus(tx: Prisma.TransactionClient, zevId: string, invoiceId: string) {
  const inv = await tx.invoice.findUniqueOrThrow({ where: { id: invoiceId, zevId }, include: { allocations: true } });
  if (inv.status === "CANCELLED" || inv.status === "CORRECTED" || inv.status === "DRAFT") return;
  const paid = sumDecimals(inv.allocations.map((a) => dec(a.amount.toString())));
  const status = paid.greaterThanOrEqualTo(dec(inv.total.toString())) && !dec(inv.total.toString()).isZero() ? "PAID" : "ISSUED";
  await tx.invoice.update({ where: { id: invoiceId, zevId }, data: { status } });
}

/**
 * Allocate (part of) a payment to an invoice. One payment may cover several
 * invoices and several payments may cover one invoice. Overpayment beyond the
 * invoice total is rejected — the surplus stays as an unapplied advance.
 */
export async function allocatePayment(
  actor: Actor,
  data: { paymentId: string; invoiceId: string; amount?: string; reason?: string }
) {
  requireRole(actor, "ACCOUNTANT");
  const zevId = requireZev(actor);
  // `amount` omitted = "as much as possible": min(free part of the payment, open part of the
  // invoice), resolved inside the transaction against the same rows the checks below use.
  const requested = data.amount === undefined || data.amount.trim() === "" ? null : dec(data.amount);
  if (requested && requested.lessThanOrEqualTo(0)) throw new Error("Iznos alokacije mora biti pozitivan.");
  return prisma.$transaction(async (tx) => {
    const payment = await tx.payment.findUniqueOrThrow({ where: { id: data.paymentId, zevId }, include: { allocations: true } });
    if (payment.reversedAt) throw new Error("Stornirana uplata se ne može raspoređivati.");
    const invoice = await tx.invoice.findUniqueOrThrow({ where: { id: data.invoiceId, zevId }, include: { allocations: true } });
    if (invoice.status === "CANCELLED" || invoice.status === "DRAFT") throw new Error("Faktura nije raspoloživa za uplate.");

    const paymentAllocated = sumDecimals(payment.allocations.map((a) => dec(a.amount.toString())));
    const paymentFree = dec(payment.amount.toString()).minus(paymentAllocated);
    const invoicePaid = sumDecimals(invoice.allocations.map((a) => dec(a.amount.toString())));
    const invoiceOpen = dec(invoice.total.toString()).minus(invoicePaid);
    const amount = requested ?? (paymentFree.lessThan(invoiceOpen) ? paymentFree : invoiceOpen);
    if (amount.lessThanOrEqualTo(0)) throw new Error("Iznos alokacije mora biti pozitivan.");
    if (amount.greaterThan(paymentFree)) {
      throw new Error(`Uplata ima raspoloživo ${paymentFree.toFixed(2)} KM.`);
    }
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
    await refreshPaymentStatus(tx, zevId, data.paymentId);
    await refreshInvoiceStatus(tx, zevId, data.invoiceId);
    await audit(actor, {
      action: "payment.allocate", targetType: "PaymentAllocation", targetId: alloc.id,
      after: { paymentId: data.paymentId, invoiceId: data.invoiceId, amount: amount.toFixed(2) },
    }, tx);
    return alloc;
  });
}

/** Reverse an allocation: append-only negative allocation row.
 *  PaymentAllocation has no zevId column of its own (see prisma/schema.prisma) — tenant
 *  ownership is checked indirectly through the allocation's parent Payment. */
export async function reverseAllocation(actor: Actor, allocationId: string, reason: string) {
  requireRole(actor, "ACCOUNTANT");
  const zevId = requireZev(actor);
  if (!reason.trim()) throw new Error("Storniranje alokacije zahtijeva razlog.");
  return prisma.$transaction(async (tx) => {
    const orig = await tx.paymentAllocation.findUniqueOrThrow({ where: { id: allocationId }, include: { payment: true } });
    if (orig.payment.zevId !== zevId) throw new Error("Alokacija nije pronađena.");
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
    await refreshPaymentStatus(tx, zevId, orig.paymentId);
    await refreshInvoiceStatus(tx, zevId, orig.invoiceId);
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
  const zevId = requireZev(actor);
  if (!reason.trim()) throw new Error("Storniranje uplate zahtijeva razlog.");
  return prisma.$transaction((tx) => reversePaymentInTx(tx, actor, zevId, paymentId, reason));
}

/** reversePayment() inside the CALLER's transaction (the SMS ↔ izvod merge reverses the duplicate
 *  and re-allocates the survivor atomically). The caller must have checked the role and pass the
 *  actor's own zevId. */
export async function reversePaymentInTx(
  tx: Prisma.TransactionClient,
  actor: Actor,
  zevId: string,
  paymentId: string,
  reason: string
) {
  const payment = await tx.payment.findUniqueOrThrow({ where: { id: paymentId, zevId }, include: { allocations: true, transaction: true } });
  if (payment.reversedAt) throw new Error("Uplata je već stornirana.");
  // Reverse outstanding allocations.
  const net = netAllocationsByInvoice(payment.allocations);
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
      await refreshInvoiceStatus(tx, zevId, invoiceId);
    }
  }
  const updated = await tx.payment.update({
    where: { id: paymentId, zevId },
    data: { reversedAt: new Date(), reversalReason: reason, status: "REVERSED" },
  });
  if (payment.transaction) {
    await tx.finTransaction.update({
      where: { id: payment.transaction.id, zevId },
      data: { status: "CANCELLED", cancelledAt: new Date(), cancelReason: `Storno uplate: ${reason}` },
    });
  }
  await audit(actor, {
    action: "payment.reverse", targetType: "Payment", targetId: paymentId,
    before: { amount: payment.amount.toString(), status: payment.status },
    reason,
  }, tx);
  return updated;
}

/** Net allocated amount per invoice (original rows minus their append-only reversal rows). */
export function netAllocationsByInvoice(allocations: { invoiceId: string; amount: { toString(): string } }[]): Map<string, Decimal> {
  const net = new Map<string, Decimal>();
  for (const a of allocations) {
    const cur = net.get(a.invoiceId) ?? ZERO;
    net.set(a.invoiceId, cur.plus(dec(a.amount.toString())));
  }
  return net;
}

export type PaymentSortKey = "date" | "amount";

/** Filteri liste uplata koji nisu status u bazi (F5a, F5-Q3 (a)). Isti uslov koristi i lista i brojač na početnoj
 *  računovođe, pa se brojevi uvijek poklapaju. */
export const PAYMENT_FILTER_TO_MATCH = "ZA_UPARIVANJE";
export const PAYMENT_FILTER_ADVANCE = "AVANS";

/** Platilac ima bar jednu otvorenu fakturu (izdata, ukupno > 0; faktura se plaćenom označava u `refreshInvoiceStatus`). */
const payerHasOpenInvoice = { invoices: { some: { status: "ISSUED" as const, total: { gt: 0 } } } };

/**
 * Where za listu uplata po statusu filtera.
 *  - `ZA_UPARIVANJE`: neraspoređene/djelimično raspoređene uplate koje NISU avans — platilac nepoznat ili ima otvorenih
 *    faktura (posao računovođe).
 *  - `AVANS`: ista skupina uplata, ali platilac je poznat i nema nijednu otvorenu fakturu — nema šta da se upari dok se
 *    ne izda nova faktura (izvedeno pravilo, bez migracije: izdavanjem fakture uplata sama prelazi u „za uparivanje”).
 *  - drugo: status u bazi kao do sada.
 * `zevId` je uvijek dio uslova.
 */
export function paymentWhereForFilter(zevId: string, status?: string): Prisma.PaymentWhereInput {
  const free = { zevId, reversedAt: null, status: { in: ["UNAPPLIED", "PARTIALLY_APPLIED"] as PaymentStatus[] } };
  if (status === PAYMENT_FILTER_TO_MATCH) {
    return { ...free, OR: [{ payerId: null }, { payer: payerHasOpenInvoice }] };
  }
  if (status === PAYMENT_FILTER_ADVANCE) {
    return { ...free, payerId: { not: null }, payer: { is: { invoices: { none: payerHasOpenInvoice.invoices.some } } } };
  }
  return { zevId, status: (status || undefined) as PaymentStatus | undefined };
}

/** Broj uplata „za uparivanje” (isti uslov kao filter `ZA_UPARIVANJE`). Pozivalac prosljeđuje zevId aktera. */
export function countPaymentsToMatch(zevId: string): Promise<number> {
  return prisma.payment.count({ where: paymentWhereForFilter(zevId, PAYMENT_FILTER_TO_MATCH) });
}

/** Avansi: broj uplata i ukupan slobodan (neraspoređen) iznos — isti uslov kao filter `AVANS`. */
export async function advanceSummary(zevId: string): Promise<{ count: number; total: string }> {
  const rows = await prisma.payment.findMany({
    where: paymentWhereForFilter(zevId, PAYMENT_FILTER_ADVANCE),
    select: { amount: true, allocations: { select: { amount: true } } },
  });
  let total = ZERO;
  for (const p of rows) {
    total = total.plus(dec(p.amount.toString()).minus(sumDecimals(p.allocations.map((a) => dec(a.amount.toString())))));
  }
  return { count: rows.length, total: total.toFixed(2) };
}

const PAYMENT_PAGE_SIZE = 20;

/** `sortBy`/`page` — same deliberate §8 exception as `listInvoices` (Plans/
 *  ui-ux-redesign-plan.md §3.H, option C+D). */
export async function listPayments(
  actor: Actor,
  filter?: { status?: string; payerId?: string },
  opts?: { sortBy?: PaymentSortKey; sortDir?: "asc" | "desc"; page?: number }
) {
  requireAnyUser(actor);
  const zevId = requireZev(actor);
  const isManagement = actor.roles.includes("PRESIDENT") || actor.roles.includes("ACCOUNTANT");
  const payerId = isManagement ? filter?.payerId : actor.partyId ?? "__none__";
  const where: Prisma.PaymentWhereInput = {
    ...paymentWhereForFilter(zevId, filter?.status),
    ...(payerId ? { payerId } : {}),
  };
  const dir = opts?.sortDir ?? "desc";
  const orderBy: Prisma.PaymentOrderByWithRelationInput = opts?.sortBy === "amount" ? { amount: dir } : { date: dir };
  const page = Math.max(1, opts?.page ?? 1);
  const [rows, total] = await Promise.all([
    prisma.payment.findMany({
      where,
      include: { payer: true, account: true, allocations: { include: { invoice: true } } },
      orderBy,
      skip: (page - 1) * PAYMENT_PAGE_SIZE,
      take: PAYMENT_PAGE_SIZE,
    }),
    prisma.payment.count({ where }),
  ]);
  return { rows, page, pageCount: Math.max(1, Math.ceil(total / PAYMENT_PAGE_SIZE)) };
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
  const zevId = requireZev(actor);
  const dateFilter = asOf ? { lte: asOf } : undefined;
  const invoices = await prisma.invoice.findMany({
    where: { zevId, debtorId: partyId, status: { in: ["ISSUED", "PAID"] }, issueDate: dateFilter },
    include: { allocations: asOf ? { where: { createdAt: { lte: asOf } } } : true },
  });
  const charged = sumDecimals(invoices.map((i) => dec(i.total.toString())));
  const paid = sumDecimals(invoices.flatMap((i) => i.allocations.map((a) => dec(a.amount.toString()))));
  const correctionsRows = await prisma.balanceCorrection.findMany({
    where: { zevId, partyId, createdAt: dateFilter },
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

/**
 * Owner balance as of a given day, split into the balance carried over from
 * before that day ("prethodni saldo") and the charges/payments/corrections
 * booked on that specific calendar day — for the "Dugovanja po vlasnicima"
 * statement, where an accountant needs to see the running balance even on a
 * day with no activity, not just that day's transactions.
 *
 * `asOf` must be an end-of-day Date for the chosen day (see `endOfDay` in
 * `src/lib/i18n`) — the day boundary is derived from its own y/m/d, so pass
 * the same value used elsewhere for that day, not an arbitrary timestamp.
 */
export async function ownerBalanceBreakdown(
  actor: Actor,
  partyId: string,
  asOf: Date
): Promise<{
  partyId: string;
  previousBalance: string;
  chargedToday: string;
  paidToday: string;
  correctionsToday: string;
  balance: string;
}> {
  requireSelfOrRole(actor, partyId, "PRESIDENT", "ACCOUNTANT");
  const zevId = requireZev(actor);
  const dayStart = new Date(asOf.getFullYear(), asOf.getMonth(), asOf.getDate(), 0, 0, 0, 0);

  const prevInvoices = await prisma.invoice.findMany({
    where: { zevId, debtorId: partyId, status: { in: ["ISSUED", "PAID"] }, issueDate: { lt: dayStart } },
    include: { allocations: { where: { createdAt: { lt: dayStart } } } },
  });
  const prevCharged = sumDecimals(prevInvoices.map((i) => dec(i.total.toString())));
  const prevPaid = sumDecimals(prevInvoices.flatMap((i) => i.allocations.map((a) => dec(a.amount.toString()))));
  const prevCorrectionsRows = await prisma.balanceCorrection.findMany({
    where: { zevId, partyId, createdAt: { lt: dayStart } },
  });
  const prevCorrections = sumDecimals(prevCorrectionsRows.map((c) => dec(c.amount.toString())));
  const previousBalance = prevCharged.minus(prevPaid).plus(prevCorrections);

  // Cumulative totals through the end of the chosen day (same logic as ownerBalance).
  const full = await ownerBalance(actor, partyId, asOf);
  const chargedToday = dec(full.charged).minus(prevCharged);
  const paidToday = dec(full.paid).minus(prevPaid);
  const correctionsToday = dec(full.corrections).minus(prevCorrections);

  return {
    partyId,
    previousBalance: previousBalance.toFixed(2),
    chargedToday: chargedToday.toFixed(2),
    paidToday: paidToday.toFixed(2),
    correctionsToday: correctionsToday.toFixed(2),
    balance: full.balance,
  };
}

/** Unapplied (advance) amount standing on a payer's payments. */
export async function ownerAdvance(actor: Actor, partyId: string): Promise<string> {
  requireSelfOrRole(actor, partyId, "PRESIDENT", "ACCOUNTANT");
  const zevId = requireZev(actor);
  const payments = await prisma.payment.findMany({
    where: { zevId, payerId: partyId, reversedAt: null },
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
  const zevId = requireZev(actor);
  if (!data.reason.trim()) throw new Error("Korekcija salda zahtijeva razlog.");
  await prisma.party.findUniqueOrThrow({ where: { id: data.partyId, zevId } });
  const c = await prisma.balanceCorrection.create({
    data: { ...data, zevId, createdById: actor.userId },
  });
  await audit(actor, {
    action: "balance.correction", targetType: "BalanceCorrection", targetId: c.id,
    after: { partyId: data.partyId, amount: data.amount, authority: data.authority ?? null },
    reason: data.reason,
  });
  return c;
}
