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

/**
 * The app's one fixed display/business timezone (BiH — Sarajevo, CET/CEST) — deliberately
 * NOT the server process's own ambient timezone, which is UTC in every runtime this app
 * actually deploys to (this Docker container, Vercel's serverless functions) and was, until
 * this fix, silently leaking into every date shown to a user: `Date.prototype.getHours()`
 * and friends read the *process's* local time, so on a UTC server every timestamp displayed
 * 1–2h behind a Bosnia wall clock (2h right now, during CEST) — reported by the user seeing
 * `/admin/aktivnosti` timestamps run 2h behind. Fixed by never depending on process-local
 * Date getters again in this file — see tzOffsetMs/zonedParts below.
 */
const TIME_ZONE = "Europe/Sarajevo";

/** Offset (ms) of `timeZone` from UTC at the instant `date` — positive when the zone is
 *  ahead of UTC (+7,200,000 for Europe/Sarajevo during CEST, +3,600,000 during CET).
 *  Computed from the whole-second boundary containing `date`, not `date` itself: formatToParts'
 *  "second" field truncates any fractional-second remainder, and computing the offset directly
 *  from a sub-second `date` would silently bake that up-to-999ms truncation into the offset —
 *  invisible at formatDate/formatDateTime's minute granularity, but enough to land endOfDay a
 *  full second into the next day (caught by tests/i18n-timezone.test.ts). DST transitions
 *  happen on whole-second boundaries, so flooring here never changes which offset applies. */
function tzOffsetMs(date: Date, timeZone: string): number {
  const whole = new Date(Math.floor(date.getTime() / 1000) * 1000);
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
  }).formatToParts(whole);
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? 0);
  const asUtc = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"), get("second"));
  return asUtc - whole.getTime();
}

/** `date`'s wall-clock date/time as read in TIME_ZONE, independent of the server process's
 *  own timezone — read via getUTC* on a shifted instant rather than a second formatToParts
 *  call per field. */
function zonedParts(date: Date): { year: number; month: number; day: number; hour: number; minute: number } {
  const local = new Date(date.getTime() + tzOffsetMs(date, TIME_ZONE));
  return {
    year: local.getUTCFullYear(),
    month: local.getUTCMonth() + 1,
    day: local.getUTCDate(),
    hour: local.getUTCHours(),
    minute: local.getUTCMinutes(),
  };
}

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

export function formatDate(d: Date | string | null | undefined): string {
  if (!d) return "";
  const date = typeof d === "string" ? new Date(d) : d;
  const { day, month, year } = zonedParts(date);
  return `${pad2(day)}.${pad2(month)}.${year}.`;
}

export function formatDateTime(d: Date | string | null | undefined): string {
  if (!d) return "";
  const date = typeof d === "string" ? new Date(d) : d;
  const { day, month, year, hour, minute } = zonedParts(date);
  return `${pad2(day)}.${pad2(month)}.${year}. ${pad2(hour)}:${pad2(minute)}`;
}

/**
 * End of day (23:59:59.999 in TIME_ZONE) for a plain "YYYY-MM-DD" date input — use this for
 * an as-of/upper-bound date filter so it includes everything dated *during* that day (Bosnia
 * wall-clock day, not the server process's own), not just before its local midnight.
 * `new Date("YYYY-MM-DD")` parses as UTC midnight, which silently excludes same-day records
 * created later in the day (e.g. a "stanje na dan [danas]" report showing nothing) — and a
 * naive `new Date(y, m, d, 23, 59, ...)` has the same bug one layer down, since it builds the
 * boundary in the *server's* local timezone (UTC) rather than Bosnia's.
 */
export function endOfDay(dateStr: string): Date {
  const [y, m, d] = dateStr.split("-").map(Number);
  const utcGuess = new Date(Date.UTC(y, (m || 1) - 1, d || 1, 23, 59, 59, 999));
  return new Date(utcGuess.getTime() - tzOffsetMs(utcGuess, TIME_ZONE));
}

/**
 * Parses a `<input type="datetime-local">` value ("YYYY-MM-DDTHH:mm", no timezone component
 * per the HTML spec) as wall-clock time in TIME_ZONE (Bosnia), returning the correct UTC
 * instant. NOT the same as `new Date(value)`, which ECMA-262 defines as *server-local* time
 * for a timezone-less datetime string — on this app's servers (this Docker container, Vercel)
 * that's UTC, so a president typing "14:00" meaning 14:00 Bosnia time would silently have it
 * stored as 14:00 UTC (16:00 Bosnia, during CEST) — a real governance bug, not just a display
 * one, since it actually shifts a meeting/e-vote deadline by however many hours Bosnia is
 * ahead of UTC. Returns null for an empty/unparseable value, matching how callers already
 * treat an empty optional datetime-local field as "no value".
 */
export function parseZonedDateTime(value: string | null | undefined): Date | null {
  if (!value) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?/.exec(value);
  if (!m) return null;
  const [, y, mo, d, hh, mi, ss] = m;
  const utcGuess = new Date(Date.UTC(Number(y), Number(mo) - 1, Number(d), Number(hh), Number(mi), Number(ss ?? "0")));
  return new Date(utcGuess.getTime() - tzOffsetMs(utcGuess, TIME_ZONE));
}

/**
 * The inverse of parseZonedDateTime — pre-fills a `<input type="datetime-local">` with a
 * stored instant's Bosnia wall-clock value, so loading a form and resubmitting without
 * touching the field is a true no-op round trip (not the case before this fix: the previous
 * `toDatetimeLocal` read the server's own local getters, same bug as formatDate/formatDateTime).
 */
export function formatDateTimeLocalInput(d: Date | string | null | undefined): string {
  if (!d) return "";
  const date = typeof d === "string" ? new Date(d) : d;
  const { year, month, day, hour, minute } = zonedParts(date);
  return `${year}-${pad2(month)}-${pad2(day)}T${pad2(hour)}:${pad2(minute)}`;
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
