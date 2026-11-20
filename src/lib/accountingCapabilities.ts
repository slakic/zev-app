// Imenovane mogućnosti knjigovodstvenog dijela (Plans/kontni-plan-i-knjizenje-plan.md §3.7, A-Q2 (a)):
// mapa mogućnost → postojeće uloge, bez migracije. Provjerava ih servis kroz `requireCapability`
// (src/server/auth/guards.ts); meni i stranice ovu mapu samo čitaju za prikaz.
//
// Upravljanje predlošcima (`template.manage`) nije ovdje: predložak je platformski i čuva ga
// `requireSuperAdmin`. Nijedna mogućnost iz ove mape ne daje pravo plaćanja ni odobravanja
// nabavke — ti guardovi u expenses.ts/maintenance.ts ovu mapu ne čitaju.
//
// Faza A1 uvodi samo mogućnosti koje već imaju servis; A2/B dodaju svoje (rules.*, journal.*, …).
import type { Role } from "@/generated/prisma/client";

export const ACCOUNTING_CAPABILITIES = {
  /** Kontni plan ZEV-a: dodjela iz predloška, aktivacija, analitika, deaktivacija, zamjena konta. */
  "chart.edit": ["ACCOUNTANT"],
  /** Otvaranje poslovne godine i njenih perioda (zatvaranje je Faza B). */
  "period.open": ["ACCOUNTANT"],
  /** Pregled kontnog plana, perioda i (kasnije) knjiga. */
  "ledger.view": ["PRESIDENT", "ACCOUNTANT"],
} as const satisfies Record<string, readonly Role[]>;

export type AccountingCapability = keyof typeof ACCOUNTING_CAPABILITIES;

export function hasCapability(roles: readonly Role[], cap: AccountingCapability): boolean {
  const allowed: readonly Role[] = ACCOUNTING_CAPABILITIES[cap];
  return roles.some((r) => allowed.includes(r));
}
