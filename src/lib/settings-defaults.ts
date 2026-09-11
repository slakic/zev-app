// Single source of truth for the 8 configurable legal/financial parameters (Setting
// model) and their default values. Previously duplicated as LEGAL_SETTINGS in
// podesavanja/page.tsx and again as inline `?? "3"` / `?? "4"` fallbacks in
// organi/page.tsx — consolidated here so both places (and settings.ts's seeding/read
// fallback) agree on one baseline. See LEGAL_AND_FINANCIAL_ASSUMPTIONS.md for the
// legal/accounting review these values are still pending.
export type SettingKey =
  | "retention.financialYears"
  | "retention.voteIpDays"
  | "emergency.costThreshold"
  | "interest.enabled"
  | "invoice.dueDay"
  | "board.size"
  | "board.termYears"
  | "board.presidentIsBoardPresident";

export type SettingDefinition = { key: SettingKey; label: string; def: string };

export const SETTING_DEFINITIONS: readonly SettingDefinition[] = [
  { key: "retention.financialYears", label: "Čuvanje finansijskih dokumenata (godina)", def: "11" },
  { key: "retention.voteIpDays", label: "Čuvanje IP metapodataka glasanja (dana)", def: "30" },
  { key: "emergency.costThreshold", label: "Prag za hitne radove bez skupštine (KM)", def: "500" },
  { key: "interest.enabled", label: "Zatezna kamata (isključena dok pravnik ne potvrdi)", def: "false" },
  { key: "invoice.dueDay", label: "Podrazumijevani dan dospijeća fakture", def: "15" },
  { key: "board.size", label: "Preporučen broj članova upravnog odbora (uključujući predsjednika)", def: "3" },
  { key: "board.termYears", label: "Trajanje mandata organa ZEV (godina)", def: "4" },
  {
    key: "board.presidentIsBoardPresident",
    label: "Predsjednik ZEV je ujedno predsjednik upravnog odbora (pretpostavka — vidi LEGAL_AND_FINANCIAL_ASSUMPTIONS.md)",
    def: "true",
  },
] as const;

export const SETTING_KEYS: readonly SettingKey[] = SETTING_DEFINITIONS.map((d) => d.key);

export const DEFAULT_SETTINGS: Record<SettingKey, string> = Object.fromEntries(
  SETTING_DEFINITIONS.map((d) => [d.key, d.def])
) as Record<SettingKey, string>;

export function isSettingKey(k: string): k is SettingKey {
  return (SETTING_KEYS as readonly string[]).includes(k);
}
