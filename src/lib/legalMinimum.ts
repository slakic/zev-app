// Zakonski minimum naknade za održavanje (odluka korisnika 2026-10-26): 0,20 KM/m² za fizička lica i
// 0,40 KM/m² za pravna lica (prema vrsti lica vlasnika/dužnika). Samo UPOZORENJE — ništa se ne blokira.
// Čiste funkcije; Decimal aritmetika (money.ts).
import { Decimal, dec } from "@/lib/money";

export type PartyKindLike = "PERSON" | "ORGANIZATION";

export const MIN_MAINTENANCE_PER_M2: Record<PartyKindLike, string> = { PERSON: "0.20", ORGANIZATION: "0.40" };

export function minMaintenancePerM2(kind: PartyKindLike): Decimal {
  return dec(MIN_MAINTENANCE_PER_M2[kind]);
}

const strip = (s: string) =>
  s.toLowerCase().replace(/đ/g, "dj").normalize("NFD").replace(/[̀-ͯ]/g, "");

/**
 * Šta se računa kao „naknada za održavanje” (model nema posebnu oznaku): stavka koja se obračunava po m²
 * (`PER_AREA` — jedino tu je stopa uporediva sa minimumom u KM/m²) i koja je ili označena kao fond održavanja
 * (`isReserveFund`) ili u nazivu ima „održavanj…”. Stavke po udjelu, fiksne i raspodjele se ne porede.
 */
export function isMaintenanceCharge(item: { method: string; name: string; isReserveFund?: boolean }): boolean {
  if (item.method !== "PER_AREA") return false;
  return item.isReserveFund === true || strip(item.name).includes("odrzavanj");
}

/** Stopa stavke (KM/m²) ispod 0,20 — najnižeg minimuma (fizička lica); inače null. */
export function maintenanceRateBelowMinimum(item: { method: string; name: string; isReserveFund?: boolean; rate: string | null }): boolean {
  if (!isMaintenanceCharge(item) || item.rate == null || item.rate === "") return false;
  try {
    return dec(item.rate).lessThan(minMaintenancePerM2("PERSON"));
  } catch {
    return false;
  }
}

/** Stopa je ispod minimuma za datu vrstu lica. */
export function belowMinimumFor(kind: PartyKindLike, ratePerM2: Decimal): boolean {
  return ratePerM2.lessThan(minMaintenancePerM2(kind));
}
