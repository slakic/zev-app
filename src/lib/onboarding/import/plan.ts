// Planer uvoza: `planDraftImport(trenutni nacrt, ImportDoc) → { next, report }` (Plans/mcp-onboarding-asistent-plan.md §8).
// ČISTO: bez baze i bez slučajnosti osim fabrike ključeva. Sva POSLOVNA pravila polja su ona iz čarobnjaka
// (src/lib/onboarding/rules.ts), pa uvoz ne može biti blaži od unosa rukom.
//
// Spajanje je „dopuni i ažuriraj, nikad ne briši”: stavka se prepoznaje po ključu (iz fajla ili već u nacrtu), pa po
// prirodnom identitetu (račun: broj/naziv, zgrada: naziv, posebni dio: zgrada + oznaka, lice: e-adresa pa ime…).
// Prazna ili izostavljena polja ne brišu postojeće vrijednosti. Vlasnički udjeli iz fajla postaju PRIJEDLOZI
// (`stakeProposals`) jer udio bez dokaza ne smije postati udio. Svaka greška se prijavljuje sa sekcijom i redom; ako je
// bilo koja, pozivalac ne upisuje ništa (atomično).
import {
  PRESIDENT_PARTY_KEY, type DraftAccount, type DraftBuilding, type DraftParty, type DraftUnit, type OnboardingDraftData,
} from "@/lib/onboarding/draft";
import {
  assertBuildingExists, assertBuildingNameFree, assertDate, assertEntranceNameFree, normalizeAccount, normalizeBuilding,
  normalizeCommonAsset, normalizeEntranceName, normalizeParty, validUnit,
} from "@/lib/onboarding/rules";
import { ZEV_FIELDS, PRESIDENT_FIELDS, type ImportDoc, type ImportIssue, type ImportSection } from "@/lib/onboarding/import/schema";
import { classifyShareSum, assertSharePercent, sumShares } from "@/lib/shareSum";
import { isValidJib } from "@/lib/identifiers";
import { dec } from "@/lib/money";
import { parseMoneyInput } from "@/lib/money";
import { t, tf } from "@/lib/i18n";
import { PLAN_SECTIONS, type PlanSection, type SectionCounts } from "@/lib/onboarding/import/sections";

export { PLAN_SECTIONS, type PlanSection, type SectionCounts };

export type ImportReport = {
  counts: Record<PlanSection, SectionCounts>;
  errors: ImportIssue[];
  warnings: ImportIssue[];
  /** Dodato + izmijenjeno; 0 znači „fajl ne donosi promjene”. */
  added: number;
  updated: number;
  /** Novi prijedlozi udjela (čekaju dokaz u koraku „Vlasnici”). */
  proposals: number;
};

export type PlanOptions = { newKey?: () => string };

/** Preskakanje bez poruke: stavka upućuje na nešto što je već prijavljeno (greška) ili preskočeno (zaključan registar). */
class Silent extends Error {}

const lower = (s: string | null | undefined) => (s ?? "").trim().toLowerCase();
const same = (a: string | null | undefined, b: string | null | undefined) => (a ?? "") === (b ?? "");
const sameDec = (a: string | null | undefined, b: string | null | undefined) => {
  try {
    return dec(a || "0").equals(dec(b || "0"));
  } catch {
    return a === b;
  }
};

/** Datum mora i postojati u kalendaru (pravilo čarobnjaka provjerava samo oblik, jer polje tipa date ne propušta 31.02.). */
function checkedDate(raw: string | undefined, label: string): string {
  const v = assertDate(raw ?? "", label);
  const dt = new Date(`${v}T00:00:00Z`);
  if (Number.isNaN(dt.getTime()) || dt.toISOString().slice(0, 10) !== v) throw new Error(`${label}: datum ne postoji.`);
  return v;
}

const emptyCounts = (): Record<PlanSection, SectionCounts> =>
  Object.fromEntries(PLAN_SECTIONS.map((s) => [s, { added: 0, updated: 0, unchanged: 0, skipped: 0 }])) as Record<PlanSection, SectionCounts>;

export function planDraftImport(current: OnboardingDraftData, doc: ImportDoc, opts: PlanOptions = {}): { next: OnboardingDraftData; report: ImportReport } {
  const newKey = opts.newKey ?? (() => globalThis.crypto.randomUUID());
  const d = structuredClone(current);
  const counts = emptyCounts();
  const errors: ImportIssue[] = [];
  const warnings: ImportIssue[] = [];
  const locked = Boolean(current.registerConfirmedAt);
  let lockedSkipped = 0;

  // Ključ iz fajla → ključ u nacrtu (postojeći ili novi), samo za razrješavanje veza.
  const fb = new Map<string, string>(), fe = new Map<string, string>(), fu = new Map<string, string>(), fp = new Map<string, string>();
  // Ključevi iz fajla čije stavke nisu upisane (greška ili zaključan registar): zavisne stavke se preskaču bez nove greške.
  const unresolved = new Set<string>();

  const warn = (section: ImportSection, row: number | null, message: string, field?: string) => warnings.push({ section, row, message, field });

  /** Jedna stavka: greška se hvata i prijavljuje sa sekcijom i redom, ostale stavke se i dalje obrađuju. */
  function run(section: ImportSection, count: PlanSection, row: number | null, fn: () => void, fileKey?: string) {
    try {
      fn();
    } catch (e) {
      if (fileKey) unresolved.add(fileKey);
      if (e instanceof Silent) counts[count].skipped++;
      else errors.push({ section, row, message: e instanceof Error ? e.message : String(e) });
    }
  }

  const refName = (what: string) => t(`onboarding.import.refs.${what}`);
  const unknownRef = (what: string, ref: string) => new Error(tf("onboarding.import.msg.unknownRef", { vrsta: refName(what), ref }));
  const required = (value: string | undefined, field: string) => {
    if (!value) throw new Error(tf("onboarding.import.msg.fieldRequired", { polje: field }));
    return value;
  };
  const dupOf = (seen: Map<string, number>, ident: string, row: number, what: string) => {
    const first = seen.get(ident);
    if (first !== undefined) throw new Error(tf("onboarding.import.msg.duplicateInFile", { vrsta: refName(what), red: first }));
    seen.set(ident, row);
  };

  /** Zaključan registar: zgrade, ulazi, posebni i zajednički dijelovi se ne mijenjaju (isto pravilo kao u koracima 4–6). */
  const lockedSkip = () => {
    if (!locked) return false;
    lockedSkipped++;
    return true;
  };

  // ---- Referencije ---------------------------------------------------------------------------------
  function resolveBuilding(ref: string): DraftBuilding {
    const k = fb.get(ref) ?? (d.buildings.some((b) => b.key === ref) ? ref : undefined);
    const b = k ? d.buildings.find((x) => x.key === k) : d.buildings.find((x) => lower(x.name) === lower(ref));
    if (b) return b;
    if (unresolved.has(ref)) throw new Silent();
    throw unknownRef("building", ref);
  }

  function resolveUnit(ref: string): DraftUnit {
    const k = fu.get(ref) ?? (d.units.some((u) => u.key === ref) ? ref : undefined);
    if (k) return d.units.find((u) => u.key === k)!;
    // „Zgrada A/Stan 3”: naziv zgrade pa oznaka (naziv zgrade smije sadržavati kosu crtu, pa se probaju sva mjesta).
    for (let i = ref.indexOf("/"); i >= 0; i = ref.indexOf("/", i + 1)) {
      const b = d.buildings.find((x) => lower(x.name) === lower(ref.slice(0, i)));
      const u = b && d.units.find((x) => x.buildingKey === b.key && lower(x.label) === lower(ref.slice(i + 1)));
      if (u) return u;
    }
    if (unresolved.has(ref)) throw new Silent();
    throw unknownRef("unit", ref);
  }

  function resolveParty(ref: string): string {
    if (ref === PRESIDENT_PARTY_KEY) return PRESIDENT_PARTY_KEY;
    const k = fp.get(ref) ?? (d.parties.some((p) => p.key === ref) ? ref : undefined);
    if (k) return k;
    if (unresolved.has(ref)) throw new Silent();
    throw unknownRef("party", ref);
  }

  // ---- Podaci o ZEV-u i predsjedniku ----------------------------------------------------------------
  function applyFlat<T extends Record<string, string>>(target: T, given: Partial<Record<keyof T & string, string>> | undefined, fields: readonly (keyof T & string)[], dateFields: readonly string[], label: (f: string) => string, section: ImportSection) {
    if (!given) return;
    run(section, "zev", null, () => {
      const nextVals: Record<string, string> = {};
      for (const f of fields) {
        const v = given[f];
        if (v === undefined) continue;
        nextVals[f] = dateFields.includes(f) ? checkedDate(v, label(f)) : v;
      }
      const changed = Object.entries(nextVals).filter(([f, v]) => target[f] !== v);
      if (Object.keys(nextVals).length === 0) return;
      if (changed.length === 0) counts.zev.unchanged++;
      else {
        Object.assign(target, nextVals);
        counts.zev.updated++;
      }
    });
  }
  applyFlat(d.zev, doc.zev, ZEV_FIELDS, ["foundingDate", "registrationDate"], (f) => t(`onboarding.zev.${f}`), "zev");
  applyFlat(d.president, doc.president, PRESIDENT_FIELDS, [], (f) => f, "zev");
  if (doc.zev?.jib && !isValidJib(doc.zev.jib)) warn("zev", null, t("onboarding.import.msg.jibInvalid"), "zev.jib");

  // ---- Računi -------------------------------------------------------------------------------------------
  const seenAccounts = new Map<string, number>();
  for (const a of doc.accounts ?? []) {
    run("accounts", "accounts", a.row, () => {
      const byKey = a.key ? d.accounts.find((x) => x.key === a.key) : undefined;
      const byNatural = byKey ?? (a.number
        ? d.accounts.find((x) => x.type === "BANK" && x.number === a.number)
        : a.type === "CASH" && a.name ? d.accounts.find((x) => x.type === "CASH" && lower(x.name) === lower(a.name)) : undefined);
      const ex: DraftAccount | undefined = byNatural;
      dupOf(seenAccounts, `${a.type ?? ex?.type}|${lower((a.number ?? ex?.number) || (a.name ?? ex?.name))}`, a.row, "account");
      if (a.type !== "BANK" && a.type !== "CASH" && !ex) throw new Error(t("onboarding.import.msg.accountType"));
      if (a.type && a.type !== "BANK" && a.type !== "CASH") throw new Error(t("onboarding.import.msg.accountType"));
      const fields = normalizeAccount({
        type: (a.type ?? ex!.type) as "BANK" | "CASH",
        name: a.name ?? ex?.name ?? "",
        bankName: a.bankName ?? ex?.bankName,
        number: a.number ?? ex?.number,
        openingBalance: a.openingBalance ?? ex?.openingBalance ?? "0",
        openingDate: a.openingDate ?? ex?.openingDate ?? "",
      });
      checkedDate(fields.openingDate, t("onboarding.accounts.openingDate"));
      if (ex && ex.type === fields.type && same(ex.name, fields.name) && same(ex.bankName, fields.bankName) && same(ex.number, fields.number) && sameDec(ex.openingBalance, fields.openingBalance) && same(ex.openingDate, fields.openingDate)) {
        counts.accounts.unchanged++;
        return;
      }
      const next: DraftAccount = { key: ex?.key ?? newKey(), ...fields, source: "IMPORT" };
      if (ex) {
        d.accounts[d.accounts.indexOf(ex)] = next;
        counts.accounts.updated++;
      } else {
        d.accounts.push(next);
        d.acks.noAccounts = false;
        counts.accounts.added++;
      }
    });
  }

  // ---- Zgrade i ulazi ---------------------------------------------------------------------------------------
  const seenBuildings = new Map<string, number>();
  const seenEntrances = new Map<string, number>();
  for (const b of doc.buildings ?? []) {
    run("buildings", "buildings", b.row, () => {
      const exByKey = b.key ? (fb.has(b.key) ? undefined : d.buildings.find((x) => x.key === b.key)) : undefined;
      const ex: DraftBuilding | undefined = exByKey ?? (b.name ? d.buildings.find((x) => lower(x.name) === lower(b.name)) : undefined);
      if (b.key && fb.has(b.key)) throw new Error(tf("onboarding.import.msg.duplicateKey", { kljuc: b.key }));
      dupOf(seenBuildings, lower(b.name ?? ex?.name), b.row, "building");
      const fields = normalizeBuilding({
        // Prepoznat po nazivu: naziv je identitet i ne mijenja se (npr. samo veličina slova); preimenuje se samo po ključu.
        name: (exByKey ? b.name : undefined) ?? ex?.name ?? b.name ?? "",
        address: b.address ?? ex?.address ?? "",
        cadastralRef: b.cadastralRef ?? ex?.cadastralRef,
        yearBuilt: b.yearBuilt ?? (ex?.yearBuilt != null ? String(ex.yearBuilt) : null),
        floorsCount: b.floorsCount ?? (ex?.floorsCount != null ? String(ex.floorsCount) : null),
      });
      assertBuildingNameFree(d, fields.name, ex?.key ?? null);
      const identical = Boolean(ex) && same(ex!.name, fields.name) && same(ex!.address, fields.address) && same(ex!.cadastralRef, fields.cadastralRef) && ex!.yearBuilt === fields.yearBuilt && ex!.floorsCount === fields.floorsCount;
      let target: DraftBuilding;
      if (identical) {
        counts.buildings.unchanged++;
        target = ex!;
      } else if (lockedSkip()) {
        counts.buildings.skipped++;
        if (b.key) unresolved.add(b.key);
        if (!ex) return; // novu zgradu nema smisla spajati sa ulazima
        target = ex;
      } else if (ex) {
        Object.assign(ex, fields, { source: "IMPORT" as const });
        counts.buildings.updated++;
        target = ex;
      } else {
        target = { key: newKey(), ...fields, entrances: [], source: "IMPORT" };
        d.buildings.push(target);
        counts.buildings.added++;
      }
      if (b.key) fb.set(b.key, target.key);

      for (const e of b.entrances) {
        run("buildings", "buildings", b.row, () => {
          const wanted = normalizeEntranceName(e.name ?? "");
          const eByKey = e.key ? (fe.has(e.key) ? undefined : target.entrances.find((x) => x.key === e.key)) : undefined;
          const eex = eByKey ?? target.entrances.find((x) => lower(x.name) === lower(wanted));
          const name = eByKey ? wanted : eex?.name ?? wanted;
          if (e.key && fe.has(e.key)) throw new Error(tf("onboarding.import.msg.duplicateKey", { kljuc: e.key }));
          dupOf(seenEntrances, `${target.key}|${lower(name)}`, b.row, "entrance");
          assertEntranceNameFree(target, name, eex?.key ?? null);
          if (eex && same(eex.name, name)) {
            counts.buildings.unchanged++;
          } else if (lockedSkip()) {
            counts.buildings.skipped++;
            if (e.key) unresolved.add(e.key);
            return;
          } else if (eex) {
            eex.name = name;
            eex.source = "IMPORT";
            counts.buildings.updated++;
          } else {
            target.entrances.push({ key: newKey(), name, source: "IMPORT" });
            counts.buildings.added++;
          }
          if (e.key) fe.set(e.key, (eex ?? target.entrances[target.entrances.length - 1]).key);
        }, e.key);
      }
    }, b.key);
  }

  // ---- Posebni dijelovi ------------------------------------------------------------------------------------------
  const seenUnits = new Map<string, number>();
  for (const u of doc.units ?? []) {
    run("units", "units", u.row, () => {
      const exByKey = u.key ? (fu.has(u.key) ? undefined : d.units.find((x) => x.key === u.key)) : undefined;
      if (u.key && fu.has(u.key)) throw new Error(tf("onboarding.import.msg.duplicateKey", { kljuc: u.key }));
      const building = u.buildingKey ? resolveBuilding(u.buildingKey) : exByKey ? d.buildings.find((b) => b.key === exByKey.buildingKey) : undefined;
      if (!building) throw new Error(tf("onboarding.import.msg.fieldRequired", { polje: "buildingKey" }));
      const ex: DraftUnit | undefined = exByKey ?? (u.label ? d.units.find((x) => x.buildingKey === building.key && lower(x.label) === lower(u.label)) : undefined);
      dupOf(seenUnits, `${building.key}|${lower(u.label ?? ex?.label)}`, u.row, "unit");
      let entranceKey: string | null | undefined = ex?.entranceKey;
      if (u.entranceKey) {
        const e = building.entrances.find((x) => x.key === (fe.get(u.entranceKey!) ?? u.entranceKey)) ?? building.entrances.find((x) => lower(x.name) === lower(u.entranceKey));
        if (!e) {
          if (unresolved.has(u.entranceKey)) throw new Silent();
          throw unknownRef("entrance", u.entranceKey);
        }
        entranceKey = e.key;
      }
      const fields = validUnit(d, {
        buildingKey: building.key, entranceKey,
        type: u.type ?? ex?.type ?? "", label: (exByKey ? u.label : undefined) ?? ex?.label ?? u.label ?? "",
        floor: u.floor ?? (ex?.floor != null ? String(ex.floor) : null),
        usableArea: u.usableArea ?? ex?.usableArea ?? "", ownershipShare: u.ownershipShare ?? ex?.ownershipShare ?? "",
      }, ex?.key ?? null);
      const identical = Boolean(ex) && ex!.buildingKey === fields.buildingKey && same(ex!.entranceKey, fields.entranceKey) && ex!.type === fields.type && same(ex!.label, fields.label) && ex!.floor === fields.floor && sameDec(ex!.usableArea, fields.usableArea) && sameDec(ex!.ownershipShare, fields.ownershipShare);
      if (identical) {
        counts.units.unchanged++;
        if (u.key) fu.set(u.key, ex!.key);
        return;
      }
      if (lockedSkip()) {
        counts.units.skipped++;
        if (u.key) unresolved.add(u.key);
        return;
      }
      const next: DraftUnit = { key: ex?.key ?? newKey(), ...fields, source: "IMPORT" };
      if (ex) {
        d.units[d.units.indexOf(ex)] = next;
        counts.units.updated++;
      } else {
        d.units.push(next);
        counts.units.added++;
      }
      if (u.key) fu.set(u.key, next.key);
    }, u.key);
  }

  // ---- Zajednički dijelovi --------------------------------------------------------------------------------------
  const seenAssets = new Map<string, number>();
  for (const c of doc.commonAssets ?? []) {
    run("commonAssets", "commonAssets", c.row, () => {
      const exByKey = c.key ? d.commonAssets.find((x) => x.key === c.key) : undefined;
      const building = c.buildingKey ? resolveBuilding(c.buildingKey) : exByKey ? d.buildings.find((b) => b.key === exByKey.buildingKey) : undefined;
      if (!building) throw new Error(tf("onboarding.import.msg.fieldRequired", { polje: "buildingKey" }));
      const ex = exByKey ?? d.commonAssets.find((x) => x.buildingKey === building.key && x.kind === c.kind && lower(x.name) === lower(c.name));
      dupOf(seenAssets, `${building.key}|${c.kind ?? ex?.kind}|${lower(c.name ?? ex?.name)}`, c.row, "commonAsset");
      const fields = normalizeCommonAsset({
        buildingKey: building.key, kind: c.kind ?? ex?.kind ?? "", name: (exByKey ? c.name : undefined) ?? ex?.name ?? c.name ?? "", description: c.description ?? ex?.description,
      });
      assertBuildingExists(d, fields.buildingKey);
      if (ex && ex.buildingKey === fields.buildingKey && ex.kind === fields.kind && same(ex.name, fields.name) && same(ex.description, fields.description)) {
        counts.commonAssets.unchanged++;
        return;
      }
      if (lockedSkip()) {
        counts.commonAssets.skipped++;
        return;
      }
      const next = { key: ex?.key ?? newKey(), ...fields, source: "IMPORT" as const };
      if (ex) {
        d.commonAssets[d.commonAssets.indexOf(ex)] = next;
        counts.commonAssets.updated++;
      } else {
        d.commonAssets.push(next);
        counts.commonAssets.added++;
      }
    });
  }

  // ---- Lica ----------------------------------------------------------------------------------------------------------
  const emailIdx = new Map<string, DraftParty>(), idIdx = new Map<string, DraftParty>(), nameIdx = new Map<string, DraftParty>();
  const partyNameKey = (p: Pick<DraftParty, "kind" | "firstName" | "lastName" | "orgName">) =>
    p.kind === "ORGANIZATION" ? `o:${lower(p.orgName)}` : `p:${lower(p.firstName)}|${lower(p.lastName)}`;
  const indexParty = (p: DraftParty) => {
    if (p.email) emailIdx.set(lower(p.email), p);
    if (p.orgIdNumber) idIdx.set(lower(p.orgIdNumber), p);
    nameIdx.set(partyNameKey(p), p);
  };
  d.parties.forEach(indexParty);
  const seenParties = new Map<string, number>();
  for (const p of doc.parties ?? []) {
    run("parties", "parties", p.row, () => {
      if (p.key && fp.has(p.key)) throw new Error(tf("onboarding.import.msg.duplicateKey", { kljuc: p.key }));
      const kind = p.kind ?? (p.orgName && !p.firstName && !p.lastName ? "ORGANIZATION" : "PERSON");
      let ex: DraftParty | undefined = p.key ? d.parties.find((x) => x.key === p.key) : undefined;
      if (!ex && p.email) ex = emailIdx.get(lower(p.email));
      if (!ex && p.orgIdNumber) ex = idIdx.get(lower(p.orgIdNumber));
      if (!ex) {
        const byName = nameIdx.get(partyNameKey({ kind: kind === "ORGANIZATION" ? "ORGANIZATION" : "PERSON", firstName: p.firstName ?? "", lastName: p.lastName ?? "", orgName: p.orgName ?? "" }));
        // Isto ime bez e-adrese ili JIB-a nije dokaz da je to ista osoba: prepoznaje se, ali uz upozorenje.
        if (byName && (!p.email || !byName.email) && (!p.orgIdNumber || !byName.orgIdNumber)) {
          ex = byName;
          warn("parties", p.row, tf("onboarding.import.msg.partyByName", { ime: p.orgName || `${p.firstName ?? ""} ${p.lastName ?? ""}`.trim() }));
        }
      }
      if (ex && p.kind && ex.kind !== p.kind) throw new Error(tf("onboarding.import.msg.partyKind", { ime: p.orgName || `${p.firstName ?? ""} ${p.lastName ?? ""}`.trim() }));
      dupOf(seenParties, lower(p.email ?? ex?.email) || partyNameKey({ kind: ex?.kind ?? (kind === "ORGANIZATION" ? "ORGANIZATION" : "PERSON"), firstName: p.firstName ?? ex?.firstName ?? "", lastName: p.lastName ?? ex?.lastName ?? "", orgName: p.orgName ?? ex?.orgName ?? "" }), p.row, "party");
      const fields = normalizeParty({
        kind: ex?.kind ?? kind,
        firstName: p.firstName ?? ex?.firstName, lastName: p.lastName ?? ex?.lastName, orgName: p.orgName ?? ex?.orgName,
        orgIdNumber: p.orgIdNumber ?? ex?.orgIdNumber, email: p.email ?? ex?.email, phone: p.phone ?? ex?.phone,
      }, ex?.key ?? newKey());
      const unchanged = ex && (["kind", "firstName", "lastName", "orgName", "orgIdNumber", "email", "phone"] as const).every((f) => same(ex![f], fields[f]));
      if (unchanged) {
        counts.parties.unchanged++;
        if (p.key) fp.set(p.key, ex!.key);
        return;
      }
      const next: DraftParty = { ...fields, source: "IMPORT" };
      if (ex) {
        d.parties[d.parties.indexOf(ex)] = next;
        counts.parties.updated++;
      } else {
        d.parties.push(next);
        counts.parties.added++;
      }
      indexParty(next);
      if (p.key) fp.set(p.key, next.key);
    }, p.key);
  }

  // ---- Vlasnički udjeli → prijedlozi -------------------------------------------------------------------------------------
  const seenStakes = new Map<string, number>();
  const touchedUnits = new Set<string>();
  for (const s of doc.stakes ?? []) {
    run("stakeProposals", "stakeProposals", s.row, () => {
      const unit = resolveUnit(required(s.unitKey, "unitKey"));
      const partyKey = resolveParty(required(s.partyKey, "partyKey"));
      const share = assertSharePercent(parseMoneyInput(s.sharePercent ?? "") ?? "").toString();
      const validFrom = checkedDate(s.validFrom, t("onboarding.owners.validFrom"));
      dupOf(seenStakes, `${unit.key}|${partyKey}`, s.row, "stake");
      const stake = d.stakes.find((x) => x.unitKey === unit.key && x.partyKey === partyKey);
      if (stake) {
        // Upisan udio sa dokazom se nikad ne mijenja uvozom.
        if (sameDec(stake.sharePercent, share)) counts.stakeProposals.unchanged++;
        else {
          counts.stakeProposals.skipped++;
          warn("stakeProposals", s.row, tf("onboarding.import.msg.stakeExists", { oznaka: unit.label }));
        }
        return;
      }
      touchedUnits.add(unit.key);
      const ex = d.stakeProposals.find((x) => x.unitKey === unit.key && x.partyKey === partyKey);
      if (ex) {
        if (sameDec(ex.sharePercent, share) && ex.validFrom === validFrom) counts.stakeProposals.unchanged++;
        else {
          ex.sharePercent = share;
          ex.validFrom = validFrom;
          ex.source = "IMPORT";
          counts.stakeProposals.updated++;
        }
        return;
      }
      d.stakeProposals.push({ key: newKey(), unitKey: unit.key, partyKey, sharePercent: share, validFrom, source: "IMPORT" });
      counts.stakeProposals.added++;
    });
  }
  const proposals = counts.stakeProposals.added;
  // Zbir udjela (upisani + prijedlozi) se prijavljuje po posebnom dijelu koji je uvoz taknuo.
  const sumWarnings: string[] = [];
  for (const unitKey of touchedUnits) {
    if (d.disputedUnits.includes(unitKey)) continue;
    const shares = [...d.stakes.filter((x) => x.unitKey === unitKey), ...d.stakeProposals.filter((x) => x.unitKey === unitKey)].map((x) => x.sharePercent);
    const sum = sumShares(shares);
    if (classifyShareSum(sum, shares.length) !== "OK") {
      const label = d.units.find((u) => u.key === unitKey)?.label ?? "?";
      sumWarnings.push(tf("onboarding.import.msg.unitShareSum", { oznaka: label, zbir: sum.toFixed(2).replace(".", ",") }));
    }
  }
  for (const m of sumWarnings.slice(0, 20)) warn("stakeProposals", null, m);
  if (sumWarnings.length > 20) warn("stakeProposals", null, tf("onboarding.import.msg.moreWarnings", { broj: sumWarnings.length - 20 }));

  for (const dv of doc.disputedUnits ?? []) {
    run("stakeProposals", "stakeProposals", dv.row, () => {
      const unit = resolveUnit(dv.unitKey);
      if (d.disputedUnits.includes(unit.key)) counts.stakeProposals.unchanged++;
      else {
        d.disputedUnits.push(unit.key);
        counts.stakeProposals.added++;
      }
    });
  }

  // ---- Organi ---------------------------------------------------------------------------------------------------------------
  const acc = doc.offices?.accountant;
  if (acc) {
    run("offices", "offices", acc === "LATER" ? 1 : acc.row, () => {
      const cur = d.offices.accountant;
      if (acc === "LATER") {
        if (cur === "LATER") counts.offices.unchanged++;
        else if (cur === null) {
          d.offices.accountant = "LATER";
          counts.offices.added++;
        } else {
          counts.offices.skipped++;
          warn("offices", null, t("onboarding.import.msg.accountantExists"));
        }
        return;
      }
      const partyKey = resolveParty(required(acc.partyKey, "partyKey"));
      const validFrom = checkedDate(acc.validFrom, t("onboarding.offices.validFrom"));
      if (cur === null) {
        d.offices.accountant = { key: newKey(), partyKey, validFrom, loginEmail: null, passwordHash: null, source: "IMPORT" };
        counts.offices.added++;
      } else if (cur !== "LATER" && cur.partyKey === partyKey && cur.validFrom === validFrom) counts.offices.unchanged++;
      else {
        counts.offices.skipped++;
        warn("offices", null, t("onboarding.import.msg.accountantExists"));
      }
    });
  }
  for (const m of doc.offices?.board ?? []) {
    run("offices", "offices", m.row, () => {
      const partyKey = resolveParty(required(m.partyKey, "partyKey"));
      const validFrom = checkedDate(m.validFrom, t("onboarding.offices.validFrom"));
      const ex = d.offices.board.find((x) => x.partyKey === partyKey);
      if (!ex) {
        d.offices.board.push({ key: newKey(), partyKey, validFrom, source: "IMPORT" });
        counts.offices.added++;
      } else if (ex.validFrom === validFrom) counts.offices.unchanged++;
      else {
        ex.validFrom = validFrom;
        ex.source = "IMPORT";
        counts.offices.updated++;
      }
    });
  }

  if (lockedSkipped > 0) warn("file", null, tf("onboarding.import.msg.registerLocked", { broj: lockedSkipped }));

  const total = (k: "added" | "updated") => PLAN_SECTIONS.reduce((n, s) => n + counts[s][k], 0);
  return { next: d, report: { counts, errors, warnings, added: total("added"), updated: total("updated"), proposals } };
}
