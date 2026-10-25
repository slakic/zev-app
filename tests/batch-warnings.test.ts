// F5a.3 — "Upozorenja prije izdavanja" nacrta serije (src/lib/batchWarnings.ts).
import { describe, it, expect } from "vitest";
import { batchWarnings, type PreviewUnit } from "@/lib/batchWarnings";

const NOW = new Date("2026-10-25T10:00:00Z");
const due = (iso: string) => new Date(`${iso}T00:00:00Z`);

const unit = (id: string, over: Partial<PreviewUnit> = {}): PreviewUnit => ({
  unitId: id, unitLabel: id, buildingName: "Zgrada A", debtorId: "d1", debtorName: "Ana", total: "10.00",
  lines: [{ name: "Održavanje", method: "PER_AREA", amount: "10.00", inputs: { usableArea: "20.00", rate: "0.5" } }],
  ...over,
});

describe("batchWarnings", () => {
  it("a clean batch has no warnings", () => {
    const w = batchWarnings([unit("1"), unit("2")], due("2026-11-15"), NOW);
    expect(w.count).toBe(0);
    expect(w.flaggedUnitIds).toEqual([]);
    expect(w.duePast).toBe(false);
  });

  it("a 0,00 line carries a reason read from its inputs", () => {
    const w = batchWarnings([
      unit("1", { total: "5.00", lines: [
        { name: "Po korisniku", method: "PER_OCCUPANT", amount: "0.00", inputs: { occupantCount: 0, rate: "1.95" } },
        { name: "Voda", method: "CONSUMPTION", amount: "0.00", inputs: { consumption: null, rate: "2" } },
        { name: "Neobjašnjeno", method: "FIXED_PER_UNIT", amount: "0.00", inputs: {} },
        { name: "Ostalo", method: "FIXED_PER_UNIT", amount: "5.00", inputs: {} },
      ] }),
    ], due("2026-11-15"), NOW);
    expect(w.zeroLines.map((e) => e.detail)).toEqual([
      "Po korisniku (nema broja korisnika)", "Voda (potrošnja je 0 ili nema očitanja)", "Neobjašnjeno (iznos je 0,00 KM)",
    ]);
    expect(w.zeroUnits).toEqual([]);
    expect(w.flaggedUnitIds).toEqual(["1"]);
    expect(w.count).toBe(3);
  });

  it("a unit without a debtor and a unit with a total of 0 are reported separately", () => {
    const w = batchWarnings([
      unit("1", { debtorId: null, debtorName: "—" }),
      unit("2", { total: "0.00", lines: [{ name: "X", method: "FIXED_PER_UNIT", amount: "0.00", inputs: {} }] }),
      unit("3"),
    ], due("2026-11-15"), NOW);
    expect(w.noDebtor.map((e) => e.unitId)).toEqual(["1"]);
    expect(w.zeroUnits.map((e) => e.unitId)).toEqual(["2"]);
    expect(w.zeroLines.map((e) => e.unitId)).toEqual(["2"]);
    expect(w.flaggedUnitIds.sort()).toEqual(["1", "2"]);
    expect(w.noDebtor[0].unit).toBe("Zgrada A / 1");
  });

  it("due date in the past is judged by the Europe/Sarajevo calendar day: on the due day itself it has not passed", () => {
    expect(batchWarnings([], due("2026-10-25"), NOW).duePast).toBe(false);
    expect(batchWarnings([], due("2026-10-24"), NOW).duePast).toBe(true);
    // Poslije 25.10.2026 03:00 važi UTC+1: 22:30Z je još 25.10. (23:30 lokalno), 23:30Z je već 26.10. (00:30)
    expect(batchWarnings([], due("2026-10-25"), new Date("2026-10-25T22:30:00Z")).duePast).toBe(false);
    expect(batchWarnings([], due("2026-10-25"), new Date("2026-10-25T23:30:00Z")).duePast).toBe(true);
  });
});
