// Parsing bank statements delivered as PDF (Nova Banka format, confirmed against a real
// statement sample — "IZVOD BR. ... O PROMJENAMA SREDSTAVA NA RAČUNU").
//
// pdf-parse extracts the PDF's TEXT LAYER (these statements are digitally generated, not
// scanned images — no OCR involved, so extraction is essentially exact). Because the bank
// renders each row's account/name/amount columns at fixed coordinates with no real space
// characters between them, the extracted text often looks like:
//   "5673215000276394DRAGANA DEJANAC0.0049.47"
// i.e. <account digits><NAME><debit><credit> all concatenated. parseAmountLine() below
// splits that back apart using the fact that amounts always have exactly 2 decimal digits.
//
// IMPORTANT: this parser is a best-effort read of one bank's layout. It never writes
// anything to the database by itself — see importPdfPreview()/commitPdfImport() in
// payments.ts, which always show a human a review/edit screen before any Payment is
// created. Never wire this straight into a "commit" path.
// NOTE: importing the package root ("pdf-parse") triggers a debug self-test in v1.1.1
// that reads a hardcoded fixture path and crashes at import time outside its own repo.
// Importing the internal module directly avoids that; see types/pdf-parse-internal.d.ts.
import pdfParse from "pdf-parse/lib/pdf-parse.js";
import { dec, type Decimal } from "@/lib/money";

export type ParsedPdfRow = {
  /** Row number as printed on the statement (RBR.), if found. */
  rbr: number | null;
  /** Bank's own internal reference number (left of "/" on the purpose line). */
  bankReference: string | null;
  /** Partner's account number, as printed. */
  partnerAccount: string | null;
  /** Partner name (NAZIV PARTNERA column). */
  partnerName: string | null;
  /** Zaduženje — money leaving this account (outgoing; not an owner payment). */
  debit: Decimal;
  /** Odobrenje — money received into this account (this is the incoming payment amount). */
  credit: Decimal;
  /** Svrha doznake — free-text purpose, as printed (may contain a unit number, another name, etc.). */
  purposeRaw: string;
};

export type ParsedPdfStatement = {
  /** Statement date (single day — one izvod covers one calendar day). */
  statementDate: Date | null;
  /** The ZEV's own account number as printed on the statement header, if found. */
  ownAccountNumber: string | null;
  rows: ParsedPdfRow[];
};

const MONEY_TOKEN = /\d{1,3}(?:,\d{3})*\.\d{2}/g;

function normalizeSpaces(s: string): string {
  return s.replace(/\s+/g, " ").trim();
}

/** Parses a line like "5673215000276394DRAGANA DEJANAC0.0049.47" (account+name+debit+credit, no separators). */
function parseAmountLine(line: string): { account: string; name: string; debit: Decimal; credit: Decimal } | null {
  const m = line.match(/^(\d{6,})(.*)$/);
  if (!m) return null;
  const [, account, rest] = m;
  const tokens = [...rest.matchAll(MONEY_TOKEN)];
  if (tokens.length < 2) return null;
  const creditTok = tokens[tokens.length - 1];
  const debitTok = tokens[tokens.length - 2];
  const name = normalizeSpaces(rest.slice(0, debitTok.index));
  return {
    account,
    name,
    debit: dec(debitTok[0].replace(/,/g, "")),
    credit: dec(creditTok[0].replace(/,/g, "")),
  };
}

/** Parses a line like "398807762  /  0000000000 ZA STAN  7/2026  STAN 4" (bank ref / svrha doznake). */
function parsePurposeLine(line: string): { bankReference: string; purpose: string } | null {
  const m = line.match(/^(\d+)\s*\/\s*(.*)$/);
  if (!m) return null;
  return { bankReference: m[1], purpose: normalizeSpaces(m[2]) };
}

export async function extractPdfText(buffer: Buffer): Promise<string> {
  const data = await pdfParse(buffer);
  return data.text as string;
}

/**
 * Extracts unit-number candidates from free-text "svrha doznake" (payment purpose).
 * Format is NOT standardized — people write "stan 47", "st. 12", "ZA STAN 7/2026 STAN 4",
 * or nothing at all — so this returns every plausible candidate rather than guessing one:
 *  - "keyword" candidates (preceded by stan/st./br./broj) are higher confidence.
 *  - "bare" candidates (a short standalone number with no keyword) are lower confidence.
 * A number immediately followed by "/YYYY" (e.g. "7/2026") is treated as a month/year
 * period, not a unit number, and excluded — this is the single most common false positive
 * in real statements (payers write "za mjesec 7/2026").
 */
export function extractUnitNumberCandidates(text: string): { keyword: string[]; bare: string[] } {
  const keyword = new Set<string>();
  const keywordRe = /\b(?:stan|st\.?|br\.?|broj)\s*\.?\s*(\d{1,4})\b(?!\s*\/\s*\d{4})/gi;
  for (const m of text.matchAll(keywordRe)) keyword.add(m[1]);

  const bare = new Set<string>();
  const bareRe = /\b(\d{1,3})\b(?!\s*\/\s*\d{4})/g;
  for (const m of text.matchAll(bareRe)) {
    if (!keyword.has(m[1])) bare.add(m[1]);
  }
  return { keyword: [...keyword], bare: [...bare] };
}

function parseStatementDate(text: string): Date | null {
  const m = text.match(/\b(\d{2})\.(\d{2})\.(\d{4})\b/);
  if (!m) return null;
  return new Date(Date.UTC(Number(m[3]), Number(m[2]) - 1, Number(m[1])));
}

function parseOwnAccountNumber(text: string): string | null {
  // Domestic BAM account format as printed on Nova Banka statements, e.g. "555-10000515469-32".
  const m = text.match(/\b(\d{2,4}-\d{6,}-\d{1,3})\b/);
  return m ? m[1] : null;
}

/** Parses the full extracted text of one Nova Banka statement into transaction rows. */
export function parseNovaBankaStatement(text: string): ParsedPdfStatement {
  const lines = text.split(/\r?\n/).map((l) => l.trim());
  const rows: ParsedPdfRow[] = [];

  for (let i = 0; i < lines.length; i++) {
    const purposeMatch = parsePurposeLine(lines[i]);
    if (!purposeMatch) continue;
    const amountMatch = parseAmountLine(lines[i + 1] ?? "");
    if (!amountMatch) continue;

    let rbr: number | null = null;
    const rbrLine = lines[i + 2];
    if (rbrLine && /^\d{1,4}$/.test(rbrLine)) {
      rbr = Number(rbrLine);
      i += 2;
    } else {
      i += 1;
    }

    rows.push({
      rbr,
      bankReference: purposeMatch.bankReference,
      partnerAccount: amountMatch.account,
      partnerName: amountMatch.name || null,
      debit: amountMatch.debit,
      credit: amountMatch.credit,
      purposeRaw: purposeMatch.purpose,
    });
  }

  return {
    statementDate: parseStatementDate(text),
    ownAccountNumber: parseOwnAccountNumber(text),
    rows,
  };
}
