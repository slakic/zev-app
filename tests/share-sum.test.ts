// F8.4 — chip „Zbir jedinice” (src/lib/shareSum.ts): ista tolerancija kao `unitOwnershipWarnings` (0,0001).
import { describe, it, expect } from "vitest";
import { assertSharePercent, classifyShareSum, shareSumChip, sumShares } from "@/lib/shareSum";
import { dec } from "@/lib/money";

describe("classifyShareSum", () => {
  it("100 is OK, also within the 0.0001 tolerance", () => {
    expect(classifyShareSum("100", 1)).toBe("OK");
    expect(classifyShareSum("100.000000", 2)).toBe("OK");
    expect(classifyShareSum("100.0001", 2)).toBe("OK");
    expect(classifyShareSum("99.9999", 2)).toBe("OK");
  });
  it("outside the tolerance is OVER / UNDER", () => {
    expect(classifyShareSum("100.0002", 2)).toBe("OVER");
    expect(classifyShareSum("150", 2)).toBe("OVER");
    expect(classifyShareSum("99.9998", 2)).toBe("UNDER");
    expect(classifyShareSum("50", 1)).toBe("UNDER");
  });
  it("no active stake is NONE whatever the sum", () => {
    expect(classifyShareSum("0", 0)).toBe("NONE");
    expect(classifyShareSum("100", 0)).toBe("NONE");
  });
});

describe("shareSumChip", () => {
  it("formats 100 / 50 / 150 / no owner with a decimal comma", () => {
    expect(shareSumChip("100", 1)).toMatchObject({ label: "100 %", ok: true, status: "OWNER_SUM_OK", kind: "OK" });
    expect(shareSumChip("50", 1)).toMatchObject({ label: "Upisano 50,00 %", ok: false, status: "OWNER_SUM_WARN", kind: "UNDER" });
    expect(shareSumChip("150", 2)).toMatchObject({ label: "Zbir 150,00 %", ok: false, status: "OWNER_SUM_WARN", kind: "OVER" });
    expect(shareSumChip("0", 0)).toMatchObject({ label: "Bez vlasnika", ok: false, status: "OWNER_SUM_WARN", kind: "NONE" });
    expect(shareSumChip("33.3333", 1).label).toBe("Upisano 33,33 %");
  });
});

describe("sumShares", () => {
  it("sums with Decimal, not floats", () => {
    expect(sumShares(["33.3333", "33.3333", "33.3334"]).toString()).toBe("100");
    expect(sumShares([]).equals(dec(0))).toBe(true);
    expect(sumShares([dec("0.1"), dec("0.2")]).toString()).toBe("0.3");
  });
});

describe("assertSharePercent", () => {
  it("allows (0, 100] and returns the Decimal", () => {
    expect(assertSharePercent("100").toString()).toBe("100");
    expect(assertSharePercent("0.0001").toString()).toBe("0.0001");
    expect(() => assertSharePercent("0")).toThrow(/rasponu/);
    expect(() => assertSharePercent("-5")).toThrow(/rasponu/);
    expect(() => assertSharePercent("100.01")).toThrow(/rasponu/);
  });
});
