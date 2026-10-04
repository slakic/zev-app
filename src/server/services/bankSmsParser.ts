// Parsing the SMS notifications Nova Banka sends for every credit ("Priliv na ...") and debit
// ("Odliv sa ...") on the ZEV's account (Plans/bank-sms-ingestion-plan.md, O2). Real examples:
//
//   NOVA BANKA-Priliv na 5551000051546932 Iznos 47,87 KM, svrha UPL. ZA 08/26 STAN BR 11,
//     5550000000009912 ZELJKO GALIC.Raspolozivo 11.175,20 KM
//   NOVA BANKA-Odliv sa 5551000051546932 Iznos 9,00 KM, svrha Naknada za PAKET START SME za
//     SEPTEMBAR-2026.Raspolozivo 11.102,91 KM            <- bank fee: NO counterparty at all
//
// Same shape for both directions; the counterparty (account number + name, name often truncated
// by the bank) is optional. Amounts use a decimal COMMA and a dot for thousands ("11.175,20") —
// the CSV rule (payments.ts parseCsvAmount with decimalComma), NOT the PDF statement rule
// (bankStatementPdf.ts MONEY_TOKEN, decimal point + comma thousands).
//
// Deliberately strict: anything that is not exactly this shape is UNKNOWN and is never turned
// into a payment — a misread message is worse than a rejected one, and a rejected one is shown
// to the accountant (it never silently disappears). Pure functions, no database access: this
// file only reads text. Booking happens in bankSms.ts, always behind a human confirmation.
import { dec, type Decimal } from "@/lib/money";

export type BankSmsKind = "PRILIV" | "ODLIV" | "UNKNOWN";

export type ParsedBankSms = {
  kind: BankSmsKind;
  /** The ZEV's own account number from the message, digits only. */
  ownAccount: string | null;
  amount: Decimal | null;
  purposeRaw: string | null;
  /** Other party's account number, digits only (null e.g. for bank fees). */
  counterpartyAccount: string | null;
  /** Other party's name exactly as the bank printed it (frequently truncated). */
  counterpartyName: string | null;
  /** "Raspolozivo" — balance after the transaction; informational (balance chain is Faza 2). */
  balanceAfter: Decimal | null;
  /** Why the message was not understood (Serbian, shown to the accountant). */
  error: string | null;
};

const MAX_TEXT_LENGTH = 1000;

/** Collapses every run of whitespace (iOS can insert line breaks) so equal messages hash equal. */
export function normalizeSmsText(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

/** True when the message claims to come from the bank at all — messages that do not are never
 *  stored with their text (they may be the owner's private messages, see IncomingBankSms). */
export function looksLikeBankSms(text: string): boolean {
  return /^NOVA BANKA/i.test(normalizeSmsText(text));
}

/** "11.175,20" -> 11175.20. Dot = thousands separator, comma = decimal separator. */
function parseKmAmount(value: string): Decimal {
  return dec(value.replace(/\./g, "").replace(",", "."));
}

function digitsOnly(value: string): string {
  return value.replace(/\D/g, "");
}

const SMS_RE =
  /^NOVA BANKA-(Priliv na|Odliv sa) (\d{10,20}) Iznos ([\d.]+,\d{2}) KM, svrha (.*?)(?:, (\d{10,20}) (.+?))?\.\s*Raspolozivo (-?[\d.]+,\d{2}) KM\.?$/i;

function unknown(error: string): ParsedBankSms {
  return {
    kind: "UNKNOWN",
    ownAccount: null,
    amount: null,
    purposeRaw: null,
    counterpartyAccount: null,
    counterpartyName: null,
    balanceAfter: null,
    error,
  };
}

export function parseNovaBankaSms(rawText: string): ParsedBankSms {
  const text = normalizeSmsText(rawText);
  if (!text) return unknown("Prazna poruka.");
  if (text.length > MAX_TEXT_LENGTH) return unknown("Poruka je predugačka.");
  if (!looksLikeBankSms(text)) return unknown("Poruka nije od Nova Banke.");
  if ((text.match(/NOVA BANKA-/gi) ?? []).length > 1) {
    return unknown("Poruka sadrži više od jedne SMS poruke — šalje se jedna po jedna.");
  }

  const m = SMS_RE.exec(text);
  if (!m) {
    if (/Iznos [\d.]+,\d{2} (?!KM\b)/i.test(text)) return unknown("Valuta u poruci nije KM.");
    return unknown("Poruka ne odgovara poznatom formatu Nova Banke (Priliv/Odliv).");
  }

  const [, direction, ownAccount, amountStr, purpose, counterpartyAccount, counterpartyName, balanceStr] = m;
  const amount = parseKmAmount(amountStr);
  if (amount.lessThanOrEqualTo(0)) return unknown("Iznos u poruci nije pozitivan.");

  return {
    kind: /^priliv/i.test(direction) ? "PRILIV" : "ODLIV",
    ownAccount: digitsOnly(ownAccount),
    amount,
    purposeRaw: purpose.trim() || null,
    counterpartyAccount: counterpartyAccount ? digitsOnly(counterpartyAccount) : null,
    counterpartyName: counterpartyName ? counterpartyName.trim() : null,
    balanceAfter: parseKmAmount(balanceStr.replace(/^-/, "")).times(balanceStr.startsWith("-") ? -1 : 1),
    error: null,
  };
}
