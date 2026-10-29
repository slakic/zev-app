// Oblik nacrta novog ZEV-a (OnboardingDraft.data) — Plans/zev-onboarding-wizard-plan.md §2.4.
// Ključevi stavki (`key`) su lokalni za nacrt; ID-jevi iz baze nastaju tek pri objavi (Faza C).
// Čisto: bez baze, da ga koriste i servis, stranice i testovi.
import { z } from "zod";

const accountSchema = z.object({
  key: z.string(),
  type: z.enum(["BANK", "CASH"]),
  name: z.string(),
  bankName: z.string().nullable().default(null),
  number: z.string().nullable().default(null),
  openingBalance: z.string(),
  openingDate: z.string(), // yyyy-mm-dd
});

const entranceSchema = z.object({ key: z.string(), name: z.string() });

const buildingSchema = z.object({
  key: z.string(),
  name: z.string(),
  address: z.string(),
  cadastralRef: z.string().nullable().default(null),
  yearBuilt: z.number().int().nullable().default(null),
  floorsCount: z.number().int().nullable().default(null),
  entrances: z.array(entranceSchema).default([]),
});

/** Posebni dio u nacrtu: ista polja koja registar provjerava (RegisterPreconditionUnit) + položaj u zgradi.
 *  `usableArea` i `ownershipShare` su decimalni stringovi ("62.40", "12.5"). */
const unitSchema = z.object({
  key: z.string(),
  buildingKey: z.string(),
  entranceKey: z.string().nullable().default(null),
  type: z.enum(["APARTMENT", "BUSINESS", "GARAGE", "GARAGE_SPACE", "OTHER"]),
  label: z.string(),
  floor: z.number().int().nullable().default(null),
  usableArea: z.string(),
  ownershipShare: z.string(),
});

const commonAssetSchema = z.object({
  key: z.string(),
  buildingKey: z.string(),
  kind: z.enum(["AREA", "SYSTEM", "EQUIPMENT"]),
  name: z.string(),
  description: z.string().nullable().default(null),
});

/** Ključ lica „predsjednik” (pozvani): njegovo lice nastaje pri objavi iz `president`, pa ga koraci 8 i 9
 *  biraju ovim ključem umjesto da prave drugo lice za istu osobu. */
export const PRESIDENT_PARTY_KEY = "president";

const partySchema = z.object({
  key: z.string(),
  kind: z.enum(["PERSON", "ORGANIZATION"]),
  firstName: z.string().default(""),
  lastName: z.string().default(""),
  orgName: z.string().default(""),
  orgIdNumber: z.string().default(""),
  email: z.string().default(""),
  phone: z.string().default(""),
});

const stakeSchema = z.object({
  key: z.string(),
  unitKey: z.string(),
  partyKey: z.string(),
  sharePercent: z.string(),
  validFrom: z.string(), // yyyy-mm-dd
  proofFileId: z.string(), // OnboardingDraftFile.id
  proofFilename: z.string().default(""),
});

const officeTermSchema = z.object({ key: z.string(), partyKey: z.string(), validFrom: z.string() });

const accountantSchema = officeTermSchema.extend({
  /** Nalog računovođe (nije obavezan): e-adresa za prijavu i hash početne lozinke — nikad otvoren tekst. */
  loginEmail: z.string().nullable().default(null),
  passwordHash: z.string().nullable().default(null),
});

export const draftDataSchema = z.object({
  zev: z
    .object({
      legalName: z.string().default(""),
      shortName: z.string().default(""),
      registrationNumber: z.string().default(""),
      jib: z.string().default(""),
      registeredAddress: z.string().default(""),
      city: z.string().default(""),
      municipality: z.string().default(""),
      foundingDate: z.string().default(""),
      registrationDate: z.string().default(""),
    })
    .prefault({}),
  president: z
    .object({ firstName: z.string().default(""), lastName: z.string().default(""), phone: z.string().default("") })
    .prefault({}),
  accounts: z.array(accountSchema).default([]),
  buildings: z.array(buildingSchema).default([]),
  units: z.array(unitSchema).default([]),
  commonAssets: z.array(commonAssetSchema).default([]),
  registerConfirmedAt: z.string().nullable().default(null),
  parties: z.array(partySchema).default([]),
  stakes: z.array(stakeSchema).default([]),
  /** Posebni dijelovi sa potvrdom „vlasništvo u sporu — unijeću kasnije” (D6a). */
  disputedUnits: z.array(z.string()).default([]),
  offices: z
    .object({
      /** null = još nije odlučeno; "LATER" = računovođu dodajem kasnije. */
      accountant: z.union([accountantSchema, z.literal("LATER")]).nullable().default(null),
      board: z.array(officeTermSchema).default([]),
    })
    .prefault({}),
  acks: z.object({ noAccounts: z.boolean().default(false) }).prefault({}),
});

export type OnboardingDraftData = z.infer<typeof draftDataSchema>;
export type DraftAccount = OnboardingDraftData["accounts"][number];
export type DraftBuilding = OnboardingDraftData["buildings"][number];
export type DraftUnit = OnboardingDraftData["units"][number];
export type DraftCommonAsset = OnboardingDraftData["commonAssets"][number];

export type DraftParty = OnboardingDraftData["parties"][number];
export type DraftStake = OnboardingDraftData["stakes"][number];

/** Ime lica za prikaz (isto pravilo kao partyDisplayName u aplikaciji); predsjednik je „ime prezime”. */
export function draftPartyName(data: OnboardingDraftData, partyKey: string): string {
  if (partyKey === PRESIDENT_PARTY_KEY) return `${data.president.firstName} ${data.president.lastName}`.trim();
  const p = data.parties.find((x) => x.key === partyKey);
  if (!p) return "?";
  return p.kind === "PERSON" ? `${p.firstName} ${p.lastName}`.trim() : p.orgName;
}

/** Jedinica iz nacrta u obliku koji traži registerPreconditions (sve jedinice nacrta su aktivne). */
export function asRegisterUnit(u: DraftUnit) {
  return { label: u.label, type: u.type, usableArea: u.usableArea, ownershipShare: u.ownershipShare, active: true };
}

/** Čita `data` iz baze; nepoznata ili stara polja ne ruše čitanje, nedostajuća dobijaju podrazumijevanu vrijednost. */
export function parseDraftData(raw: unknown): OnboardingDraftData {
  return draftDataSchema.parse(raw ?? {});
}

/** Početni nacrt pri prihvatanju poziva: radni naziv iz poziva i ime pozvanog, ako je poznato. */
export function initialDraftData(input: { workingName: string; firstName?: string; lastName?: string; phone?: string }): OnboardingDraftData {
  return parseDraftData({
    zev: { legalName: input.workingName },
    president: { firstName: input.firstName ?? "", lastName: input.lastName ?? "", phone: input.phone ?? "" },
  });
}
