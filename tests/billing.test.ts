import { describe, it, expect, beforeAll } from "vitest";
import { prisma } from "@/lib/prisma";
import { createFixture, createAreaCharges, uid, type Fixture } from "./helpers";
import { calculateCharge } from "@/server/engines/billing";
import { dec } from "@/lib/money";
import {
  createChargeItem, createDraftBatch, issueBatch, previewBatch,
  correctInvoice, cancelInvoice, enterMeterReading,
} from "@/server/services/billing";
import { transferOwnership } from "@/server/services/ownership";

const U = (id: string, over?: Partial<Parameters<typeof calculateCharge>[1][number]>) => ({
  unitId: id, label: id, usableArea: dec("50"), ownershipShare: dec("25"),
  occupantCount: 2, typeCoefficient: dec("1"), exempt: false,
  customWeight: null, manualAmount: null, consumption: null, ...over,
});

describe("charge calculation engine — every allocation method", () => {
  const def = (method: string, rate: string | null, extra?: object) => ({
    chargeItemId: "ci", name: "Test", method: method as never,
    rate: rate ? dec(rate) : null, rounding: "HALF_UP_2" as const,
    minAmount: null, maxAmount: null, ...extra,
  });

  it("FIXED_PER_UNIT", () => {
    const lines = calculateCharge(def("FIXED_PER_UNIT", "8.00"), [U("a"), U("b")]);
    expect(lines.map((l) => l.amount.toFixed(2))).toEqual(["8.00", "8.00"]);
  });

  it("PER_AREA", () => {
    const lines = calculateCharge(def("PER_AREA", "0.30"), [U("a", { usableArea: dec("62.5") })]);
    expect(lines[0].amount.toFixed(2)).toBe("18.75");
    expect(lines[0].snapshot.inputs.usableArea).toBe("62.50");
  });

  it("PER_OWNERSHIP_SHARE", () => {
    const lines = calculateCharge(def("PER_OWNERSHIP_SHARE", "0.80"), [U("a", { ownershipShare: dec("14.5") })]);
    expect(lines[0].amount.toFixed(2)).toBe("11.60");
  });

  it("PER_OCCUPANT", () => {
    const lines = calculateCharge(def("PER_OCCUPANT", "2.50"), [U("a", { occupantCount: 3 })]);
    expect(lines[0].amount.toFixed(2)).toBe("7.50");
  });

  it("EQUAL_SPLIT distributes the total across non-exempt units", () => {
    const lines = calculateCharge(def("EQUAL_SPLIT", "120.00"), [U("a"), U("b"), U("c", { exempt: true })]);
    expect(lines).toHaveLength(2);
    expect(lines[0].amount.toFixed(2)).toBe("60.00");
  });

  it("UNIT_TYPE_COEFFICIENT weights by coefficient", () => {
    const lines = calculateCharge(def("UNIT_TYPE_COEFFICIENT", "100.00"), [
      U("a", { typeCoefficient: dec("1.5") }),
      U("b", { typeCoefficient: dec("0.5") }),
    ]);
    expect(lines[0].amount.toFixed(2)).toBe("75.00");
    expect(lines[1].amount.toFixed(2)).toBe("25.00");
  });

  it("CONSUMPTION multiplies rate by metered quantity", () => {
    const lines = calculateCharge(def("CONSUMPTION", "1.95"), [U("a", { consumption: dec("3.4") })]);
    expect(lines[0].amount.toFixed(2)).toBe("6.63");
  });

  it("CUSTOM_WEIGHTS distributes by weights", () => {
    const lines = calculateCharge(def("CUSTOM_WEIGHTS", "90.00"), [
      U("a", { customWeight: dec("2") }),
      U("b", { customWeight: dec("1") }),
    ]);
    expect(lines[0].amount.toFixed(2)).toBe("60.00");
    expect(lines[1].amount.toFixed(2)).toBe("30.00");
  });

  it("MANUAL uses the manually assigned amount", () => {
    const lines = calculateCharge(def("MANUAL", null), [U("a", { manualAmount: dec("42.42") })]);
    expect(lines[0].amount.toFixed(2)).toBe("42.42");
  });

  it("rounding: repeating decimals round half-up to 2 places, snapshot keeps the raw value", () => {
    const lines = calculateCharge(def("EQUAL_SPLIT", "100.00"), [U("a"), U("b"), U("c")]);
    expect(lines[0].amount.toFixed(2)).toBe("33.33");
    expect(lines[0].snapshot.rawAmount).toBe("33.333333");
    // documented behaviour: invoice total = sum of rounded lines (99.99, not 100)
    const total = lines.reduce((a, l) => a.plus(l.amount), dec(0));
    expect(total.toFixed(2)).toBe("99.99");
  });

  it("min/max clamping applies before rounding", () => {
    const lines = calculateCharge(
      { ...def("PER_AREA", "0.01"), minAmount: dec("5.00"), maxAmount: null },
      [U("a", { usableArea: dec("10") })] // raw 0.10 -> min 5.00
    );
    expect(lines[0].amount.toFixed(2)).toBe("5.00");
  });
});

describe("invoice batches (integration)", () => {
  let f: Fixture;
  let chargeIds: string[];
  beforeAll(async () => {
    f = await createFixture("bill");
    chargeIds = await createAreaCharges(f, "0.30");
    for (const b of [f.b1, f.b2]) {
      const share = await createChargeItem(f.accountant, {
        name: `Fond-${uid(f.t)}`, method: "PER_OWNERSHIP_SHARE", rate: "0.80",
        scopeType: "BUILDING", buildingId: b.id, effectiveFrom: new Date("2020-01-01"), displayOrder: 2, isReserveFund: true,
      });
      chargeIds.push(share.id);
    }
    const cons = await createChargeItem(f.accountant, {
      name: `Voda-${f.t}`, method: "CONSUMPTION", rate: "2.00",
      scopeType: "BUILDING", buildingId: f.b1.id, effectiveFrom: new Date("2020-01-01"), displayOrder: 3,
    });
    chargeIds.push(cons.id);
    await enterMeterReading(f.accountant, { chargeItemId: cons.id, unitId: f.u1.id, period: "2031-01", quantity: "5.000" });
  });

  it("preview shows formula, inputs, allocation basis and rounding for every unit", async () => {
    const preview = await previewBatch(f.accountant, "2031-01", chargeIds);
    expect(preview.length).toBe(4);
    const u1calc = preview.find((c) => c.unitId === f.u1.id)!;
    // three items apply to u1: area 50*0.3=15, share 25*0.8=20, water 5*2=10
    expect(u1calc.lines).toHaveLength(3);
    expect(u1calc.total).toBe("45.00");
    for (const line of u1calc.lines) {
      expect(line.formula.length).toBeGreaterThan(3);
      expect(Object.keys(line.inputs).length).toBeGreaterThan(0);
      expect(line.allocationBasis.length).toBeGreaterThan(2);
    }
  });

  it("one invoice combines several calculation methods; totals reconcile", async () => {
    const { batch } = await createDraftBatch(f.accountant, "2031-01", undefined, chargeIds);
    const invoices = await issueBatch(f.accountant, batch.id);
    const invU1 = invoices.find((i) => i.unitId === f.u1.id)!;
    const full = await prisma.invoice.findUniqueOrThrow({ where: { id: invU1.id }, include: { lines: true } });
    expect(full.lines).toHaveLength(3);
    const lineSum = full.lines.reduce((a, l) => a + Number(l.amount), 0);
    expect(lineSum.toFixed(2)).toBe(Number(full.total).toFixed(2));
    expect(full.number).toMatch(/^FAK-\d{4}-\d{6}$/);
  });

  it("duplicate issuance for the same period is prevented", async () => {
    const { batch } = await createDraftBatch(f.accountant, "2031-01", undefined, chargeIds);
    await expect(issueBatch(f.accountant, batch.id)).rejects.toThrow(/već postoji izdata serija/);
  });

  it("correction preserves the original invoice and links the corrective one", async () => {
    const original = await prisma.invoice.findFirstOrThrow({
      where: { unitId: f.u2.id, status: "ISSUED", periodLabel: "2031-01" },
    });
    const corrective = await correctInvoice(f.accountant, original.id, {
      newTotal: "10.00", description: "Ispravka pogrešne površine", reason: "pogrešan unos m2",
    });
    const after = await prisma.invoice.findUniqueOrThrow({ where: { id: original.id } });
    expect(after.status).toBe("CORRECTED");
    expect(after.total.toString()).toBe(original.total.toString()); // untouched
    expect(corrective.correctionOfId).toBe(original.id);
    // audited
    const audits = await prisma.auditEvent.findMany({ where: { action: "invoice.correct", targetId: corrective.id } });
    expect(audits).toHaveLength(1);
  });

  it("cancelling requires a reason and keeps the invoice visible", async () => {
    const inv = await prisma.invoice.findFirstOrThrow({
      where: { unitId: f.u4.id, status: "ISSUED", periodLabel: "2031-01" },
    });
    await expect(cancelInvoice(f.accountant, inv.id, " ")).rejects.toThrow();
    await cancelInvoice(f.accountant, inv.id, "testni storno");
    const after = await prisma.invoice.findUniqueOrThrow({ where: { id: inv.id } });
    expect(after.status).toBe("CANCELLED");
    expect(after.cancelReason).toBe("testni storno");
  });

  it("an ownership change does not rewrite already-issued invoices", async () => {
    const invBefore = await prisma.invoice.findFirstOrThrow({
      where: { unitId: f.u1.id, periodLabel: "2031-01" },
    });
    expect(invBefore.debtorId).toBe(f.ownerA.id);
    await transferOwnership(f.president, {
      unitId: f.u1.id, fromOwnerId: f.ownerA.id, toOwnerId: f.ownerC.id,
      effectiveDate: new Date(), note: "prodaja",
    });
    const invAfter = await prisma.invoice.findUniqueOrThrow({ where: { id: invBefore.id } });
    expect(invAfter.debtorId).toBe(f.ownerA.id); // historical debtor unchanged
    // old stake closed, not deleted
    const oldStake = await prisma.ownershipStake.findFirst({
      where: { unitId: f.u1.id, ownerId: f.ownerA.id },
    });
    expect(oldStake?.validTo).not.toBeNull();
    // and the next batch bills the NEW owner
    const { batch } = await createDraftBatch(f.accountant, "2031-02", undefined, chargeIds);
    const preview = (await prisma.invoiceBatch.findUniqueOrThrow({ where: { id: batch.id } }))
      .previewData as unknown as { unitId: string; debtorId: string }[];
    const u1next = preview.find((c) => c.unitId === f.u1.id)!;
    expect(u1next.debtorId).toBe(f.ownerC.id);
  });
});
