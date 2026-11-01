// Sekcije izvještaja o uvozu (bez zavisnosti, da ih smije uvesti i klijentska komponenta).
export const PLAN_SECTIONS = ["zev", "accounts", "buildings", "units", "commonAssets", "parties", "stakeProposals", "offices"] as const;
export type PlanSection = (typeof PLAN_SECTIONS)[number];
export type SectionCounts = { added: number; updated: number; unchanged: number; skipped: number };
