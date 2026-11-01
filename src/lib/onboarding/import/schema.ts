// Čitanje JSON fajla uvoza u međuoblik `ImportDoc` (Plans/mcp-onboarding-asistent-plan.md §8). ČISTO: fajl je samo
// podatak — ništa se ne izvršava, JSON.parse je jedino tumačenje. Oblik JSON-a je izlaz alata get_draft uz `format` i
// `formatVersion` (NE „version”, koji je verzija nacrta), pa se izvezen ili pročitan nacrt može ponovo uvesti.
// Ovdje se samo normalizuje oblik (tekst/broj → tekst, datumi → yyyy-mm-dd, nazivi vrsta → šifre); POSLOVNA pravila
// (iznosi, jedinstvenost, veze) provjerava planer kroz iste funkcije kao čarobnjak (rules.ts).
import { z } from "zod";
import { t, tf } from "@/lib/i18n";
import { IMPORT_FORMAT_ID, IMPORT_FORMAT_VERSION, IMPORT_LIMITS, normalizeHeader } from "@/lib/onboarding/import/importFormat";

export type ImportSection = "file" | "zev" | "accounts" | "buildings" | "units" | "commonAssets" | "parties" | "stakeProposals" | "offices";

/** Red = redni broj stavke u listi (JSON) ili fizički red fajla (CSV, zaglavlje = 1). */
export type ImportIssue = { section: ImportSection; row: number | null; field?: string; message: string };

type R = { row: number };
export type ImpAccount = R & { key?: string; type?: string; name?: string; bankName?: string; number?: string; openingBalance?: string; openingDate?: string };
export type ImpEntrance = R & { key?: string; name?: string };
export type ImpBuilding = R & { key?: string; name?: string; address?: string; cadastralRef?: string; yearBuilt?: string; floorsCount?: string; entrances: ImpEntrance[] };
export type ImpUnit = R & { key?: string; buildingKey?: string; entranceKey?: string; type?: string; label?: string; floor?: string; usableArea?: string; ownershipShare?: string };
export type ImpAsset = R & { key?: string; buildingKey?: string; kind?: string; name?: string; description?: string };
export type ImpParty = R & { key?: string; kind?: string; firstName?: string; lastName?: string; orgName?: string; orgIdNumber?: string; email?: string; phone?: string };
export type ImpStake = R & { key?: string; unitKey?: string; partyKey?: string; sharePercent?: string; validFrom?: string };
export type ImpDisputed = R & { unitKey: string };
export type ImpOfficeTerm = R & { partyKey?: string; validFrom?: string };

export const ZEV_FIELDS = ["legalName", "shortName", "registrationNumber", "jib", "registeredAddress", "city", "municipality", "foundingDate", "registrationDate"] as const;
export const PRESIDENT_FIELDS = ["firstName", "lastName", "phone"] as const;

export type ImportDoc = {
  kind: "json" | "csv";
  zev?: Partial<Record<(typeof ZEV_FIELDS)[number], string>>;
  president?: Partial<Record<(typeof PRESIDENT_FIELDS)[number], string>>;
  accounts?: ImpAccount[];
  buildings?: ImpBuilding[];
  units?: ImpUnit[];
  commonAssets?: ImpAsset[];
  parties?: ImpParty[];
  stakes?: ImpStake[];
  disputedUnits?: ImpDisputed[];
  offices?: { accountant?: "LATER" | (ImpOfficeTerm) | null; board?: ImpOfficeTerm[] };
};

export type ParsedImport = { doc: ImportDoc | null; errors: ImportIssue[]; warnings: ImportIssue[] };

// ---- Normalizacije vrijednosti (dijele ih JSON i CSV) ----------------------------------------

/** yyyy-mm-dd ili dd.mm.yyyy (sa tačkom na kraju ili bez) → yyyy-mm-dd; ostalo se vraća kako jeste (pravilo će odbiti). */
export function normDate(raw: string): string {
  const s = raw.trim();
  const iso = /^(\d{4})-(\d{2})-(\d{2})(?:T.*)?$/.exec(s);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  const dmy = /^(\d{1,2})\.\s*(\d{1,2})\.\s*(\d{4})\.?$/.exec(s);
  if (dmy) return `${dmy[3]}-${dmy[2].padStart(2, "0")}-${dmy[1].padStart(2, "0")}`;
  return s;
}

const UNIT_TYPE_ALIASES: Record<string, string> = {
  stan: "APARTMENT", apartman: "APARTMENT", apartment: "APARTMENT",
  poslovni_prostor: "BUSINESS", poslovni: "BUSINESS", lokal: "BUSINESS", business: "BUSINESS",
  garaza: "GARAGE", garage: "GARAGE",
  garazno_mjesto: "GARAGE_SPACE", garazno_mesto: "GARAGE_SPACE", parking: "GARAGE_SPACE", garage_space: "GARAGE_SPACE",
  ostalo: "OTHER", other: "OTHER",
};
const ACCOUNT_TYPE_ALIASES: Record<string, string> = { bank: "BANK", bankovni_racun: "BANK", bankovni: "BANK", racun: "BANK", cash: "CASH", blagajna: "CASH", gotovina: "CASH" };
const ASSET_KIND_ALIASES: Record<string, string> = {
  area: "AREA", prostor: "AREA", zajednicki_prostor: "AREA", system: "SYSTEM", sistem: "SYSTEM", equipment: "EQUIPMENT", oprema: "EQUIPMENT",
};
const PARTY_KIND_ALIASES: Record<string, string> = {
  person: "PERSON", fizicko: "PERSON", fizicko_lice: "PERSON", organization: "ORGANIZATION", pravno: "ORGANIZATION", pravno_lice: "ORGANIZATION",
};

const alias = (map: Record<string, string>, raw: string) => map[normalizeHeader(raw)] ?? raw;
export const normUnitType = (raw: string) => alias(UNIT_TYPE_ALIASES, raw);
export const normAccountType = (raw: string) => alias(ACCOUNT_TYPE_ALIASES, raw);
export const normAssetKind = (raw: string) => alias(ASSET_KIND_ALIASES, raw);
export const normPartyKind = (raw: string) => alias(PARTY_KIND_ALIASES, raw);
/** „P” i „prizemlje” su nulti sprat. */
export const normFloor = (raw: string) => (/^(p|prizemlje)$/i.test(raw.trim()) ? "0" : raw.trim());

// ---- JSON ---------------------------------------------------------------------------------------

const scalarSchema = z.union([z.string(), z.number().finite()]);

type Ctx = { errors: ImportIssue[]; warnings: ImportIssue[] };
type Spec = { scalars: readonly string[]; ignored?: readonly string[] };

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/** Tekst ili broj → tekst (obrezan); prazno → undefined. Drugi tipovi su greška polja. */
function scalar(v: unknown, path: string, section: ImportSection, row: number | null, ctx: Ctx): string | undefined {
  if (v === null || v === undefined) return undefined;
  const p = scalarSchema.safeParse(v);
  if (!p.success) {
    ctx.errors.push({ section, row, field: path, message: tf("onboarding.import.msg.fieldNotScalar", { polje: path }) });
    return undefined;
  }
  const s = String(p.data).trim();
  return s === "" ? undefined : s;
}

function readObject(raw: Record<string, unknown>, spec: Spec, base: string, section: ImportSection, row: number | null, ctx: Ctx, extraKnown: readonly string[] = []): Record<string, string | undefined> {
  const out: Record<string, string | undefined> = {};
  for (const k of spec.scalars) out[k] = scalar(raw[k], `${base}.${k}`, section, row, ctx);
  const known = new Set<string>([...spec.scalars, ...(spec.ignored ?? []), ...extraKnown]);
  for (const k of Object.keys(raw)) {
    if (known.has(k)) continue;
    ctx.warnings.push({ section, row, field: `${base}.${k}`, message: tf("onboarding.import.msg.unknownField", { polje: `${base}.${k}` }) });
  }
  return out;
}

function readList(raw: unknown, name: string, section: ImportSection, ctx: Ctx): { index: number; obj: Record<string, unknown> }[] {
  if (raw === undefined || raw === null) return [];
  if (!Array.isArray(raw)) {
    ctx.errors.push({ section, row: null, field: name, message: tf("onboarding.import.msg.sectionNotList", { sekcija: name }) });
    return [];
  }
  const out: { index: number; obj: Record<string, unknown> }[] = [];
  raw.forEach((item, i) => {
    if (!isObj(item)) ctx.errors.push({ section, row: i + 1, field: `${name}[${i}]`, message: t("onboarding.import.msg.itemNotObject") });
    else out.push({ index: i, obj: item });
  });
  return out;
}

const SPECS = {
  zev: { scalars: ["legalName", "shortName", "registrationNumber", "jib", "registeredAddress", "city", "municipality", "foundingDate", "registrationDate"], ignored: ["jibValid"] },
  president: { scalars: ["firstName", "lastName", "phone"] },
  accounts: { scalars: ["key", "type", "name", "bankName", "number", "openingBalance", "openingDate"], ignored: ["numberValid", "source"] },
  buildings: { scalars: ["key", "name", "address", "cadastralRef", "yearBuilt", "floorsCount"], ignored: ["source"] },
  entrances: { scalars: ["key", "name"], ignored: ["source"] },
  units: { scalars: ["key", "buildingKey", "entranceKey", "type", "label", "floor", "usableArea", "ownershipShare"], ignored: ["source"] },
  commonAssets: { scalars: ["key", "buildingKey", "kind", "name", "description"], ignored: ["source"] },
  parties: { scalars: ["key", "kind", "firstName", "lastName", "orgName", "orgIdNumber", "email", "phone"], ignored: ["source"] },
  stakes: { scalars: ["key", "unitKey", "partyKey", "sharePercent", "validFrom"], ignored: ["proof", "proofFilename", "source"] },
  term: { scalars: ["key", "partyKey", "validFrom"], ignored: ["hasPassword", "source"] },
} satisfies Record<string, Spec>;

const TOP_KNOWN = [
  "format", "formatVersion", "zev", "president", "accounts", "buildings", "units", "commonAssets", "parties", "stakes", "stakeProposals",
  "disputedUnits", "offices",
  // Izlaz alata get_draft i izvoza nacrta: poznata polja koja se ne uvoze.
  "draftId", "label", "tier", "version", "access", "registerConfirmedAt", "noAccounts",
];

const dateFields = (o: Record<string, string | undefined>, ...names: string[]) => {
  for (const n of names) if (o[n]) o[n] = normDate(o[n]!);
};

/** JSON fajl → ImportDoc. Strukturne greške (nije JSON, pogrešan format/verzija, loš tip polja) idu u `errors`. */
export function parseJsonImport(text: string): ParsedImport {
  const ctx: Ctx = { errors: [], warnings: [] };
  const fail = (message: string): ParsedImport => ({ doc: null, errors: [{ section: "file", row: null, message }], warnings: [] });
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (e) {
    return fail(tf("onboarding.import.msg.notJson", { razlog: e instanceof Error ? e.message : "" }));
  }
  if (!isObj(raw)) return fail(t("onboarding.import.msg.notObject"));
  if (raw.format !== IMPORT_FORMAT_ID) return fail(tf("onboarding.import.msg.badFormat", { format: IMPORT_FORMAT_ID }));
  if (raw.formatVersion !== IMPORT_FORMAT_VERSION) {
    return fail(tf("onboarding.import.msg.badVersion", { verzija: String(raw.formatVersion ?? "—"), podrzana: IMPORT_FORMAT_VERSION }));
  }
  for (const k of Object.keys(raw)) {
    if (!TOP_KNOWN.includes(k)) ctx.warnings.push({ section: "file", row: null, field: k, message: tf("onboarding.import.msg.unknownField", { polje: k }) });
  }
  const doc: ImportDoc = { kind: "json" };

  if (raw.zev !== undefined && raw.zev !== null) {
    if (!isObj(raw.zev)) ctx.errors.push({ section: "zev", row: null, field: "zev", message: t("onboarding.import.msg.itemNotObject") });
    else {
      const z = readObject(raw.zev, SPECS.zev, "zev", "zev", null, ctx);
      dateFields(z, "foundingDate", "registrationDate");
      doc.zev = z;
    }
  }
  if (raw.president !== undefined && raw.president !== null) {
    if (!isObj(raw.president)) ctx.errors.push({ section: "zev", row: null, field: "president", message: t("onboarding.import.msg.itemNotObject") });
    else doc.president = readObject(raw.president, SPECS.president, "president", "zev", null, ctx);
  }

  if (raw.accounts !== undefined) {
    doc.accounts = readList(raw.accounts, "accounts", "accounts", ctx).map(({ index, obj }) => {
      const o = readObject(obj, SPECS.accounts, `accounts[${index}]`, "accounts", index + 1, ctx);
      dateFields(o, "openingDate");
      if (o.type) o.type = normAccountType(o.type);
      return { row: index + 1, ...o };
    });
  }
  if (raw.buildings !== undefined) {
    doc.buildings = readList(raw.buildings, "buildings", "buildings", ctx).map(({ index, obj }) => {
      const base = `buildings[${index}]`;
      const o = readObject(obj, SPECS.buildings, base, "buildings", index + 1, ctx, ["entrances"]);
      const entrances = readList(obj.entrances, `${base}.entrances`, "buildings", ctx).map((e) => ({
        row: index + 1, ...readObject(e.obj, SPECS.entrances, `${base}.entrances[${e.index}]`, "buildings", index + 1, ctx),
      }));
      return { row: index + 1, ...o, entrances };
    });
  }
  if (raw.units !== undefined) {
    doc.units = readList(raw.units, "units", "units", ctx).map(({ index, obj }) => {
      const o = readObject(obj, SPECS.units, `units[${index}]`, "units", index + 1, ctx);
      if (o.type) o.type = normUnitType(o.type);
      if (o.floor) o.floor = normFloor(o.floor);
      return { row: index + 1, ...o };
    });
  }
  if (raw.commonAssets !== undefined) {
    doc.commonAssets = readList(raw.commonAssets, "commonAssets", "commonAssets", ctx).map(({ index, obj }) => {
      const o = readObject(obj, SPECS.commonAssets, `commonAssets[${index}]`, "commonAssets", index + 1, ctx);
      if (o.kind) o.kind = normAssetKind(o.kind);
      return { row: index + 1, ...o };
    });
  }
  if (raw.parties !== undefined) {
    doc.parties = readList(raw.parties, "parties", "parties", ctx).map(({ index, obj }) => {
      const o = readObject(obj, SPECS.parties, `parties[${index}]`, "parties", index + 1, ctx);
      if (o.kind) o.kind = normPartyKind(o.kind);
      return { row: index + 1, ...o };
    });
  }
  // `stakeProposals` (izlaz get_draft) ima isti oblik kao `stakes`: oboje postaju prijedlozi.
  const stakes: ImpStake[] = [];
  for (const name of ["stakes", "stakeProposals"] as const) {
    if (raw[name] === undefined) continue;
    for (const { index, obj } of readList(raw[name], name, "stakeProposals", ctx)) {
      const o = readObject(obj, SPECS.stakes, `${name}[${index}]`, "stakeProposals", index + 1, ctx);
      dateFields(o, "validFrom");
      stakes.push({ row: stakes.length + 1, ...o });
    }
  }
  if (raw.stakes !== undefined || raw.stakeProposals !== undefined) doc.stakes = stakes;

  if (raw.disputedUnits !== undefined && raw.disputedUnits !== null) {
    if (!Array.isArray(raw.disputedUnits)) ctx.errors.push({ section: "stakeProposals", row: null, field: "disputedUnits", message: tf("onboarding.import.msg.sectionNotList", { sekcija: "disputedUnits" }) });
    else {
      doc.disputedUnits = [];
      raw.disputedUnits.forEach((v, i) => {
        const s = scalar(v, `disputedUnits[${i}]`, "stakeProposals", i + 1, ctx);
        if (s) doc.disputedUnits!.push({ row: i + 1, unitKey: s });
      });
    }
  }

  if (raw.offices !== undefined && raw.offices !== null) {
    if (!isObj(raw.offices)) ctx.errors.push({ section: "offices", row: null, field: "offices", message: t("onboarding.import.msg.itemNotObject") });
    else {
      const off = raw.offices;
      const offices: NonNullable<ImportDoc["offices"]> = {};
      for (const k of Object.keys(off)) {
        if (k !== "accountant" && k !== "board") ctx.warnings.push({ section: "offices", row: null, field: `offices.${k}`, message: tf("onboarding.import.msg.unknownField", { polje: `offices.${k}` }) });
      }
      const acc = off.accountant;
      if (acc === "LATER") offices.accountant = "LATER";
      else if (isObj(acc)) {
        const loginKeys = ["loginEmail", "password", "passwordHash"].filter((k) => acc[k] !== undefined && acc[k] !== null && acc[k] !== "");
        if (loginKeys.length > 0) ctx.warnings.push({ section: "offices", row: null, field: "offices.accountant", message: t("onboarding.import.msg.loginIgnored") });
        const o = readObject(acc, SPECS.term, "offices.accountant", "offices", 1, ctx, ["loginEmail", "password", "passwordHash"]);
        dateFields(o, "validFrom");
        offices.accountant = { row: 1, partyKey: o.partyKey, validFrom: o.validFrom };
      } else if (acc !== undefined && acc !== null) {
        ctx.errors.push({ section: "offices", row: null, field: "offices.accountant", message: t("onboarding.import.msg.accountantShape") });
      }
      if (off.board !== undefined) {
        offices.board = readList(off.board, "offices.board", "offices", ctx).map(({ index, obj }) => {
          const o = readObject(obj, SPECS.term, `offices.board[${index}]`, "offices", index + 1, ctx);
          dateFields(o, "validFrom");
          return { row: index + 1, partyKey: o.partyKey, validFrom: o.validFrom };
        });
      }
      doc.offices = offices;
    }
  }

  checkLimits(doc, ctx);
  return { doc, errors: ctx.errors, warnings: ctx.warnings };
}

/** Ograničenja veličine (IMPORT_LIMITS): prevelik fajl se odbija prije planiranja. */
export function checkLimits(doc: ImportDoc, ctx: Ctx): void {
  const over = (section: ImportSection, name: string, count: number, limit: number) => {
    if (count > limit) ctx.errors.push({ section, row: null, message: tf("onboarding.import.msg.tooMany", { sekcija: name, granica: limit }) });
  };
  over("units", "units", doc.units?.length ?? 0, IMPORT_LIMITS.units);
  over("parties", "parties", doc.parties?.length ?? 0, IMPORT_LIMITS.parties);
  over("stakeProposals", "stakes", doc.stakes?.length ?? 0, IMPORT_LIMITS.stakes);
  const total =
    (doc.accounts?.length ?? 0) + (doc.units?.length ?? 0) + (doc.commonAssets?.length ?? 0) + (doc.parties?.length ?? 0) + (doc.stakes?.length ?? 0) +
    (doc.disputedUnits?.length ?? 0) + (doc.offices?.board?.length ?? 0) +
    (doc.buildings ?? []).reduce((n, b) => n + 1 + b.entrances.length, 0);
  over("file", "ukupno", total, IMPORT_LIMITS.items);
}
