// Charge items, calculation preview, invoice batches, invoice lifecycle.
// Issued invoices are never deleted or silently replaced: corrections create
// linked corrective invoices, cancellation keeps the original visible.
import { prisma } from "@/lib/prisma";
import { audit } from "@/server/audit";
import { requireRole, requireSelfOrRole, requireAnyUser, type Actor } from "@/server/auth/guards";
import { calculateCharge, type BillingUnitInput, type ChargeDefinitionInput } from "@/server/engines/billing";
import { dec, ZERO, sumDecimals, type Decimal } from "@/lib/money";
import { unitsInScope } from "./property";
import { currentStakesForUnit, partyDisplayName } from "./ownership";
import type { ChargeMethod, BillingFrequency, RoundingMethod, ScopeType, Prisma } from "@/generated/prisma/client";

// ---- Charge items ----

export async function listChargeItems(actor: Actor) {
  requireRole(actor, "PRESIDENT", "ACCOUNTANT");
  return prisma.chargeItem.findMany({
    include: { unitOverrides: { include: { unit: true } } },
    orderBy: { displayOrder: "asc" },
  });
}

export async function createChargeItem(
  actor: Actor,
  data: {
    name: string;
    description?: string | null;
    scopeType: ScopeType;
    buildingId?: string | null;
    entranceId?: string | null;
    allocationGroupId?: string | null;
    method: ChargeMethod;
    rate?: string | null;
    effectiveFrom: Date;
    effectiveTo?: Date | null;
    frequency?: BillingFrequency;
    dueDayOfMonth?: number;
    rounding?: RoundingMethod;
    minAmount?: string | null;
    maxAmount?: string | null;
    displayOrder?: number;
    isReserveFund?: boolean;
    overrides?: { unitId: string; exempt?: boolean; customWeight?: string | null; manualAmount?: string | null }[];
  }
) {
  requireRole(actor, "ACCOUNTANT", "PRESIDENT");
  const item = await prisma.chargeItem.create({
    data: {
      name: data.name,
      description: data.description ?? null,
      scopeType: data.scopeType,
      buildingId: data.buildingId ?? null,
      entranceId: data.entranceId ?? null,
      allocationGroupId: data.allocationGroupId ?? null,
      method: data.method,
      rate: data.rate ?? null,
      effectiveFrom: data.effectiveFrom,
      effectiveTo: data.effectiveTo ?? null,
      frequency: data.frequency ?? "MONTHLY",
      dueDayOfMonth: data.dueDayOfMonth ?? 15,
      rounding: data.rounding ?? "HALF_UP_2",
      minAmount: data.minAmount ?? null,
      maxAmount: data.maxAmount ?? null,
      displayOrder: data.displayOrder ?? 0,
      isReserveFund: data.isReserveFund ?? false,
      unitOverrides: data.overrides?.length
        ? {
            create: data.overrides.map((o) => ({
              unitId: o.unitId,
              exempt: o.exempt ?? false,
              customWeight: o.customWeight ?? null,
              manualAmount: o.manualAmount ?? null,
            })),
          }
        : undefined,
    },
  });
  await audit(actor, { action: "charge_item.create", targetType: "ChargeItem", targetId: item.id, after: { name: item.name, method: item.method, rate: item.rate?.toString() ?? null } });
  return item;
}

export async function updateChargeItem(actor: Actor, id: string, data: Prisma.ChargeItemUncheckedUpdateInput) {
  requireRole(actor, "ACCOUNTANT", "PRESIDENT");
  const before = await prisma.chargeItem.findUniqueOrThrow({ where: { id } });
  const item = await prisma.chargeItem.update({ where: { id }, data });
  await audit(actor, {
    action: "charge_item.update", targetType: "ChargeItem", targetId: id,
    before: { name: before.name, rate: before.rate?.toString() ?? null, method: before.method },
    after: { name: item.name, rate: item.rate?.toString() ?? null, method: item.method },
  });
  return item;
}

export async function enterMeterReading(
  actor: Actor,
  data: { chargeItemId: string; unitId: string; period: string; quantity: string }
) {
  requireRole(actor, "ACCOUNTANT", "PRESIDENT");
  const r = await prisma.meterReading.upsert({
    where: { chargeItemId_unitId_period: { chargeItemId: data.chargeItemId, unitId: data.unitId, period: data.period } },
    create: { ...data, enteredById: actor.userId },
    update: { quantity: data.quantity, enteredById: actor.userId },
  });
  await audit(actor, { action: "meter_reading.enter", targetType: "MeterReading", targetId: r.id, after: { ...data } });
  return r;
}

// ---- Calculation preview & batch issue ----

export type UnitCalculation = {
  unitId: string;
  unitLabel: string;
  buildingName: string;
  debtorId: string | null;
  debtorName: string;
  lines: {
    chargeItemId: string;
    name: string;
    method: ChargeMethod;
    formula: string;
    inputs: Record<string, string | number | null>;
    allocationBasis: string;
    rounding: string;
    rawAmount: string;
    amount: string;
  }[];
  total: string;
};

function isItemActiveInPeriod(item: { effectiveFrom: Date; effectiveTo: Date | null; frequency: BillingFrequency; active: boolean }, period: string): boolean {
  if (!item.active) return false;
  const [y, m] = period.split("-").map(Number);
  const periodStart = new Date(Date.UTC(y, m - 1, 1));
  const periodEnd = new Date(Date.UTC(y, m, 0, 23, 59, 59));
  if (item.effectiveFrom > periodEnd) return false;
  if (item.effectiveTo && item.effectiveTo < periodStart) return false;
  return true;
}

/**
 * Full calculation preview for a billing period: for every unit, every charge
 * item with formula, inputs, allocation basis, rounding and totals.
 */
export async function previewBatch(actor: Actor, period: string, chargeItemIds?: string[]): Promise<UnitCalculation[]> {
  requireRole(actor, "ACCOUNTANT", "PRESIDENT");
  const items = await prisma.chargeItem.findMany({
    where: { id: chargeItemIds?.length ? { in: chargeItemIds } : undefined },
    include: { unitOverrides: true },
    orderBy: { displayOrder: "asc" },
  });
  const activeItems = items.filter((i) => isItemActiveInPeriod(i, period));

  const perUnit = new Map<string, UnitCalculation>();
  const unitCache = new Map<string, { label: string; buildingName: string }>();

  for (const item of activeItems) {
    const units = await unitsInScope({
      scopeType: item.scopeType,
      buildingId: item.buildingId,
      entranceId: item.entranceId,
      allocationGroupId: item.allocationGroupId,
      unitIds: item.scopeType === "UNITS" ? item.unitOverrides.map((o) => o.unitId) : undefined,
    });
    if (units.length === 0) continue;
    const readings =
      item.method === "CONSUMPTION"
        ? await prisma.meterReading.findMany({ where: { chargeItemId: item.id, period } })
        : [];
    const readingByUnit = new Map(readings.map((r) => [r.unitId, dec(r.quantity.toString())]));
    const overrideByUnit = new Map(item.unitOverrides.map((o) => [o.unitId, o]));

    const inputs: BillingUnitInput[] = units.map((u) => {
      const o = overrideByUnit.get(u.id);
      return {
        unitId: u.id,
        label: u.label,
        usableArea: dec(u.usableArea.toString()),
        ownershipShare: dec(u.ownershipShare.toString()),
        occupantCount: u.occupantCount,
        typeCoefficient: dec(u.typeCoefficient.toString()),
        exempt: o?.exempt ?? false,
        customWeight: o?.customWeight != null ? dec(o.customWeight.toString()) : null,
        manualAmount: o?.manualAmount != null ? dec(o.manualAmount.toString()) : null,
        consumption: readingByUnit.get(u.id) ?? null,
      };
    });
    const def: ChargeDefinitionInput = {
      chargeItemId: item.id,
      name: item.name,
      method: item.method,
      rate: item.rate != null ? dec(item.rate.toString()) : null,
      rounding: item.rounding,
      minAmount: item.minAmount != null ? dec(item.minAmount.toString()) : null,
      maxAmount: item.maxAmount != null ? dec(item.maxAmount.toString()) : null,
    };
    const lines = calculateCharge(def, inputs);

    for (const line of lines) {
      if (!unitCache.has(line.unitId)) {
        const u = await prisma.unit.findUniqueOrThrow({ where: { id: line.unitId }, include: { building: true } });
        unitCache.set(line.unitId, { label: u.label, buildingName: u.building.name });
      }
      const meta = unitCache.get(line.unitId)!;
      const cur = perUnit.get(line.unitId) ?? {
        unitId: line.unitId,
        unitLabel: meta.label,
        buildingName: meta.buildingName,
        debtorId: null,
        debtorName: "",
        lines: [],
        total: "0.00",
      };
      cur.lines.push(line.snapshot);
      perUnit.set(line.unitId, cur);
    }
  }

  // Resolve debtor (current majority owner / invoice recipient) per unit.
  const result: UnitCalculation[] = [];
  for (const calc of perUnit.values()) {
    const unit = await prisma.unit.findUniqueOrThrow({ where: { id: calc.unitId }, include: { invoiceRecipient: true } });
    const stakes = await currentStakesForUnit(calc.unitId);
    let debtorId: string | null = null;
    let debtorName = "—";
    if (unit.invoiceRecipient) {
      debtorId = unit.invoiceRecipient.id;
      debtorName = partyDisplayName(unit.invoiceRecipient);
    } else if (stakes.length > 0) {
      const main = [...stakes].sort((a, b) => Number(b.sharePercent) - Number(a.sharePercent))[0];
      debtorId = main.ownerId;
      debtorName = partyDisplayName(main.owner);
    }
    const total = sumDecimals(calc.lines.map((l) => dec(l.amount)));
    result.push({ ...calc, debtorId, debtorName, total: total.toFixed(2) });
  }
  return result.sort((a, b) => a.buildingName.localeCompare(b.buildingName) || a.unitLabel.localeCompare(b.unitLabel));
}

export async function createDraftBatch(actor: Actor, period: string, description?: string, chargeItemIds?: string[]) {
  requireRole(actor, "ACCOUNTANT");
  const preview = await previewBatch(actor, period, chargeItemIds);
  const batch = await prisma.invoiceBatch.create({
    data: {
      period,
      description: description ?? null,
      previewData: preview as unknown as Prisma.InputJsonValue,
      createdById: actor.userId,
    },
  });
  await audit(actor, { action: "invoice_batch.create_draft", targetType: "InvoiceBatch", targetId: batch.id, after: { period, units: preview.length } });
  return { batch, preview };
}

async function nextInvoiceNumber(tx: Prisma.TransactionClient, year: number): Promise<string> {
  const prefix = `FAK-${year}-`;
  const last = await tx.invoice.findFirst({
    where: { number: { startsWith: prefix } },
    orderBy: { number: "desc" },
    select: { number: true },
  });
  const seq = last ? parseInt(last.number.slice(prefix.length), 10) + 1 : 1;
  return `${prefix}${String(seq).padStart(6, "0")}`;
}

/**
 * Issue a draft batch: creates numbered invoices with full calculation
 * snapshots in one transaction. Prevents duplicate issuance per period.
 */
export async function issueBatch(actor: Actor, batchId: string, opts?: { dueDate?: Date }) {
  requireRole(actor, "ACCOUNTANT");
  return prisma.$transaction(async (tx) => {
    const batch = await tx.invoiceBatch.findUniqueOrThrow({ where: { id: batchId } });
    if (batch.status !== "DRAFT") throw new Error("Samo nacrt serije može biti izdat.");
    const already = await tx.invoiceBatch.findFirst({
      where: { period: batch.period, status: "ISSUED", NOT: { id: batchId } },
    });
    if (already) throw new Error(`Za period ${batch.period} već postoji izdata serija faktura.`);

    const preview = (batch.previewData as unknown as UnitCalculation[]) ?? [];
    if (preview.length === 0) throw new Error("Serija nema obračunatih stavki.");

    const year = Number(batch.period.slice(0, 4)) || new Date().getFullYear();
    const [y, m] = batch.period.split("-").map(Number);
    const defaultDue = opts?.dueDate ?? new Date(Date.UTC(y || year, (m || 1) - 1, 15));
    const issueDate = new Date();

    const invoices = [];
    for (const calc of preview) {
      if (!calc.debtorId) throw new Error(`Jedinica ${calc.unitLabel} nema evidentiranog vlasnika/primaoca fakture.`);
      const number = await nextInvoiceNumber(tx, year);
      const inv = await tx.invoice.create({
        data: {
          number,
          batchId: batch.id,
          unitId: calc.unitId,
          debtorId: calc.debtorId,
          issueDate,
          dueDate: defaultDue,
          periodLabel: batch.period,
          total: calc.total,
          status: "ISSUED",
          paymentReference: `${batch.period.replace("-", "")}-${calc.unitId.slice(-6).toUpperCase()}`,
          lines: {
            create: calc.lines.map((l, idx) => ({
              chargeItemId: l.chargeItemId,
              description: l.name,
              calcSnapshot: l as unknown as Prisma.InputJsonValue,
              amount: l.amount,
              order: idx,
            })),
          },
        },
      });
      invoices.push(inv);
      await audit(actor, {
        action: "invoice.issue",
        targetType: "Invoice",
        targetId: inv.id,
        after: { number: inv.number, unitId: inv.unitId, debtorId: inv.debtorId, total: inv.total.toString() },
      }, tx);
    }
    await tx.invoiceBatch.update({ where: { id: batchId }, data: { status: "ISSUED", issuedAt: new Date() } });
    await audit(actor, { action: "invoice_batch.issue", targetType: "InvoiceBatch", targetId: batchId, after: { count: invoices.length, period: batch.period } }, tx);
    return invoices;
  }, { timeout: 30000 });
}

/** One-time single invoice (e.g. special charge). */
export async function issueSingleInvoice(
  actor: Actor,
  data: { unitId: string; debtorId: string; dueDate: Date; description: string; amount: string; periodLabel?: string }
) {
  requireRole(actor, "ACCOUNTANT");
  return prisma.$transaction(async (tx) => {
    const number = await nextInvoiceNumber(tx, new Date().getFullYear());
    const inv = await tx.invoice.create({
      data: {
        number,
        unitId: data.unitId,
        debtorId: data.debtorId,
        issueDate: new Date(),
        dueDate: data.dueDate,
        periodLabel: data.periodLabel ?? null,
        total: data.amount,
        status: "ISSUED",
        lines: {
          create: [{
            description: data.description,
            calcSnapshot: { method: "MANUAL", formula: "ručno unesen iznos", inputs: { amount: data.amount }, allocationBasis: "jednokratno", rounding: "HALF_UP_2", rawAmount: data.amount, amount: data.amount, name: data.description, chargeItemId: null } as unknown as Prisma.InputJsonValue,
            amount: data.amount,
          }],
        },
      },
    });
    await audit(actor, { action: "invoice.issue", targetType: "Invoice", targetId: inv.id, after: { number: inv.number, total: data.amount, oneTime: true } }, tx);
    return inv;
  });
}

// ---- Invoice queries with owner isolation ----

export async function listInvoices(actor: Actor, filter?: { debtorId?: string; unitId?: string; status?: string; period?: string }) {
  requireAnyUser(actor);
  const isManagement = actor.roles.includes("PRESIDENT") || actor.roles.includes("ACCOUNTANT");
  const debtorId = isManagement ? filter?.debtorId : actor.partyId ?? "__none__";
  return prisma.invoice.findMany({
    where: {
      debtorId: debtorId ?? undefined,
      unitId: filter?.unitId,
      status: filter?.status as never,
      periodLabel: filter?.period,
    },
    include: { unit: { include: { building: true } }, debtor: true, allocations: true },
    orderBy: { number: "desc" },
  });
}

export async function getInvoice(actor: Actor, id: string) {
  requireAnyUser(actor);
  const inv = await prisma.invoice.findUniqueOrThrow({
    where: { id },
    include: {
      unit: { include: { building: true } },
      debtor: true,
      lines: { orderBy: { order: "asc" } },
      allocations: { include: { payment: true } },
      correctionOf: true,
      correctedBy: true,
    },
  });
  requireSelfOrRole(actor, inv.debtorId, "PRESIDENT", "ACCOUNTANT");
  return inv;
}

export function invoicePaidAmount(inv: { allocations: { amount: Prisma.Decimal }[] }): Decimal {
  return inv.allocations.reduce((a, x) => a.plus(dec(x.amount.toString())), ZERO);
}

/** Cancel (storno) an issued invoice — original stays visible. */
export async function cancelInvoice(actor: Actor, invoiceId: string, reason: string) {
  requireRole(actor, "ACCOUNTANT");
  if (!reason.trim()) throw new Error("Storniranje zahtijeva razlog.");
  return prisma.$transaction(async (tx) => {
    const inv = await tx.invoice.findUniqueOrThrow({ where: { id: invoiceId }, include: { allocations: true } });
    if (inv.status === "CANCELLED") throw new Error("Faktura je već stornirana.");
    const paid = invoicePaidAmount(inv);
    if (!paid.isZero()) throw new Error("Faktura sa raspoređenim uplatama ne može se stornirati — prvo stornirajte alokacije.");
    const updated = await tx.invoice.update({
      where: { id: invoiceId },
      data: { status: "CANCELLED", cancelledAt: new Date(), cancelReason: reason },
    });
    await audit(actor, {
      action: "invoice.cancel", targetType: "Invoice", targetId: invoiceId,
      before: { status: inv.status }, after: { status: "CANCELLED" }, reason,
    }, tx);
    return updated;
  });
}

/**
 * Correct an issued invoice: cancels the original (visible) and issues a new
 * corrective invoice linked to it.
 */
export async function correctInvoice(
  actor: Actor,
  invoiceId: string,
  data: { newTotal: string; description: string; reason: string }
) {
  requireRole(actor, "ACCOUNTANT");
  if (!data.reason.trim()) throw new Error("Korekcija zahtijeva razlog.");
  return prisma.$transaction(async (tx) => {
    const original = await tx.invoice.findUniqueOrThrow({ where: { id: invoiceId }, include: { correctedBy: true } });
    if (original.status !== "ISSUED") throw new Error("Samo izdata faktura može biti korigovana.");
    if (original.correctedBy) throw new Error("Faktura je već korigovana.");
    const number = await nextInvoiceNumber(tx, new Date().getFullYear());
    const corrective = await tx.invoice.create({
      data: {
        number,
        unitId: original.unitId,
        debtorId: original.debtorId,
        issueDate: new Date(),
        dueDate: original.dueDate,
        periodLabel: original.periodLabel,
        total: data.newTotal,
        status: "ISSUED",
        correctionOfId: original.id,
        lines: {
          create: [{
            description: data.description,
            calcSnapshot: {
              method: "MANUAL", formula: "korektivna faktura", name: data.description,
              inputs: { originalInvoice: original.number, originalTotal: original.total.toString(), newTotal: data.newTotal },
              allocationBasis: "korekcija", rounding: "HALF_UP_2", rawAmount: data.newTotal, amount: data.newTotal, chargeItemId: null,
            } as unknown as Prisma.InputJsonValue,
            amount: data.newTotal,
          }],
        },
      },
    });
    await tx.invoice.update({ where: { id: original.id }, data: { status: "CORRECTED" } });
    await audit(actor, {
      action: "invoice.correct",
      targetType: "Invoice",
      targetId: corrective.id,
      before: { originalId: original.id, originalNumber: original.number, originalTotal: original.total.toString() },
      after: { number: corrective.number, total: data.newTotal },
      reason: data.reason,
    }, tx);
    return corrective;
  });
}
