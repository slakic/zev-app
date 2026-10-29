// Pravila registra posebnih dijelova (FR, K-02) kao čiste funkcije — koriste ih servis registra
// (src/server/services/unitRegister.ts) i nacrt onboardinga (Plans/zev-onboarding-wizard-plan.md
// §5.1), da isti preduslovi važe na oba mjesta.
import { dec, ZERO, type Decimal } from "@/lib/money";
import { tf } from "@/lib/i18n";
import type { UnitType } from "@/generated/prisma/enums";

/** Dozvoljena odstupanja zbira udjela jedinica od 100% (zaokruzivanje unosa). */
const SHARE_TOLERANCE = dec("0.01");

/** Polja jedinice od kojih zavise preduslovi — zadovoljava ih i `Unit` i jedinica iz nacrta onboardinga. */
export type RegisterPreconditionUnit = {
  label: string;
  type: UnitType;
  usableArea: { toString(): string } | string;
  ownershipShare: { toString(): string } | string;
  active: boolean;
};

export function sharesSum(shares: Iterable<{ toString(): string } | string>): Decimal {
  let sum = ZERO;
  for (const s of shares) sum = sum.plus(dec(s.toString()));
  return sum;
}

export function sumIsHundred(sum: Decimal): boolean {
  return sum.minus(100).abs().lessThanOrEqualTo(SHARE_TOLERANCE);
}

export type RegisterPrecondition = { key: "UNITS" | "FIELDS" | "SHARE_SUM"; ok: boolean; text: string };

/** Preduslovi utvrdjivanja registra (✓/⚠ lista u panelu "Sljedeci korak"). Ista funkcija provjerava i
 *  nacrt onboardinga (Plans/zev-onboarding-wizard-plan.md §5.1). */
export function registerPreconditions(units: RegisterPreconditionUnit[]): RegisterPrecondition[] {
  const active = units.filter((u) => u.active);
  const badFields = active.filter((u) => !u.label.trim() || !u.type || dec(u.usableArea.toString()).lessThanOrEqualTo(0));
  const sum = sharesSum(active.map((u) => u.ownershipShare));
  return [
    {
      key: "UNITS",
      ok: active.length > 0,
      text: active.length > 0
        ? tf("register.pre.unitsOk", { count: active.length })
        : tf("register.pre.unitsMissing", {}),
    },
    {
      key: "FIELDS",
      ok: active.length > 0 && badFields.length === 0,
      text: badFields.length === 0
        ? tf("register.pre.fieldsOk", {})
        : tf("register.pre.fieldsMissing", { labels: badFields.map((u) => u.label || "?").join(", ") }),
    },
    {
      key: "SHARE_SUM",
      ok: active.length > 0 && sumIsHundred(sum),
      text: sumIsHundred(sum) && active.length > 0
        ? tf("register.pre.shareOk", {})
        : tf("register.pre.shareBad", { sum: sum.toFixed(2).replace(".", ",") }),
    },
  ];
}

