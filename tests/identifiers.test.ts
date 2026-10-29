// JIB i broj računa (src/lib/identifiers.ts, Plans/zev-onboarding-wizard-plan.md D5). Primjeri računa
// su iz Instrukcije o strukturi računa za obavljanje platnih transakcija (CBBiH), član 2.
import { describe, it, expect } from "vitest";
import { assertBankAccount, assertJib, isValidBankAccount, isValidJib } from "@/lib/identifiers";

describe("isValidBankAccount", () => {
  it("accepts the CBBiH examples, with or without separators", () => {
    expect(isValidBankAccount("0060000123456758")).toBe(true);
    expect(isValidBankAccount("0060000123458698")).toBe(true); // ostatak 0 -> kontrolni broj 98
    expect(isValidBankAccount("006 000 01234567 58")).toBe(true);
    expect(isValidBankAccount(" 555-10000515469-32 ")).toBe(true);
  });

  it("rejects a wrong control number, a wrong length and non-digits", () => {
    expect(isValidBankAccount("0060000123456759")).toBe(false);
    expect(isValidBankAccount("1111111111111111")).toBe(false);
    expect(isValidBankAccount("006000012345675")).toBe(false);
    expect(isValidBankAccount("00600001234567580")).toBe(false);
    expect(isValidBankAccount("00600001234567A8")).toBe(false);
    expect(isValidBankAccount("")).toBe(false);
  });

  it("accepts a BA IBAN only when both the IBAN and the inner account check out", () => {
    expect(isValidBankAccount("BA39 1990 4400 0120 0279")).toBe(true);
    expect(isValidBankAccount("ba391990440001200279")).toBe(true);
    expect(isValidBankAccount("BA38 1990 4400 0120 0279")).toBe(false);
    expect(isValidBankAccount("BA391111111111111111")).toBe(false);
  });
});

describe("isValidJib", () => {
  it("is exactly 13 digits; separators are ignored", () => {
    expect(isValidJib("4400000000000")).toBe(true);
    expect(isValidJib("4512 3456 70001")).toBe(true);
    expect(isValidJib("440000000000")).toBe(false);
    expect(isValidJib("44000000000000")).toBe(false);
    expect(isValidJib("44000000000A0")).toBe(false);
  });
});

describe("assert*", () => {
  it("throws a readable message", () => {
    expect(() => assertBankAccount("123")).toThrow(/16 cifara/);
    expect(() => assertJib("123")).toThrow(/13 cifara/);
    expect(() => assertBankAccount("0060000123456758")).not.toThrow();
    expect(() => assertJib("4400000000000")).not.toThrow();
  });
});
