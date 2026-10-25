// Period serije faktura (F5a.4): predloženi period nove serije. Čista funkcija — kalendarski mjesec se čita po
// Europe/Sarajevo (kao F3), a servis daje samo periode izdatih serija.
import { toZonedDateIso } from "@/lib/i18n";

const PERIOD_RE = /^(\d{4})-(0[1-9]|1[0-2])$/;

/** `GGGG-MM` tekućeg mjeseca po Europe/Sarajevo. */
export function currentPeriod(now: Date): string {
  return toZonedDateIso(now).slice(0, 7);
}

/** Sljedeći mjesec iza `period` (`2026-12` → `2027-01`). */
export function nextPeriod(period: string): string {
  const m = PERIOD_RE.exec(period);
  if (!m) throw new Error(`Neispravan period: ${period}`);
  const y = Number(m[1]);
  const mo = Number(m[2]);
  return mo === 12 ? `${y + 1}-01` : `${y}-${String(mo + 1).padStart(2, "0")}`;
}

/** Mjesec poslije posljednje izdate serije, a bez nje (ili bez ijedne mjesečne) tekući mjesec. Periodi koji nisu
 *  `GGGG-MM` (jednokratne serije sa opisnom oznakom) se preskaču. */
export function suggestBatchPeriod(issuedPeriods: string[], now: Date): string {
  const monthly = issuedPeriods.filter((p) => PERIOD_RE.test(p)).sort();
  const last = monthly[monthly.length - 1];
  return last ? nextPeriod(last) : currentPeriod(now);
}
