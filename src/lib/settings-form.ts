// Parsiranje i poređenje parametara ZEV-a (Podešavanja › Parametri) — čista logika, bez baze i bez i18n-a, da bude
// testabilna do detalja: parametri utiču na obračun i pravila glasanja, pa pogrešno protumačen unos ("11,5", "1.500",
// prazno polje) ne smije tiho promijeniti vrijednost. Pravila:
// - bulovi su tačno "true"/"false" (u formi je to izbor, ne slobodan tekst);
// - cijeli broj je samo cifre (bez decimalnog dijela) u opsegu definicije;
// - iznos prihvata decimalni zarez i tačku kao razdvajač hiljada ("1.234,56"), najviše dvije decimale; dvosmislen
//   unos ("1.500" — tačka sa tri cifre iza) se odbija umjesto da se pogodi;
// - prazno polje je greška, ne "nula".
// `diffSettings` je sve-ili-ništa: ako i jedna vrijednost nije ispravna, ne vraća nijednu izmjenu, a izmjenom se
// smatra samo vrijednost koja se razlikuje od sačuvane (poređenje po kanonskom obliku) — server upisuje samo to,
// pa revizorski trag ne dobija zapise za nepromijenjena polja.
import { Decimal, parseMoneyInput } from "@/lib/money";
import { SETTING_DEFINITIONS, type SettingDefinition, type SettingKey } from "@/lib/settings-defaults";

export type SettingParseError = "empty" | "invalid" | "range";
export type ParsedSetting = { ok: true; value: string } | { ok: false; error: SettingParseError };

export function parseSettingValue(def: SettingDefinition, raw: string | null | undefined): ParsedSetting {
  const text = (raw ?? "").trim();
  if (text === "") return { ok: false, error: "empty" };

  if (def.type === "boolean") {
    return text === "true" || text === "false" ? { ok: true, value: text } : { ok: false, error: "invalid" };
  }

  if (def.type === "integer") {
    if (!/^\d{1,9}$/.test(text)) return { ok: false, error: "invalid" };
    const n = Number(text);
    if ((def.min !== undefined && n < def.min) || (def.max !== undefined && n > def.max)) return { ok: false, error: "range" };
    return { ok: true, value: String(n) };
  }

  // money
  const normalized = parseMoneyInput(text.replace(/\s*KM$/i, ""));
  if (normalized === null || !/^\d+(\.\d{1,2})?$/.test(normalized)) return { ok: false, error: "invalid" };
  const d = new Decimal(normalized);
  if ((def.min !== undefined && d.lessThan(def.min)) || (def.max !== undefined && d.greaterThan(def.max))) {
    return { ok: false, error: "range" };
  }
  return { ok: true, value: d.toString() };
}

/** Sačuvana vrijednost u kanonskom obliku ("500.00" → "500"); neispravna (naslijeđena) ostaje kakva jeste. */
export function canonicalSettingValue(def: SettingDefinition, stored: string): string {
  const parsed = parseSettingValue(def, stored);
  return parsed.ok ? parsed.value : stored;
}

export type SettingChange = { key: SettingKey; before: string; after: string };
export type SettingIssue = { key: SettingKey; error: SettingParseError };
export type SettingsDiff = { ok: true; changes: SettingChange[] } | { ok: false; issues: SettingIssue[] };

/**
 * `submitted` ima po ključ iz forme; ključ koji nije poslat (`undefined`/`null`) se ne dira — to nije "prazno polje".
 * Poslat prazan tekst jeste greška.
 */
export function diffSettings(
  current: Record<SettingKey, string>,
  submitted: Partial<Record<SettingKey, string | null | undefined>>,
): SettingsDiff {
  const changes: SettingChange[] = [];
  const issues: SettingIssue[] = [];
  for (const def of SETTING_DEFINITIONS) {
    const raw = submitted[def.key];
    if (raw === undefined || raw === null) continue;
    const parsed = parseSettingValue(def, raw);
    if (!parsed.ok) {
      issues.push({ key: def.key, error: parsed.error });
      continue;
    }
    const before = canonicalSettingValue(def, current[def.key]);
    if (parsed.value !== before) changes.push({ key: def.key, before, after: parsed.value });
  }
  return issues.length > 0 ? { ok: false, issues } : { ok: true, changes };
}
