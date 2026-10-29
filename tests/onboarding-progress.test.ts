// Napredak kroz čarobnjak (src/lib/onboarding/progress.ts) — čista funkcija, bez baze.
import { describe, it, expect } from "vitest";
import { initialDraftData, parseDraftData, type OnboardingDraftData } from "@/lib/onboarding/draft";
import { onboardingProgress, isStepReachable } from "@/lib/onboarding/progress";

function filled(over: Partial<OnboardingDraftData> = {}): OnboardingDraftData {
  return parseDraftData({
    zev: {
      legalName: "ZEV Kralja Petra I 45", registrationNumber: "1-2345/26", jib: "4404567890002",
      registeredAddress: "Kralja Petra I 45", city: "Banja Luka", municipality: "Banja Luka",
    },
    president: { firstName: "Dragana", lastName: "Savić" },
    accounts: [{ key: "a1", type: "BANK", name: "Glavni", number: "0060000123456758", openingBalance: "0", openingDate: "2026-01-01" }],
    buildings: [{ key: "b1", name: "Kralja Petra I 45", address: "Kralja Petra I 45, Banja Luka" }],
    ...over,
  });
}

describe("onboardingProgress", () => {
  it("a fresh draft stops at step 1 until the name is filled, then at step 2", () => {
    const empty = initialDraftData({ workingName: "ZEV X" });
    expect(onboardingProgress(empty, "FULL").currentStep).toBe("account");
    const named = initialDraftData({ workingName: "ZEV X", firstName: "Ana", lastName: "Tešić" });
    const p = onboardingProgress(named, "FULL");
    expect(p.currentStep).toBe("zev");
    expect(p.steps.find((s) => s.key === "zev")!.issues.map((i) => i.key)).toEqual(["zev.fields", "zev.jib"]);
  });

  it("an invalid JIB keeps step 2 open even when every other field is filled", () => {
    const d = filled();
    d.zev.jib = "12345";
    expect(onboardingProgress(d, "FULL").currentStep).toBe("zev");
  });

  it("step 3 needs a bank account with a valid number, except BASIC with the explicit 'no accounts' choice", () => {
    const noBank = filled({ accounts: [] });
    expect(onboardingProgress(noBank, "FULL").currentStep).toBe("accounts");
    expect(onboardingProgress(noBank, "BASIC").currentStep).toBe("accounts");
    const ack = filled({ accounts: [], acks: { noAccounts: true } });
    expect(onboardingProgress(ack, "BASIC").currentStep).toBe("units"); // zgrada je već u filled()
    expect(onboardingProgress(ack, "FULL").currentStep).toBe("accounts"); // potvrda važi samo za BASIC
    const badNumber = filled({ accounts: [{ key: "a", type: "BANK", name: "X", bankName: null, number: "1111111111111111", openingBalance: "0", openingDate: "2026-01-01" }] });
    expect(onboardingProgress(badNumber, "FULL").currentStep).toBe("accounts");
    expect(onboardingProgress(noBank, "BASIC").steps.find((s) => s.key === "accounts")!.optional).toBe(true);
  });

  it("with steps 1–4 complete the wizard stops at step 5, which is not available yet (Faza A)", () => {
    const p = onboardingProgress(filled(), "FULL");
    expect(p.steps.slice(0, 4).every((s) => s.complete)).toBe(true);
    expect(p.currentStep).toBe("units");
    expect(isStepReachable(p, "buildings")).toBe(true);
    expect(isStepReachable(p, "units")).toBe(true);
    expect(isStepReachable(p, "commonAssets")).toBe(false);
    expect(isStepReachable(p, "review")).toBe(false);
  });

  it("removing data from a finished step moves the current step back to it", () => {
    expect(onboardingProgress(filled({ buildings: [] }), "FULL").currentStep).toBe("buildings");
  });
});
