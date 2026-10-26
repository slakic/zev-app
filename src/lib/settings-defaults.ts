// Single source of truth for the 6 configurable legal/financial parameters (Setting
// model) and their default values. Previously duplicated as LEGAL_SETTINGS in
// podesavanja/page.tsx and again as inline `?? "3"` / `?? "4"` fallbacks in
// organi/page.tsx — consolidated here so both places (and settings.ts's seeding/read
// fallback) agree on one baseline. See LEGAL_AND_FINANCIAL_ASSUMPTIONS.md for the
// legal/accounting review these values are still pending.
export type SettingKey =
  | "retention.financialYears"
  | "retention.voteIpDays"
  | "emergency.costThreshold"
  | "invoice.dueDay"
  | "board.size"
  | "board.termYears";

/** Tip vrijednosti parametra: odlučuje o polju u formi (izbor / cijeli broj / iznos) i o pravilima unosa
 *  (`src/lib/settings-form.ts`). Vrijednost se i dalje čuva kao tekst u `Setting.value`. */
export type SettingType = "boolean" | "integer" | "money";
/** Jedinica uz broj: ključ u `settingsPage.unit.*` (naziv u labeli polja i oblici za prikaz). */
export type SettingUnit = "years" | "days" | "km" | "dayOfMonth";

export type SettingDefinition = {
  key: SettingKey;
  def: string;
  type: SettingType;
  unit?: SettingUnit;
  /** Dozvoljeni opseg za `integer`/`money` (uključivo). */
  min?: number;
  max?: number;
  /** Kako se bulov parametar zove u izboru i prikazu: Uključeno/Isključeno ili Da/Ne. */
  boolLabels?: "onOff" | "yesNo";
};

// Naziv i posljedica svakog parametra su u rječniku: `settingsPage.param.<ključ>.name` / `.hint`.
export const SETTING_DEFINITIONS: readonly SettingDefinition[] = [
  { key: "retention.financialYears", def: "11", type: "integer", unit: "years", min: 1, max: 50 },
  // Odluka 2026-10-26: podaci o glasanju se čuvaju 5 godina (1826 dana); to je i najmanja dozvoljena vrijednost.
  { key: "retention.voteIpDays", def: "1826", type: "integer", unit: "days", min: 1826, max: 3650 },
  { key: "emergency.costThreshold", def: "500", type: "money", unit: "km", min: 0, max: 10_000_000 },
  { key: "invoice.dueDay", def: "15", type: "integer", unit: "dayOfMonth", min: 1, max: 28 },
  { key: "board.size", def: "3", type: "integer", min: 1, max: 15 },
  { key: "board.termYears", def: "4", type: "integer", unit: "years", min: 1, max: 10 },
] as const;

export const SETTING_KEYS: readonly SettingKey[] = SETTING_DEFINITIONS.map((d) => d.key);

export const DEFAULT_SETTINGS: Record<SettingKey, string> = Object.fromEntries(
  SETTING_DEFINITIONS.map((d) => [d.key, d.def])
) as Record<SettingKey, string>;

export function isSettingKey(k: string): k is SettingKey {
  return (SETTING_KEYS as readonly string[]).includes(k);
}
