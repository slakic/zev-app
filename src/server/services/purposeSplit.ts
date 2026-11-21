// Podjela naplaćenog iznosa fakture po namjeni (R-15, B2-Q7). Računa se KUMULATIVNO: koliko od prvih `paid` KM
// fakture otpada na svaku namjenu. Dio jednog rasporeda je razlika kumulativa poslije i prije njega, pa zbir
// svih rasporeda tačno zatvara iznose fakture po namjeni, bez greške zaokruživanja.
import type { prisma } from "@/lib/prisma";
import { Prisma } from "@/generated/prisma/client";
import { sumDecimals, ZERO } from "@/lib/money";
import { toZonedDateIso } from "@/lib/i18n";

type Decimal = Prisma.Decimal;
type Db = Prisma.TransactionClient | typeof prisma;
export type AllocationSplitRule = "NOT_SET" | "PROPORTIONAL" | "OLDEST_FIRST";

/** Pravilo raspodjele djelimične uplate ZEV-a (podešavanje iz A2). */
export async function allocationSplitRule(db: Db, zevId: string): Promise<AllocationSplitRule> {
  const row = await db.setting.findUnique({ where: { zevId_key: { zevId, key: "ledger.partialAllocationRule" } } });
  const v = String(row?.value ?? "NOT_SET");
  return v === "PROPORTIONAL" || v === "OLDEST_FIRST" ? v : "NOT_SET";
}

/** Potvrđeno pravilo zaduženja za vrstu na dan (najkasniji `validFrom` do tog dana). */
export async function confirmedChargeRule(db: Db, zevId: string, chargeTypeId: string, at: Date) {
  return db.postingRule.findFirst({
    where: { zevId, kind: "CHARGE_ISSUED", chargeTypeId, status: "CONFIRMED", validFrom: { lte: at } },
    orderBy: [{ validFrom: "desc" }, { createdAt: "desc" }],
  });
}

/** Namjena vrste zaduženja na dan izdavanja fakture: izričita namjena pravila, inače podrazumijevana namjena vrste. */
export async function chargeTypePurpose(db: Db, zevId: string, chargeTypeId: string, issueDate: Date): Promise<string | null> {
  const day = new Date(`${toZonedDateIso(issueDate)}T00:00:00Z`);
  const rule = await confirmedChargeRule(db, zevId, chargeTypeId, day);
  if (rule?.purposeId) return rule.purposeId;
  const ct = await db.chargeType.findUnique({ where: { id: chargeTypeId }, select: { defaultPurposeId: true } });
  return ct?.defaultPurposeId ?? null;
}

/** Iznos podijeljen srazmjerno težinama, sa ostatkom zaokruživanja na najveću težinu (zbir je tačno `total`). */
export function splitProportionally(total: Decimal, weights: Map<string, Decimal>): Map<string, Decimal> {
  const sum = sumDecimals([...weights.values()]);
  const out = new Map<string, Decimal>();
  if (sum.isZero()) return out;
  let assigned = ZERO;
  let largest: string | null = null;
  for (const [k, w] of weights) {
    const part = total.times(w).dividedBy(sum).toDecimalPlaces(2);
    out.set(k, part);
    assigned = assigned.plus(part);
    if (!largest || w.gt(weights.get(largest)!)) largest = k;
  }
  if (largest) out.set(largest, out.get(largest)!.plus(total.minus(assigned)));
  return out;
}

/**
 * `purposes`: iznosi fakture po namjeni, redom prve linije. PROPORTIONAL — srazmjerno iznosima; OLDEST_FIRST — u
 * okviru jedne fakture redom linija (prva namjena se prva pokriva, B2-Q7 (a)). NOT_SET se ovdje računa srazmjerno
 * (koristi ga samo početno stanje; automatsko knjiženje bez izabranog pravila čeka).
 */
export function purposeSplit(rule: AllocationSplitRule, purposes: Map<string, Decimal>, paid: Decimal): Map<string, Decimal> {
  const total = sumDecimals([...purposes.values()]);
  const capped = paid.gt(total) ? total : paid.lt(0) ? ZERO : paid;
  if (rule !== "OLDEST_FIRST") return splitProportionally(capped, purposes);
  const out = new Map<string, Decimal>();
  let left = capped;
  for (const [k, amount] of purposes) {
    const take = left.gt(amount) ? amount : left;
    out.set(k, take);
    left = left.minus(take);
  }
  return out;
}
