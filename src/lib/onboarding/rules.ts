// Pravila polja nacrta novog ZEV-a (Plans/zev-onboarding-wizard-plan.md §4). ČISTO: bez baze i bez slučajnosti, da
// ISTI kod provjerava unos u koracima čarobnjaka (src/server/services/onboarding.ts) i uvoz iz fajla
// (src/lib/onboarding/import/plan.ts). Uvoz tako ne može biti blaži od čarobnjaka. Poruke grešaka su iste kao prije
// izdvajanja; ključeve stavki (`key`) dodjeljuje pozivalac.
import { emailAddressSchema } from "@/lib/emailAddress";
import { assertBankAccount } from "@/lib/identifiers";
import { parseMoneyInput } from "@/lib/money";
import { t, tf } from "@/lib/i18n";
import type { DraftAccount, DraftParty, OnboardingDraftData } from "@/lib/onboarding/draft";

export const UNIT_TYPES = ["APARTMENT", "BUSINESS", "GARAGE", "GARAGE_SPACE", "OTHER"] as const;
export type DraftUnitType = (typeof UNIT_TYPES)[number];
export const ASSET_KINDS = ["AREA", "SYSTEM", "EQUIPMENT"] as const;
export type DraftAssetKind = (typeof ASSET_KINDS)[number];

export const trimOr = (v: string | null | undefined) => (v ?? "").trim();

/** Cio broj ili prazno (null); `label` ulazi u poruku. */
export function optionalInt(raw: string | null | undefined, label: string): number | null {
  const s = trimOr(raw);
  if (!s) return null;
  if (!/^-?\d+$/.test(s)) throw new Error(`${label}: unesite cijeli broj.`);
  return Number(s);
}

/** Decimalni broj veći od nule ("62,40" i "1.234,56" se normalizuju kao novac). */
export function positiveDecimal(raw: string | null | undefined, label: string): string {
  const s = parseMoneyInput(raw ?? "");
  if (!s || !/^\d+(\.\d+)?$/.test(s) || Number(s) <= 0) throw new Error(`${label}: unesite broj veći od nule.`);
  return s;
}

export function assertDate(raw: string, label: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) throw new Error(`${label}: unesite datum.`);
  return raw;
}

// ---- Korak 3 — Računi ----------------------------------------------------------------------

export type AccountInput = { type: "BANK" | "CASH"; name: string; bankName?: string | null; number?: string | null; openingBalance: string; openingDate: string };

/** Polja računa bez ključa; isto pravilo kao createAccount (D5). */
export function normalizeAccount(input: AccountInput): Omit<DraftAccount, "key"> {
  const name = trimOr(input.name);
  if (!name) throw new Error("Naziv računa je obavezan.");
  const number = trimOr(input.number);
  if (input.type === "BANK") {
    if (!number) throw new Error(t("onboarding.accounts.numberRequired"));
    assertBankAccount(number);
  }
  const openingBalance = parseMoneyInput(input.openingBalance) ?? "0";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.openingDate)) throw new Error("Unesite datum početnog stanja.");
  return {
    type: input.type, name,
    bankName: input.type === "BANK" ? trimOr(input.bankName) || null : null,
    number: input.type === "BANK" ? number : null,
    openingBalance, openingDate: input.openingDate,
  };
}

// ---- Korak 4 — Zgrade i ulazi ----------------------------------------------------------------

export type BuildingInput = { name: string; address: string; cadastralRef?: string | null; yearBuilt?: string | null; floorsCount?: string | null };

/** Polja zgrade (bez provjere jedinstvenosti naziva, koja traži nacrt — assertBuildingNameFree). */
export function normalizeBuilding(input: BuildingInput) {
  const name = trimOr(input.name);
  const address = trimOr(input.address);
  if (!name) throw new Error("Naziv zgrade je obavezan.");
  if (!address) throw new Error("Adresa zgrade je obavezna.");
  return {
    name, address, cadastralRef: trimOr(input.cadastralRef) || null,
    yearBuilt: optionalInt(input.yearBuilt, t("onboarding.buildings.yearBuilt")),
    floorsCount: optionalInt(input.floorsCount, t("onboarding.buildings.floorsCount")),
  };
}

/** Naziv zgrade je jedinstven u nacrtu (bez obzira na velika/mala slova). */
export function assertBuildingNameFree(d: OnboardingDraftData, name: string, selfKey: string | null) {
  if (d.buildings.some((b) => b.key !== selfKey && b.name.toLowerCase() === name.toLowerCase())) {
    throw new Error(tf("onboarding.buildings.duplicateName", { naziv: name }));
  }
}

export function normalizeEntranceName(name: string): string {
  const n = trimOr(name);
  if (!n) throw new Error("Naziv ulaza je obavezan.");
  return n;
}

export function assertEntranceNameFree(building: OnboardingDraftData["buildings"][number], name: string, selfKey: string | null) {
  if (building.entrances.some((e) => e.key !== selfKey && e.name.toLowerCase() === name.toLowerCase())) {
    throw new Error(tf("onboarding.buildings.duplicateEntrance", { naziv: name }));
  }
}

// ---- Korak 5 — Posebni dijelovi ----------------------------------------------------------------
// Ista pravila polja kao createUnit/registar (oznaka, vrsta, površina > 0, udio u (0, 100]); oznaka je jedinstvena
// u zgradi (kao @@unique([buildingId, label])).

export type DraftUnitInput = {
  buildingKey: string;
  entranceKey?: string | null;
  type: string;
  label: string;
  floor?: string | null;
  usableArea: string;
  ownershipShare: string;
};

export function validUnit(d: OnboardingDraftData, input: DraftUnitInput, selfKey: string | null) {
  const building = d.buildings.find((b) => b.key === input.buildingKey);
  if (!building) throw new Error("Zgrada nije pronađena u nacrtu.");
  const entranceKey = trimOr(input.entranceKey) || null;
  if (entranceKey && !building.entrances.some((e) => e.key === entranceKey)) throw new Error("Ulaz ne pripada izabranoj zgradi.");
  if (!(UNIT_TYPES as readonly string[]).includes(input.type)) throw new Error("Izaberite vrstu posebnog dijela.");
  const label = trimOr(input.label);
  if (!label) throw new Error("Oznaka posebnog dijela je obavezna.");
  if (d.units.some((u) => u.key !== selfKey && u.buildingKey === building.key && u.label.toLowerCase() === label.toLowerCase())) {
    throw new Error(tf("onboarding.units.duplicateLabel", { oznaka: label, zgrada: building.name }));
  }
  const usableArea = positiveDecimal(input.usableArea, t("onboarding.units.usableArea"));
  const ownershipShare = positiveDecimal(input.ownershipShare, t("onboarding.units.ownershipShare"));
  if (Number(ownershipShare) > 100) throw new Error(`${t("onboarding.units.ownershipShare")}: najviše 100 %.`);
  return {
    buildingKey: building.key, entranceKey, type: input.type as DraftUnitType, label,
    floor: optionalInt(input.floor, t("onboarding.units.floor")), usableArea, ownershipShare,
  };
}

// ---- Korak 6 — Zajednički dijelovi ----------------------------------------------------------------

export type CommonAssetInput = { buildingKey: string; kind: string; name: string; description?: string | null };

/** Polja zajedničkog dijela bez ključa; zgrada se provjerava u nacrtu (assertBuildingExists). */
export function normalizeCommonAsset(input: CommonAssetInput) {
  const name = trimOr(input.name);
  if (!name) throw new Error("Naziv zajedničkog dijela je obavezan.");
  if (!(ASSET_KINDS as readonly string[]).includes(input.kind)) throw new Error("Izaberite vrstu zajedničkog dijela.");
  return { buildingKey: input.buildingKey, kind: input.kind as DraftAssetKind, name, description: trimOr(input.description) || null };
}

export function assertBuildingExists(d: OnboardingDraftData, buildingKey: string) {
  if (!d.buildings.some((b) => b.key === buildingKey)) throw new Error("Zgrada nije pronađena u nacrtu.");
}

// ---- Korak 8 — Lica ----------------------------------------------------------------------------

export type NewPartyInput = {
  kind: string;
  firstName?: string | null;
  lastName?: string | null;
  orgName?: string | null;
  orgIdNumber?: string | null;
  email?: string | null;
  phone?: string | null;
};

/** Novo lice nacrta sa datim ključem (ključ dodjeljuje pozivalac, da ovaj modul ostane bez slučajnosti). */
export function normalizeParty(input: NewPartyInput, key: string): DraftParty {
  const kind = input.kind === "ORGANIZATION" ? "ORGANIZATION" : "PERSON";
  const firstName = trimOr(input.firstName), lastName = trimOr(input.lastName), orgName = trimOr(input.orgName);
  if (kind === "PERSON" && (!firstName || !lastName)) throw new Error("Za fizičko lice upišite ime i prezime.");
  if (kind === "ORGANIZATION" && !orgName) throw new Error("Za pravno lice upišite naziv.");
  const email = trimOr(input.email);
  if (email && !emailAddressSchema.safeParse(email).success) throw new Error("Unesite ispravnu e-mail adresu.");
  return {
    key, kind, firstName, lastName, orgName, orgIdNumber: trimOr(input.orgIdNumber),
    email: email.toLowerCase(), phone: trimOr(input.phone),
  };
}
