// draftForAssistant (Faza O-A): čista funkcija koja bira šta asistent vidi iz nacrta. Najvažnije je šta NE smije izaći.
import { describe, it, expect } from "vitest";
import { draftForAssistant, DRAFT_SECTIONS } from "@/lib/onboarding/draftForAssistant";
import { parseDraftData } from "@/lib/onboarding/draft";
import { isStepReadOnly } from "@/lib/onboarding/progress";

const HASH = "$argon2id$v=19$m=19456,t=2,p=1$SECRETSALT$SECRETHASHVALUE";

function sample() {
  return parseDraftData({
    zev: { legalName: "ZEV Test", jib: "4200000000001", city: "Banja Luka", foundingDate: "2026-01-01" },
    president: { firstName: "Dragana", lastName: "Savić", phone: "065" },
    accounts: [{ key: "a1", type: "BANK", name: "Tekući", bankName: "Banka", number: "1234", openingBalance: "0.00", openingDate: "2026-01-01" }],
    buildings: [{ key: "b1", name: "Zgrada", address: "Ulica 1", entrances: [{ key: "e1", name: "A" }] }],
    units: [{ key: "u1", buildingKey: "b1", type: "APARTMENT", label: "1", usableArea: "50.00", ownershipShare: "10" }],
    commonAssets: [{ key: "c1", buildingKey: "b1", kind: "AREA", name: "Stepenište" }],
    parties: [{ key: "p1", kind: "PERSON", firstName: "Marko", lastName: "Marković", email: "marko@primjer.test", phone: "066" }],
    stakes: [{ key: "s1", unitKey: "u1", partyKey: "p1", sharePercent: "100", validFrom: "2026-01-01", proofFileId: "file-1", proofFilename: "list.pdf" }],
    disputedUnits: [],
    offices: { accountant: { key: "o1", partyKey: "p1", validFrom: "2026-02-01", loginEmail: "racunovodja@primjer.test", passwordHash: HASH }, board: [{ key: "o2", partyKey: "p1", validFrom: "2026-02-01" }] },
  });
}

describe("draftForAssistant", () => {
  it("never exposes the password hash, the proof file id or file bytes, and reports hasPassword", () => {
    const out = draftForAssistant(sample(), [{ id: "file-1", filename: "list.pdf", mime: "application/pdf", size: 1234 }]);
    const raw = JSON.stringify(out);
    expect(raw).not.toContain("passwordHash");
    expect(raw).not.toContain("SECRETHASHVALUE");
    expect(raw).not.toContain("proofFileId");
    expect(raw).not.toContain("file-1");
    expect(raw).not.toContain("bytes");
    expect((out.offices as { accountant: { hasPassword: boolean; loginEmail: string } }).accountant).toMatchObject({ hasPassword: true, loginEmail: "racunovodja@primjer.test" });
  });

  it("maps proof metadata and validity flags", () => {
    const out = draftForAssistant(sample(), [{ id: "file-1", filename: "list.pdf", mime: "application/pdf", size: 1234 }]) as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
    expect(out.stakes[0].proof).toEqual({ filename: "list.pdf", mime: "application/pdf", size: 1234 });
    expect(out.zev).toMatchObject({ legalName: "ZEV Test", jibValid: expect.any(Boolean), registrationDate: null, foundingDate: "2026-01-01" });
    expect(out.accounts[0].numberValid).toBe(false);
    expect(out.noAccounts).toBe(false);
    expect(out.buildings[0].entrances).toEqual([{ key: "e1", name: "A" }]);
  });

  it("returns a null/LATER accountant as-is and a missing proof as null", () => {
    const d = sample();
    d.offices.accountant = "LATER";
    d.stakes[0].proofFilename = "";
    const out = draftForAssistant(d, []) as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
    expect(out.offices.accountant).toBe("LATER");
    expect(out.stakes[0].proof).toBeNull();
  });

  it("returns only the requested sections", () => {
    const out = draftForAssistant(sample(), [], ["accounts", "offices"]);
    expect(Object.keys(out).sort()).toEqual(["accounts", "noAccounts", "offices"]);
    expect(Object.keys(draftForAssistant(sample(), [], [...DRAFT_SECTIONS])).length).toBeGreaterThan(10);
    expect(Object.keys(draftForAssistant(sample(), [], [])).length).toBeGreaterThan(10);
  });

  it("keeps a 300-unit, 600-stake draft under 1 MB", () => {
    const d = sample();
    d.units = Array.from({ length: 300 }, (_, i) => ({ key: `u${i}`, buildingKey: "b1", entranceKey: null, type: "APARTMENT" as const, label: `Stan ${i}`, floor: i % 10, usableArea: "62.40", ownershipShare: "0.33" }));
    d.stakes = Array.from({ length: 600 }, (_, i) => ({ key: `s${i}`, unitKey: `u${i % 300}`, partyKey: "p1", sharePercent: "50", validFrom: "2026-01-01", proofFileId: "file-1", proofFilename: "list.pdf" }));
    const bytes = Buffer.byteLength(JSON.stringify(draftForAssistant(d, [{ id: "file-1", filename: "list.pdf", mime: "application/pdf", size: 10 }])));
    console.log(`get_draft 300 jedinica / 600 udjela: ${(bytes / 1024).toFixed(0)} KB`);
    expect(bytes).toBeLessThan(1024 * 1024);
  });
});

describe("isStepReadOnly", () => {
  it("is read-only only for buildings, units and common assets once the register is confirmed", () => {
    expect(isStepReadOnly({ registerConfirmedAt: null }, "units")).toBe(false);
    expect(isStepReadOnly({ registerConfirmedAt: "2026-01-01T00:00:00Z" }, "units")).toBe(true);
    expect(isStepReadOnly({ registerConfirmedAt: "2026-01-01T00:00:00Z" }, "owners")).toBe(false);
  });
});
