import { describe, it, expect } from "vitest";
import { parseMoneyInput, dec } from "@/lib/money";

describe("parseMoneyInput — sr-Latn decimal input normalization", () => {
  it("passes through a plain dot-decimal string unchanged", () => {
    expect(parseMoneyInput("120.00")).toBe("120.00");
    expect(parseMoneyInput("0.35")).toBe("0.35");
    expect(parseMoneyInput("1234")).toBe("1234");
  });

  it("converts a comma decimal separator to a dot (the bug report's case)", () => {
    expect(parseMoneyInput("120,00")).toBe("120.00");
    expect(parseMoneyInput("4800,50")).toBe("4800.50");
  });

  it("treats dot as a thousands separator when a comma is also present", () => {
    expect(parseMoneyInput("1.234,56")).toBe("1234.56");
    expect(parseMoneyInput("12.345,00")).toBe("12345.00");
  });

  it("strips stray whitespace", () => {
    expect(parseMoneyInput(" 120,00 ")).toBe("120.00");
  });

  it("returns null for empty/null/undefined input", () => {
    expect(parseMoneyInput("")).toBeNull();
    expect(parseMoneyInput("   ")).toBeNull();
    expect(parseMoneyInput(null)).toBeNull();
    expect(parseMoneyInput(undefined)).toBeNull();
  });

  it("produces a string that Decimal() accepts for every normalized case", () => {
    for (const raw of ["120,00", "1.234,56", "4800,5", "0,35", "120.00"]) {
      const normalized = parseMoneyInput(raw)!;
      expect(() => dec(normalized)).not.toThrow();
    }
  });
});
