// „Evidencije” (/evidencije?tab=…): izbor taba i gradnja adresa — čisto, da se ponašanje preusmjerenja i straničenja
// može testirati bez renderovanja. Stari URL-ovi (/aktivnosti, /podesavanja/audit, /podesavanja/poruke) se
// preusmjeravaju u next.config.ts na odgovarajući tab, uz zadržavanje query parametara (filteri, `str`).
export const RECORD_TABS = ["aktivnosti", "poruke", "audit"] as const;
export type RecordTab = (typeof RECORD_TABS)[number];

/** „Aktivnosti” vidi samo predsjednik (odluka P4, Plans/user-activity-log-plan.md); računovođi se traženi tab
 *  koji nema zamjenjuje prvim dostupnim. */
export function availableRecordTabs(isPresident: boolean): RecordTab[] {
  return isPresident ? [...RECORD_TABS] : RECORD_TABS.filter((tab) => tab !== "aktivnosti");
}

export function resolveRecordTab(requested: string | undefined, isPresident: boolean): RecordTab {
  const tabs = availableRecordTabs(isPresident);
  return tabs.find((tab) => tab === requested) ?? tabs[0];
}

/** Strogo YYYY-MM-DD i stvaran datum — sve ostalo (prazno, "abc", "2026-02-31") se ignoriše umjesto da sruši upit. */
export function isIsoDate(value: string | undefined): value is string {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [y, m, d] = value.split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d;
}

/** `/evidencije?tab=…` sa filterima; prazne vrijednosti se izostavljaju, višestruke (kategorije) se ponavljaju. */
export function recordsHref(tab: RecordTab, params: Record<string, string | string[] | undefined> = {}): string {
  const qs = new URLSearchParams({ tab });
  for (const [key, value] of Object.entries(params)) {
    if (Array.isArray(value)) value.forEach((v) => v && qs.append(key, v));
    else if (value) qs.set(key, value);
  }
  return `/evidencije?${qs.toString()}`;
}
