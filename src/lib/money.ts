// All monetary arithmetic uses Prisma.Decimal (decimal.js) — never JS floats.
import { Prisma } from "@/generated/prisma/client";

export type Decimal = Prisma.Decimal;
export const Decimal = Prisma.Decimal;
export type DecimalValue = string | number | Prisma.Decimal;

export type RoundingMethod = "HALF_UP_2" | "UP_2" | "DOWN_2";

export function dec(value: DecimalValue): Decimal {
  return new Decimal(value);
}

/**
 * Normalize a number typed by a user into a canonical decimal string that
 * `Decimal`/Prisma will accept ("1234.56"). The rest of the app displays
 * money as "1.234,56 KM" (sr-Latn convention: comma decimal separator, dot
 * thousands separator) via `formatMoney`, so free-text amount inputs must
 * accept that same format back, not just the bare "1234.56" form.
 *
 * Rules (only comma-bearing input is touched, so plain "1234.56" behaves
 * exactly as before):
 *   "120,00"     -> "120.00"   (comma = decimal separator)
 *   "1.234,56"   -> "1234.56"  (dot = thousands, comma = decimal)
 *   "1234.56"    -> "1234.56"  (unchanged)
 *   ""  / null   -> null
 */
export function parseMoneyInput(raw: string | null | undefined): string | null {
  if (raw == null) return null;
  const trimmed = raw.trim();
  if (trimmed === "") return null;
  let s = trimmed.replace(/\s/g, "");
  if (s.includes(",")) {
    s = s.includes(".") ? s.replace(/\./g, "").replace(",", ".") : s.replace(",", ".");
  }
  return s;
}

export const ZERO = new Decimal(0);

/** Round a money amount according to a configurable method (2 decimals). */
export function roundMoney(value: Decimal, method: RoundingMethod = "HALF_UP_2"): Decimal {
  switch (method) {
    case "UP_2":
      return value.toDecimalPlaces(2, Decimal.ROUND_CEIL);
    case "DOWN_2":
      return value.toDecimalPlaces(2, Decimal.ROUND_FLOOR);
    case "HALF_UP_2":
    default:
      return value.toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
  }
}

export function clampMoney(value: Decimal, min?: Decimal | null, max?: Decimal | null): Decimal {
  let v = value;
  if (min != null && v.lessThan(min)) v = min;
  if (max != null && v.greaterThan(max)) v = max;
  return v;
}

export function sumDecimals(values: Decimal[]): Decimal {
  return values.reduce((acc, v) => acc.plus(v), ZERO);
}

/**
 * Format a voting-weight/participant-count decimal for display, stripping
 * insignificant trailing zeros. Weight columns and rule snapshots are stored
 * at fixed 6-decimal precision (`Decimal(14,6)`) so ownership-share/area
 * weights round-trip exactly, but that same fixed precision makes a whole
 * number (e.g. every PER_OWNER vote, "1 owner = 1 vote") print as "1.000000"
 * — confusing for something that is conceptually a headcount. This keeps the
 * stored precision untouched and only cleans up how it's shown:
 *   "100.000000" -> "100"        "1.000000" -> "1"
 *   "25.500000"  -> "25.5"       "33.333333" -> "33.333333" (real fraction kept)
 */
export function formatWeight(value: DecimalValue): string {
  const s = value.toString();
  if (!s.includes(".")) return s;
  return s.replace(/0+$/, "").replace(/\.$/, "");
}

/** Format for the UI: "1.234,56 KM" (sr-Latn number formatting). */
export function formatMoney(value: DecimalValue, currency = "KM"): string {
  const d = new Decimal(value).toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
  const [intPart, fracPart = "00"] = d.toFixed(2).split(".");
  const negative = intPart.startsWith("-");
  const digits = negative ? intPart.slice(1) : intPart;
  const grouped = digits.replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  return `${negative ? "-" : ""}${grouped},${fracPart} ${currency}`;
}
