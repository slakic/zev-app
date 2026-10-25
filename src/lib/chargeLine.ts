// Čitljiva rečenica "Osnov obračuna" za vlasnika (F3.2), složena iz `calcSnapshot.inputs` stavke fakture
// (src/server/engines/billing.ts). Uprava i dalje vidi sirove "Formula" i "Ulazi". Za nepoznat metod ili
// nepotpune ulaze vraća postojeći `allocationBasis`, pa nikad ne izmišlja objašnjenje.
import { Decimal, dec } from "@/lib/money";
import { tf } from "@/lib/i18n";
import { isOneForm as isOne, isFewForm as isFew } from "@/lib/plural";

export type ChargeSnapshot = {
  method?: string;
  allocationBasis?: string;
  inputs?: Record<string, unknown> | null;
} | null | undefined;

/** Broj sa decimalnim zarezom i tačkom za hiljade; nule s kraja se skidaju do `minDec` decimala. */
function num(value: unknown, minDec = 2, maxDec = 6): string | null {
  if (value == null || value === "") return null;
  let d: Decimal;
  try {
    d = dec(value as string | number);
  } catch {
    return null;
  }
  if (!d.isFinite()) return null;
  const [intPart, fracRaw = ""] = d.toFixed(maxDec).split(".");
  let frac = fracRaw;
  while (frac.length > minDec && frac.endsWith("0")) frac = frac.slice(0, -1);
  const negative = intPart.startsWith("-");
  const grouped = (negative ? intPart.slice(1) : intPart).replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  return `${negative ? "-" : ""}${grouped}${frac ? `,${frac}` : ""}`;
}

function wholeNumber(value: unknown): number | null {
  if (value == null || value === "") return null;
  const n = Number(value);
  return Number.isInteger(n) ? n : null;
}

function limits(inputs: Record<string, unknown>): string {
  const min = num(inputs.minAmount);
  const max = num(inputs.maxAmount);
  return (min ? tf("chargeLine.min", { iznos: min }) : "") + (max ? tf("chargeLine.max", { iznos: max }) : "");
}

export function describeChargeLine(snapshot: ChargeSnapshot): string {
  const fallback = snapshot?.allocationBasis ?? "";
  const inputs = snapshot?.inputs;
  if (!snapshot || !inputs || typeof inputs !== "object") return fallback;

  let text: string | null = null;
  switch (snapshot.method) {
    case "FIXED_PER_UNIT":
      text = tf("chargeLine.fixedPerUnit", {});
      break;
    case "PER_AREA": {
      const area = num(inputs.usableArea);
      const rate = num(inputs.rate);
      if (area && rate) text = tf("chargeLine.perArea", { povrsina: area, cijena: rate });
      break;
    }
    case "PER_OWNERSHIP_SHARE": {
      const share = num(inputs.ownershipShare);
      const rate = num(inputs.rate);
      if (share && rate) text = tf("chargeLine.perShare", { udio: share, cijena: rate });
      break;
    }
    case "PER_OCCUPANT": {
      const n = wholeNumber(inputs.occupantCount);
      const rate = num(inputs.rate);
      if (n != null && rate) {
        text = tf(isOne(n) ? "chargeLine.perOccupant.one" : "chargeLine.perOccupant.other", { broj: n, cijena: rate });
      }
      break;
    }
    case "EQUAL_SPLIT": {
      const total = num(inputs.totalAmount);
      const n = wholeNumber(inputs.unitCount);
      if (total && n != null) {
        const key = isOne(n) ? "one" : isFew(n) ? "few" : "other";
        text = tf(`chargeLine.equalSplit.${key}`, { ukupno: total, broj: n });
      }
      break;
    }
    case "UNIT_TYPE_COEFFICIENT": {
      const total = num(inputs.totalAmount);
      const coef = num(inputs.coefficient, 0, 3);
      const sum = num(inputs.coefficientSum, 0, 3);
      if (total && coef && sum) text = tf("chargeLine.coefficient", { koeficijent: coef, zbir: sum, ukupno: total });
      break;
    }
    case "CONSUMPTION": {
      const qty = num(inputs.consumption, 0, 3);
      const rate = num(inputs.rate);
      if (qty && rate) text = tf("chargeLine.consumption", { kolicina: qty, cijena: rate });
      break;
    }
    case "CUSTOM_WEIGHTS": {
      const total = num(inputs.totalAmount);
      const w = num(inputs.weight, 0, 6);
      const sum = num(inputs.weightSum, 0, 6);
      if (total && w && sum) text = tf("chargeLine.weights", { ponder: w, zbir: sum, ukupno: total });
      break;
    }
    case "MANUAL":
      // Ručna dodjela iz obračuna ima `manualAmount`; jednokratne i korektivne fakture imaju svoj allocationBasis.
      if ("manualAmount" in inputs) text = tf("chargeLine.manual", {});
      break;
  }
  return text ? text + limits(inputs) : fallback;
}

/** „Stopa/iznos” stavke naknade za upravu (F5a.4): iznos sa decimalnim zarezom i jedinicom po metodi
 *  („0,30 KM/m²”, „8,00 KM po jedinici”, „120,00 KM ukupno”). Bez cijene piše „—”. */
export function describeChargeRate(method: string, rate: unknown): string {
  if (method === "MANUAL") return tf("chargeRate.manual", {});
  const iznos = num(rate);
  if (!iznos) return "—";
  switch (method) {
    case "FIXED_PER_UNIT": return tf("chargeRate.perUnit", { iznos });
    case "PER_AREA": return tf("chargeRate.perArea", { iznos });
    case "PER_OWNERSHIP_SHARE": return tf("chargeRate.perShare", { iznos });
    case "PER_OCCUPANT": return tf("chargeRate.perOccupant", { iznos });
    case "CONSUMPTION": return tf("chargeRate.perConsumption", { iznos });
    default: return tf("chargeRate.total", { iznos }); // EQUAL_SPLIT, UNIT_TYPE_COEFFICIENT, CUSTOM_WEIGHTS: ukupan iznos za raspodjelu
  }
}
