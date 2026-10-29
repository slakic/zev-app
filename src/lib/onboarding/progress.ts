// Napredak kroz čarobnjak (Plans/zev-onboarding-wizard-plan.md §0.3, §4): JEDNA čista funkcija koja
// za svaki korak kaže da li je kompletan i šta nedostaje. Koriste je stranice koraka, guard koji
// odbija korak iza trenutnog, StepNav i admin lista poziva — pa svi vide isto.
import { isValidBankAccount, isValidJib } from "@/lib/identifiers";
import { t, tf } from "@/lib/i18n";
import type { OnboardingDraftData } from "@/lib/onboarding/draft";

export const ONBOARDING_STEPS = [
  { key: "account", slug: "nalog" },
  { key: "zev", slug: "podaci-o-zev-u" },
  { key: "accounts", slug: "racuni" },
  { key: "buildings", slug: "zgrade" },
  { key: "units", slug: "posebni-dijelovi" },
  { key: "commonAssets", slug: "zajednicki-dijelovi" },
  { key: "register", slug: "utvrdjivanje-registra" },
  { key: "owners", slug: "vlasnici" },
  { key: "offices", slug: "organi-i-nalozi" },
  { key: "review", slug: "pregled" },
] as const;

export type OnboardingStepKey = (typeof ONBOARDING_STEPS)[number]["key"];
export type OnboardingTier = "BASIC" | "BASIC_FINANCE" | "FULL";

export type StepIssue = { key: string; text: string };
export type StepProgress = {
  key: OnboardingStepKey;
  slug: string;
  number: number;
  label: string;
  optional: boolean;
  complete: boolean;
  /** Šta nedostaje (⚠) i šta je u redu (✓) — za PreconditionList na dnu koraka. */
  checks: { ok: boolean; text: string }[];
  issues: StepIssue[];
};

export type OnboardingProgress = { steps: StepProgress[]; currentStep: OnboardingStepKey };

/** Koraci čiji ekran još nije isporučen (Faze B i C): nikad kompletni, pa je čarobnjak zaustavljen prije njih. */
const NOT_YET_AVAILABLE: OnboardingStepKey[] = ["units", "commonAssets", "register", "owners", "offices"];

const filled = (s: string | null | undefined) => Boolean(s && s.trim());

function checksFor(key: OnboardingStepKey, data: OnboardingDraftData, tier: OnboardingTier): { ok: boolean; text: string; issueKey: string }[] {
  switch (key) {
    case "account": {
      const ok = filled(data.president.firstName) && filled(data.president.lastName);
      return [{ ok, issueKey: "name", text: ok ? t("onboarding.check.nameOk") : t("onboarding.check.nameMissing") }];
    }
    case "zev": {
      const z = data.zev;
      const required: [string, string][] = [
        ["legalName", z.legalName], ["registrationNumber", z.registrationNumber],
        ["registeredAddress", z.registeredAddress], ["city", z.city], ["municipality", z.municipality],
      ];
      const missing = required.filter(([, v]) => !filled(v)).map(([k]) => t(`onboarding.zev.${k}`));
      const jibOk = filled(z.jib) && isValidJib(z.jib);
      return [
        {
          ok: missing.length === 0, issueKey: "fields",
          text: missing.length === 0 ? t("onboarding.check.zevFieldsOk") : tf("onboarding.check.zevFieldsMissing", { polja: missing.join(", ") }),
        },
        { ok: jibOk, issueKey: "jib", text: jibOk ? t("onboarding.check.jibOk") : t("onboarding.check.jibMissing") },
      ];
    }
    case "accounts": {
      const bank = data.accounts.filter((a) => a.type === "BANK" && filled(a.number) && isValidBankAccount(a.number!));
      if (bank.length > 0) return [{ ok: true, issueKey: "bank", text: tf("onboarding.check.bankOk", { broj: bank.length }) }];
      if (tier === "BASIC" && data.acks.noAccounts) return [{ ok: true, issueKey: "bank", text: t("onboarding.check.noAccountsAck") }];
      return [{ ok: false, issueKey: "bank", text: tier === "BASIC" ? t("onboarding.check.bankMissingBasic") : t("onboarding.check.bankMissing") }];
    }
    case "buildings": {
      const valid = data.buildings.filter((b) => filled(b.name) && filled(b.address));
      return [
        {
          ok: valid.length > 0 && valid.length === data.buildings.length, issueKey: "building",
          text: valid.length > 0 ? tf("onboarding.check.buildingsOk", { broj: valid.length }) : t("onboarding.check.buildingsMissing"),
        },
      ];
    }
    case "review":
      return [];
    default:
      return [{ ok: false, issueKey: "soon", text: t("onboarding.check.notYetAvailable") }];
  }
}

export function onboardingProgress(data: OnboardingDraftData, tier: OnboardingTier): OnboardingProgress {
  const steps: StepProgress[] = ONBOARDING_STEPS.map((s, i) => {
    const checks = checksFor(s.key, data, tier);
    const complete =
      s.key === "review"
        ? false // pregled je kompletan tek objavom (Faza C)
        : !NOT_YET_AVAILABLE.includes(s.key) && checks.every((c) => c.ok);
    return {
      key: s.key,
      slug: s.slug,
      number: i + 1,
      label: t(`onboarding.steps.${s.key}`),
      optional: s.key === "accounts" && tier === "BASIC",
      complete,
      checks: checks.map(({ ok, text }) => ({ ok, text })),
      issues: checks.filter((c) => !c.ok).map((c) => ({ key: `${s.key}.${c.issueKey}`, text: c.text })),
    };
  });
  const firstIncomplete = steps.find((s) => !s.complete) ?? steps[steps.length - 1];
  return { steps, currentStep: firstIncomplete.key };
}

export function stepBySlug(slug: string) {
  return ONBOARDING_STEPS.find((s) => s.slug === slug);
}

/** Korak se smije otvoriti/mijenjati samo ako je trenutni ili raniji (§5.3). */
export function isStepReachable(progress: OnboardingProgress, key: OnboardingStepKey): boolean {
  const idx = (k: OnboardingStepKey) => ONBOARDING_STEPS.findIndex((s) => s.key === k);
  return idx(key) <= idx(progress.currentStep);
}
