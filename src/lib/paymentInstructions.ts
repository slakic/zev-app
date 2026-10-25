// Čiste funkcije oko uplatnih podataka fakture (F3). Bez pristupa bazi: servis
// `src/server/services/paymentInstructions.ts` ih popunjava, a PDF fakture, ekran i testovi dijele
// ista pravila (preostali iznos, "dospjela", svrha uplate, QR sadržaj).
import { toZonedDateIso } from "@/lib/i18n";

export type PaymentInstructions = {
  /** ZEV legalName. */
  recipient: string;
  /** Najstariji aktivan bankovni račun ZEV-a (F3-Q1); null = ZEV nema račun sa upisanim brojem. */
  account: { iban: string; bankName: string | null } | null;
  /** Decimal kao string sa dvije decimale; na ekranu ide kroz formatMoney. */
  total: string;
  paid: string;
  remaining: string;
  /** Poziv na broj: paymentReference ili broj fakture. */
  reference: string;
  /** „ZEV {period} — {broj fakture}” (F3-Q2). */
  purpose: string;
  dueDate: Date;
  /** Kalendarskih dana (Europe/Sarajevo) od roka; 0 kad faktura nije dospjela. */
  overdueDays: number;
  /** ISSUED i preostalo > 0. */
  payable: boolean;
};

const DAY_MS = 24 * 60 * 60 * 1000;

/** Broj kalendarskih dana (Europe/Sarajevo) od `from` do `to`; negativan ako je `to` ranije. */
export function calendarDaysBetween(from: Date, to: Date): number {
  const a = Date.parse(`${toZonedDateIso(from)}T00:00:00Z`);
  const b = Date.parse(`${toZonedDateIso(to)}T00:00:00Z`);
  return Math.round((b - a) / DAY_MS);
}

/** Dana kašnjenja po kalendarskom danu Europe/Sarajevo; na sam dan roka je 0 (još nije dospjela). */
export function overdueDaysOf(dueDate: Date, now: Date = new Date()): number {
  return Math.max(0, calendarDaysBetween(dueDate, now));
}

/** „Dospjela” nije status u bazi: izdata faktura kojoj je rok prošao (poređenje po kalendarskom danu). */
export function isInvoiceOverdue(inv: { status: string; dueDate: Date }, now: Date = new Date()): boolean {
  return inv.status === "ISSUED" && overdueDaysOf(inv.dueDate, now) > 0;
}

/** Svrha uplate (F3-Q2): „ZEV {period} — {broj fakture}”; bez perioda samo „ZEV — {broj}”. */
export function invoicePurpose(periodLabel: string | null | undefined, number: string): string {
  const period = periodLabel?.trim();
  return `ZEV ${period ? `${period} ` : ""}— ${number}`;
}

/**
 * Sadržaj QR kodnog polja na PDF-u fakture ("informativno"). Isti ključevi kao prije F3; iznos je
 * PREOSTALI iznos, ne ukupan (V-N26), da se nakon djelimične uplate ne traži previše.
 */
export function paymentQrPayload(instr: Pick<PaymentInstructions, "account" | "recipient" | "remaining" | "reference" | "purpose">): string {
  return JSON.stringify({
    racun: instr.account?.iban ?? "",
    primalac: instr.recipient,
    iznos: instr.remaining,
    pozivNaBroj: instr.reference,
    svrha: instr.purpose,
  });
}
