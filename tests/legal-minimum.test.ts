// Zakonski minimum naknade za održavanje (odluka 2026-10-26): pravilo koje stavke se računaju kao održavanje.
import { describe, it, expect } from "vitest";
import { isMaintenanceCharge, maintenanceRateBelowMinimum, minMaintenancePerM2, belowMinimumFor } from "@/lib/legalMinimum";
import { dec } from "@/lib/money";

describe("legalMinimum", () => {
  it("minimums per party type", () => {
    expect(minMaintenancePerM2("PERSON").toFixed(2)).toBe("0.20");
    expect(minMaintenancePerM2("ORGANIZATION").toFixed(2)).toBe("0.40");
    expect(belowMinimumFor("PERSON", dec("0.19"))).toBe(true);
    expect(belowMinimumFor("PERSON", dec("0.20"))).toBe(false);
    expect(belowMinimumFor("ORGANIZATION", dec("0.399999"))).toBe(true);
  });

  it("maintenance = per-m² item that is flagged as the fund or has 'održavanje' in its name (diacritics ignored)", () => {
    expect(isMaintenanceCharge({ method: "PER_AREA", name: "Redovno održavanje" })).toBe(true);
    expect(isMaintenanceCharge({ method: "PER_AREA", name: "REDOVNO ODRZAVANJE" })).toBe(true);
    expect(isMaintenanceCharge({ method: "PER_AREA", name: "Rezerva", isReserveFund: true })).toBe(true);
    expect(isMaintenanceCharge({ method: "PER_AREA", name: "Čišćenje" })).toBe(false);
    expect(isMaintenanceCharge({ method: "PER_OWNERSHIP_SHARE", name: "Fond održavanja", isReserveFund: true })).toBe(false);
    expect(isMaintenanceCharge({ method: "EQUAL_SPLIT", name: "Održavanje lifta" })).toBe(false);
  });

  it("the charge-item warning appears only for a per-m² maintenance rate below 0,20", () => {
    const item = { method: "PER_AREA", name: "Redovno održavanje", isReserveFund: false };
    expect(maintenanceRateBelowMinimum({ ...item, rate: "0.19" })).toBe(true);
    expect(maintenanceRateBelowMinimum({ ...item, rate: "0.20" })).toBe(false);
    expect(maintenanceRateBelowMinimum({ ...item, rate: "0.30" })).toBe(false);
    expect(maintenanceRateBelowMinimum({ ...item, rate: null })).toBe(false);
    expect(maintenanceRateBelowMinimum({ method: "PER_AREA", name: "Čišćenje", rate: "0.05" })).toBe(false);
  });
});
