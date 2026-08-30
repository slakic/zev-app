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
