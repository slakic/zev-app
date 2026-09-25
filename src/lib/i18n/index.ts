import srLatn from "./sr-Latn";
import en from "./en";

export type Dictionary = typeof srLatn;
export type Locale = "sr-Latn" | "en";

const dictionaries: Record<Locale, unknown> = {
  "sr-Latn": srLatn,
  en,
};

export const DEFAULT_LOCALE: Locale =
  (process.env.APP_LOCALE as Locale) || "sr-Latn";

function lookup(dict: unknown, path: string[]): string | undefined {
  let cur: unknown = dict;
  for (const key of path) {
    if (cur == null || typeof cur !== "object") return undefined;
    cur = (cur as Record<string, unknown>)[key];
  }
  return typeof cur === "string" ? cur : undefined;
}

/**
 * Translate a dot-separated key, e.g. t("nav.home").
 * Falls back to sr-Latn, then to the key itself.
 */
export function t(key: string, locale: Locale = DEFAULT_LOCALE): string {
  const path = key.split(".");
  return (
    lookup(dictionaries[locale], path) ??
    lookup(srLatn, path) ??
    key
  );
}

/** Translate an enum value using its dictionary group, e.g. tEnum("invoiceStatus", status). */
export function tEnum(group: string, value: string | null | undefined, locale: Locale = DEFAULT_LOCALE): string {
  if (!value) return "";
  return t(`${group}.${value}`, locale);
}

export function formatDate(d: Date | string | null | undefined): string {
  if (!d) return "";
  const date = typeof d === "string" ? new Date(d) : d;
  const dd = String(date.getDate()).padStart(2, "0");
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  return `${dd}.${mm}.${date.getFullYear()}.`;
}

export function formatDateTime(d: Date | string | null | undefined): string {
  if (!d) return "";
  const date = typeof d === "string" ? new Date(d) : d;
  const hh = String(date.getHours()).padStart(2, "0");
  const mi = String(date.getMinutes()).padStart(2, "0");
  return `${formatDate(date)} ${hh}:${mi}`;
}

/**
 * End of day (23:59:59.999, local time) for a plain "YYYY-MM-DD" date input —
 * use this for an as-of/upper-bound date filter so it includes everything
 * dated *during* that day, not just before local midnight. `new Date("YYYY-MM-DD")`
 * parses as UTC midnight, which silently excludes same-day records created
 * later in the day (e.g. a "stanje na dan [danas]" report showing nothing).
 */
export function endOfDay(dateStr: string): Date {
  const [y, m, d] = dateStr.split("-").map(Number);
  return new Date(y, (m || 1) - 1, d || 1, 23, 59, 59, 999);
}

/**
 * Coarse relative time for a future or past instant, e.g. "za 7h", "prije 2 min" — used by
 * /admin/sesije for "Ističe"/"Posljednja aktivnost" (Plans/live-sessions-admin-plan.md), not
 * a general-purpose i18n primitive (Serbian phrasing is hardcoded, not dictionary-driven,
 * since "za"/"prije" placement around the unit isn't a simple key substitution).
 */
export function formatRelativeTime(target: Date, now: Date = new Date()): string {
  const diffMs = target.getTime() - now.getTime();
  const future = diffMs >= 0;
  const abs = Math.abs(diffMs);
  const minutes = Math.round(abs / 60000);
  const hours = Math.round(abs / 3600000);
  const days = Math.round(abs / 86400000);
  let amount: string;
  if (minutes < 1) amount = future ? "manje od minut" : "upravo sada";
  else if (minutes < 60) amount = `${minutes} min`;
  else if (hours < 24) amount = `${hours}h`;
  else amount = `${days} d.`;
  if (minutes < 1 && !future) return amount;
  return future ? `za ${amount}` : `prije ${amount}`;
}
