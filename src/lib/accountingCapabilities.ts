// Imenovane mogućnosti knjigovodstvenog dijela (Plans/kontni-plan-i-knjizenje-plan.md §3.7, A-Q2 (a)):
// mapa mogućnost → postojeće uloge, bez migracije. Provjerava ih servis kroz `requireCapability`
// (src/server/auth/guards.ts); meni i stranice ovu mapu samo čitaju za prikaz.
//
// Upravljanje predlošcima (`template.manage`) nije ovdje: predložak je platformski i čuva ga
// `requireSuperAdmin`. Nijedna mogućnost iz ove mape ne daje pravo plaćanja ni odobravanja
// nabavke — ti guardovi u expenses.ts/maintenance.ts ovu mapu ne čitaju.
//
// A1 uvodi chart.edit/period.open/ledger.view, A2 vrste zaduženja, pravila i kapije; B dodaje journal.* i period.*.
import type { Role } from "@/generated/prisma/client";

export const ACCOUNTING_CAPABILITIES = {
  /** Kontni plan ZEV-a: dodjela iz predloška, aktivacija, analitika, deaktivacija, zamjena konta. */
  "chart.edit": ["ACCOUNTANT"],
  /** Otvaranje poslovne godine i njenih perioda (zatvaranje je Faza B). */
  "period.open": ["ACCOUNTANT"],
  /** Vrste zaduženja, namjene sredstava i veza stavki naknade sa vrstom (A2). */
  "chargeTypes.edit": ["ACCOUNTANT"],
  /** Kontrolna konta, nacrti pravila knjiženja, pravilo raspodjele djelimične uplate (A2). */
  "rules.edit": ["ACCOUNTANT"],
  /** Potvrda pravila knjiženja, uz obavezan podatak ko je stručno potvrdio (A-Q3 (a)). */
  "rules.confirm": ["ACCOUNTANT"],
  /** Evidencija stručne potvrde šeme pod kapijom (K-6), uz ime stručnog lica (A-Q9 (a)). */
  "schema.approve": ["ACCOUNTANT"],
  /** Pregled kontnog plana, perioda i (kasnije) knjiga. */
  "ledger.view": ["PRESIDENT", "ACCOUNTANT"],
} as const satisfies Record<string, readonly Role[]>;

export type AccountingCapability = keyof typeof ACCOUNTING_CAPABILITIES;

export function hasCapability(roles: readonly Role[], cap: AccountingCapability): boolean {
  const allowed: readonly Role[] = ACCOUNTING_CAPABILITIES[cap];
  return roles.some((r) => allowed.includes(r));
}
