// Sažetak tabele za pregled (ReviewTable, F5b.1): koliko je stavki označeno i koliki su zbirovi uplata i isplata.
// Ide u klijentski bundle, pa NE uvozi `money.ts` (on vuče Prisma klijent): računa se u cijelim feninzima (cijeli brojevi),
// tačno i bez float-a; ulaz prima isti zapis kao `parseMoneyInput` ("1.234,50", "10,25", "1234.5"). Iznos koji se ne
// može pročitati (korisnik ga upravo ispravlja) se ne računa.

import { isOneForm, isFewForm } from "@/lib/plural";

export type ReviewSummaryRow = { include: boolean; direction: "IN" | "OUT"; amount: string };

export type ReviewSummary = {
  selected: number;
  total: number;
  /** Zbir označenih uplata, 2 decimale (npr. "1234.56"). */
  inTotal: string;
  /** Zbir označenih isplata, 2 decimale. */
  outTotal: string;
  inCount: number;
  outCount: number;
};

/** Iznos koji je korisnik ukucao → feninzi (zaokruženo na 2 decimale, half-up), ili `null` ako nije broj. */
export function parseCents(raw: string): number | null {
  let v = raw.trim().replace(/\s/g, "");
  if (v === "") return null;
  if (v.includes(",")) v = v.includes(".") ? v.replace(/\./g, "").replace(",", ".") : v.replace(",", ".");
  const m = /^(\d+)(?:\.(\d+))?$/.exec(v);
  if (!m) return null;
  const frac = (m[2] ?? "").padEnd(3, "0");
  if (m[1].length > 13) return null; // izvan raspona tačnog cijelog broja
  let cents = Number(m[1]) * 100 + Number(frac.slice(0, 2));
  if (Number(frac[2]) >= 5) cents += 1;
  return cents;
}

/** Feninzi → "1234.56". */
export function centsToFixed(cents: number): string {
  const neg = cents < 0;
  const abs = neg ? -cents : cents;
  return `${neg ? "-" : ""}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, "0")}`;
}

/** Iznos ("1234.56", "200", "1.234,5") → "1.234,56 KM" (isti zapis kao `formatMoney`, bez uvoza Prisma-e u klijent). */
export function formatKm(value: string): string {
  const [int, frac = "00"] = centsToFixed(parseCents(value) ?? 0).split(".");
  const neg = int.startsWith("-");
  const digits = neg ? int.slice(1) : int;
  return `${neg ? "-" : ""}${digits.replace(/\B(?=(\d{3})+(?!\d))/g, ".")},${frac} KM`;
}

export function reviewSummary(rows: ReviewSummaryRow[]): ReviewSummary {
  let inTotal = 0;
  let outTotal = 0;
  let inCount = 0;
  let outCount = 0;
  let selected = 0;
  for (const r of rows) {
    if (!r.include) continue;
    selected++;
    const cents = parseCents(r.amount) ?? 0;
    if (r.direction === "IN") {
      inCount++;
      inTotal += cents;
    } else {
      outCount++;
      outTotal += cents;
    }
  }
  return { selected, total: rows.length, inTotal: centsToFixed(inTotal), outTotal: centsToFixed(outTotal), inCount, outCount };
}

/** Oblik množine (pravilo iz `src/lib/plural.ts`): 1, 21… → "one"; 2–4, 22–24… → "few"; ostalo (uklj. 11–14) → "many". */
export function pluralForm(n: number): "one" | "few" | "many" {
  return isOneForm(n) ? "one" : isFewForm(n) ? "few" : "many";
}
