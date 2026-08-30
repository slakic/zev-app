// Pure charge-calculation engine. Given a charge item definition and the set
// of units in its scope (with per-unit inputs), produce a per-unit amount with
// a full, auditable calculation snapshot. All arithmetic in Decimal.
import { Decimal, ZERO, roundMoney, clampMoney, type RoundingMethod } from "@/lib/money";
import type { ChargeMethod } from "@/generated/prisma/client";

export type BillingUnitInput = {
  unitId: string;
  label: string;
  usableArea: Decimal;
  ownershipShare: Decimal; // % share of the ZEV
  occupantCount: number;
  typeCoefficient: Decimal;
  exempt: boolean;
  customWeight: Decimal | null;
  manualAmount: Decimal | null;
  consumption: Decimal | null; // meter reading for the period
};

export type ChargeDefinitionInput = {
  chargeItemId: string;
  name: string;
  method: ChargeMethod;
  rate: Decimal | null; // amount or unit rate depending on method
  rounding: RoundingMethod;
  minAmount: Decimal | null;
  maxAmount: Decimal | null;
};

export type CalculatedLine = {
  unitId: string;
  amount: Decimal;
  snapshot: {
    chargeItemId: string;
    name: string;
    method: ChargeMethod;
    formula: string;
    inputs: Record<string, string | number | null>;
    allocationBasis: string;
    rounding: RoundingMethod;
    rawAmount: string;
    amount: string;
  };
};

/**
 * Calculate one charge item across the units in its scope.
 * Returns one line per non-exempt unit (exempt units are skipped with amount 0 lines omitted).
 */
export function calculateCharge(
  def: ChargeDefinitionInput,
  units: BillingUnitInput[]
): CalculatedLine[] {
  const active = units.filter((u) => !u.exempt);
  const lines: CalculatedLine[] = [];
  const rate = def.rate ?? ZERO;

  // Pre-compute totals needed by distribution methods.
  const totalArea = active.reduce((a, u) => a.plus(u.usableArea), ZERO);
  const totalShare = active.reduce((a, u) => a.plus(u.ownershipShare), ZERO);
  const totalOccupants = active.reduce((a, u) => a + u.occupantCount, 0);
  const totalCoefficient = active.reduce((a, u) => a.plus(u.typeCoefficient), ZERO);
  const totalCustomWeight = active.reduce(
    (a, u) => a.plus(u.customWeight ?? ZERO),
    ZERO
  );

  for (const u of active) {
    let raw: Decimal;
    let formula: string;
    let allocationBasis: string;
    const inputs: Record<string, string | number | null> = {};

    switch (def.method) {
      case "FIXED_PER_UNIT":
        raw = rate;
        formula = "iznos = fiksna stavka";
        allocationBasis = "po jedinici";
        inputs.rate = rate.toFixed(6);
        break;
      case "PER_AREA":
        raw = rate.mul(u.usableArea);
        formula = "iznos = cijena_po_m2 × korisna_površina";
        allocationBasis = "korisna površina (m²)";
        inputs.rate = rate.toFixed(6);
        inputs.usableArea = u.usableArea.toFixed(2);
        break;
      case "PER_OWNERSHIP_SHARE":
        raw = rate.mul(u.ownershipShare);
        formula = "iznos = stopa × vlasnički_udio(%)";
        allocationBasis = "vlasnički udio u ZEV (%)";
        inputs.rate = rate.toFixed(6);
        inputs.ownershipShare = u.ownershipShare.toFixed(6);
        break;
      case "PER_OCCUPANT":
        raw = rate.mul(u.occupantCount);
        formula = "iznos = cijena_po_korisniku × broj_korisnika";
        allocationBasis = "broj korisnika jedinice";
        inputs.rate = rate.toFixed(6);
        inputs.occupantCount = u.occupantCount;
        break;
      case "EQUAL_SPLIT": {
        const n = active.length;
        raw = n > 0 ? rate.div(n) : ZERO;
        formula = "iznos = ukupan_iznos ÷ broj_jedinica";
        allocationBasis = `jednaka raspodjela na ${n} jedinica`;
        inputs.totalAmount = rate.toFixed(2);
        inputs.unitCount = n;
        break;
      }
      case "UNIT_TYPE_COEFFICIENT": {
        raw = totalCoefficient.isZero()
          ? ZERO
          : rate.mul(u.typeCoefficient).div(totalCoefficient);
        formula = "iznos = ukupan_iznos × koef_jedinice ÷ zbir_koeficijenata";
        allocationBasis = "koeficijent tipa jedinice";
        inputs.totalAmount = rate.toFixed(2);
        inputs.coefficient = u.typeCoefficient.toFixed(3);
        inputs.coefficientSum = totalCoefficient.toFixed(3);
        break;
      }
      case "CONSUMPTION": {
        const qty = u.consumption ?? ZERO;
        raw = rate.mul(qty);
        formula = "iznos = cijena_po_jedinici × očitana_potrošnja";
        allocationBasis = "očitana potrošnja";
        inputs.rate = rate.toFixed(6);
        inputs.consumption = qty.toFixed(3);
        break;
      }
      case "CUSTOM_WEIGHTS": {
        const w = u.customWeight ?? ZERO;
        raw = totalCustomWeight.isZero() ? ZERO : rate.mul(w).div(totalCustomWeight);
        formula = "iznos = ukupan_iznos × ponder ÷ zbir_pondera";
        allocationBasis = "prilagođeni ponderi";
        inputs.totalAmount = rate.toFixed(2);
        inputs.weight = w.toFixed(6);
        inputs.weightSum = totalCustomWeight.toFixed(6);
        break;
      }
      case "MANUAL": {
        raw = u.manualAmount ?? ZERO;
        formula = "iznos = ručno unesen iznos";
        allocationBasis = "ručna dodjela";
        inputs.manualAmount = u.manualAmount?.toFixed(2) ?? null;
        break;
      }
    }

    const clamped = clampMoney(raw, def.minAmount, def.maxAmount);
    const rounded = roundMoney(clamped, def.rounding);
    if (def.minAmount != null) inputs.minAmount = def.minAmount.toFixed(2);
    if (def.maxAmount != null) inputs.maxAmount = def.maxAmount.toFixed(2);

    lines.push({
      unitId: u.unitId,
      amount: rounded,
      snapshot: {
        chargeItemId: def.chargeItemId,
        name: def.name,
        method: def.method,
        formula,
        inputs,
        allocationBasis,
        rounding: def.rounding,
        rawAmount: raw.toFixed(6),
        amount: rounded.toFixed(2),
      },
    });
  }

  // Note on totals: the invoice total is the sum of rounded line amounts.
  // Distribution methods can differ from the nominal total by rounding cents;
  // this is documented in LEGAL_AND_FINANCIAL_ASSUMPTIONS.md §5.5.
  void totalArea;
  void totalShare;
  void totalOccupants;
  return lines;
}
