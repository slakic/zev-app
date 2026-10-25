import { describe, it, expect } from "vitest";
import { calculateCharge } from "@/server/engines/billing";
import { describeChargeLine } from "@/lib/chargeLine";
import { dec } from "@/lib/money";

const U = (id: string, over?: Partial<Parameters<typeof calculateCharge>[1][number]>) => ({
  unitId: id, label: id, usableArea: dec("15"), ownershipShare: dec("3.4"),
  occupantCount: 3, typeCoefficient: dec("0.5"), exempt: false,
  customWeight: dec("2"), manualAmount: dec("42"), consumption: dec("12.5"), ...over,
});

const def = (method: string, rate: string | null, extra?: object) => ({
  chargeItemId: "ci", name: "Test", method: method as never,
  rate: rate ? dec(rate) : null, rounding: "HALF_UP_2" as const,
  minAmount: null, maxAmount: null, ...extra,
});

// Svaka rečenica se slaže iz STVARNOG snapshot-a koji engine upisuje na stavku fakture.
const describeFor = (method: string, rate: string | null, units = [U("a"), U("b"), U("c"), U("d")], extra?: object) =>
  describeChargeLine(calculateCharge(def(method, rate, extra), units)[0].snapshot);

describe("describeChargeLine — svih 9 metoda obračuna", () => {
  it("FIXED_PER_UNIT", () => expect(describeFor("FIXED_PER_UNIT", "8")).toBe("fiksno po jedinici"));
  it("PER_AREA", () => expect(describeFor("PER_AREA", "0.30")).toBe("15,00 m² × 0,30 KM/m²"));
  it("PER_OWNERSHIP_SHARE", () => expect(describeFor("PER_OWNERSHIP_SHARE", "0.80")).toBe("Udio 3,40 % × 0,80 KM"));
  it("PER_OCCUPANT, množina", () => {
    expect(describeFor("PER_OCCUPANT", "2.5")).toBe("3 korisnika × 2,50 KM");
    expect(describeFor("PER_OCCUPANT", "2.5", [U("a", { occupantCount: 1 })])).toBe("1 korisnik × 2,50 KM");
    expect(describeFor("PER_OCCUPANT", "2.5", [U("a", { occupantCount: 21 })])).toBe("21 korisnik × 2,50 KM");
    expect(describeFor("PER_OCCUPANT", "2.5", [U("a", { occupantCount: 11 })])).toBe("11 korisnika × 2,50 KM");
  });
  it("EQUAL_SPLIT, množina jedinica", () => {
    expect(describeFor("EQUAL_SPLIT", "120")).toBe("ukupno 120,00 KM ÷ 4 jedinice");
    expect(describeFor("EQUAL_SPLIT", "120", [U("a"), U("b"), U("c"), U("d"), U("e")])).toBe("ukupno 120,00 KM ÷ 5 jedinica");
    expect(describeFor("EQUAL_SPLIT", "120", [U("a")])).toBe("ukupno 120,00 KM ÷ 1 jedinica");
  });
  it("UNIT_TYPE_COEFFICIENT", () => expect(describeFor("UNIT_TYPE_COEFFICIENT", "120")).toBe("koeficijent 0,5 od zbira 2, ukupno 120,00 KM"));
  it("CONSUMPTION", () => expect(describeFor("CONSUMPTION", "0.80")).toBe("potrošnja 12,5 × 0,80 KM"));
  it("CUSTOM_WEIGHTS", () => expect(describeFor("CUSTOM_WEIGHTS", "120")).toBe("ponder 2 od zbira 8, ukupno 120,00 KM"));
  it("MANUAL (ručna dodjela)", () => expect(describeFor("MANUAL", null)).toBe("ručno određen iznos"));

  it("većim brojevima dodaje tačku za hiljade", () => {
    expect(describeFor("PER_AREA", "0.30", [U("a", { usableArea: dec("1250") })])).toBe("1.250,00 m² × 0,30 KM/m²");
  });

  it("najmanji/najveći iznos se pominje kad je zadat", () => {
    expect(describeFor("FIXED_PER_UNIT", "8", [U("a")], { minAmount: dec("5"), maxAmount: dec("10") })).toBe(
      "fiksno po jedinici; najmanje 5,00 KM; najviše 10,00 KM",
    );
  });
});

describe("describeChargeLine — povratak na allocationBasis", () => {
  it("nepoznat metod", () => {
    expect(describeChargeLine({ method: "NEPOZNATO", allocationBasis: "nešto drugo", inputs: { a: 1 } })).toBe("nešto drugo");
  });
  it("jednokratna i korektivna faktura (MANUAL bez manualAmount)", () => {
    expect(describeChargeLine({ method: "MANUAL", allocationBasis: "jednokratno", inputs: { amount: "20.00" } })).toBe("jednokratno");
    expect(describeChargeLine({ method: "MANUAL", allocationBasis: "korekcija", inputs: { originalInvoice: "F-1" } })).toBe("korekcija");
  });
  it("nepotpuni ulazi i prazan snapshot", () => {
    expect(describeChargeLine({ method: "PER_AREA", allocationBasis: "korisna površina (m²)", inputs: { rate: "0.3" } })).toBe("korisna površina (m²)");
    expect(describeChargeLine(null)).toBe("");
    expect(describeChargeLine({ allocationBasis: "x" })).toBe("x");
  });
});

describe("describeChargeRate (F5a.4)", () => {
  it("amount with a decimal comma and a unit per method", async () => {
    const { describeChargeRate } = await import("@/lib/chargeLine");
    expect(describeChargeRate("PER_AREA", "0.30")).toBe("0,30 KM/m²");
    expect(describeChargeRate("FIXED_PER_UNIT", "8")).toBe("8,00 KM po jedinici");
    expect(describeChargeRate("EQUAL_SPLIT", "120.00")).toBe("120,00 KM ukupno");
    expect(describeChargeRate("PER_OCCUPANT", "1.95")).toBe("1,95 KM po korisniku");
    expect(describeChargeRate("PER_OWNERSHIP_SHARE", "0.5")).toBe("0,50 KM po udjelu");
    expect(describeChargeRate("MANUAL", null)).toBe("ručni iznos");
    expect(describeChargeRate("PER_AREA", null)).toBe("—");
  });
});
