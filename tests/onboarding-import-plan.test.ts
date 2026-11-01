// Planer uvoza (planDraftImport): spajanje bez brisanja, ista pravila kao čarobnjak, zaključan registar, prijedlozi udjela,
// atomičnost (greške) i kružni test izvoz → uvoz.
import { describe, it, expect } from "vitest";
import { parseDraftData, type OnboardingDraftData } from "@/lib/onboarding/draft";
import { planDraftImport } from "@/lib/onboarding/import/plan";
import { parseJsonImport, type ImportDoc } from "@/lib/onboarding/import/schema";
import { parseCsvImport } from "@/lib/onboarding/import/csvToDoc";
import { draftToImportDoc } from "@/lib/onboarding/import/exportDoc";
import { IMPORT_FORMAT_ID } from "@/lib/onboarding/import/importFormat";

let n = 0;
const newKey = () => `K${++n}`;
const jsonDoc = (extra: Record<string, unknown>): ImportDoc => {
  const r = parseJsonImport(JSON.stringify({ format: IMPORT_FORMAT_ID, formatVersion: 1, ...extra }));
  if (!r.doc || r.errors.length) throw new Error(`neispravan test fajl: ${JSON.stringify(r.errors)}`);
  return r.doc;
};
const plan = (d: OnboardingDraftData, extra: Record<string, unknown>) => planDraftImport(d, jsonDoc(extra), { newKey });
const msgs = (r: ReturnType<typeof plan>) => r.report.errors.map((e) => `${e.section}:${e.row}:${e.message}`);

const empty = () => parseDraftData({ zev: { legalName: "Radni naziv" }, president: { firstName: "Dragana", lastName: "Savić" } });
const base = () =>
  parseDraftData({
    zev: { legalName: "ZEV" },
    accounts: [{ key: "a1", type: "BANK", name: "Tekući", bankName: "B", number: "0060000123456758", openingBalance: "100.00", openingDate: "2026-01-01" }],
    buildings: [{ key: "b1", name: "Zgrada A", address: "Ulica 1", entrances: [{ key: "e1", name: "A" }] }],
    units: [{ key: "u1", buildingKey: "b1", entranceKey: "e1", type: "APARTMENT", label: "Stan 1", usableArea: "50.00", ownershipShare: "10" }],
    commonAssets: [{ key: "c1", buildingKey: "b1", kind: "AREA", name: "Stubište" }],
    parties: [{ key: "p1", kind: "PERSON", firstName: "Marko", lastName: "Marković", email: "marko@x.test" }],
  });

describe("planDraftImport — merge", () => {
  it("adds new items with fresh keys, never stores file keys, and marks them as imported", () => {
    const r = plan(empty(), {
      buildings: [{ key: "zb", name: "Zgrada A", address: "Ulica 1", entrances: [{ key: "ze", name: "A" }] }],
      units: [{ key: "zu", buildingKey: "zb", entranceKey: "ze", type: "stan", label: "Stan 1", floor: 1, usableArea: "62,40", ownershipShare: "1,5" }],
    });
    expect(msgs(r)).toEqual([]);
    const b = r.next.buildings[0];
    expect(b).toMatchObject({ name: "Zgrada A", source: "IMPORT" });
    expect(b.key).toMatch(/^K\d+$/);
    expect(b.key).not.toBe("zb");
    expect(r.next.units[0]).toMatchObject({ buildingKey: b.key, entranceKey: b.entrances[0].key, usableArea: "62.40", ownershipShare: "1.5", floor: 1, type: "APARTMENT", source: "IMPORT" });
    expect(r.report.counts.units.added).toBe(1);
    expect(r.report.added).toBe(3);
  });

  it("matches existing items by key and by natural identity, updates only provided non-empty fields, and never deletes", () => {
    const d = base();
    const r = plan(d, {
      accounts: [{ number: "0060000123456758", openingBalance: "250,50" }],
      buildings: [{ name: "zgrada a", cadastralRef: "k.č. 1" }],
      units: [{ key: "u1", usableArea: "55" }, { buildingKey: "zgrada a", label: "STAN 2", type: "stan", usableArea: "30", ownershipShare: "5" }],
      parties: [{ email: "MARKO@x.test", phone: "065" }],
    });
    expect(msgs(r)).toEqual([]);
    expect(r.next.accounts).toHaveLength(1);
    expect(r.next.accounts[0]).toMatchObject({ key: "a1", openingBalance: "250.50", name: "Tekući", openingDate: "2026-01-01", source: "IMPORT" });
    expect(r.next.buildings[0]).toMatchObject({ key: "b1", name: "Zgrada A", address: "Ulica 1", cadastralRef: "k.č. 1" });
    expect(r.next.buildings[0].entrances).toHaveLength(1);
    expect(r.next.units).toHaveLength(2);
    expect(r.next.units[0]).toMatchObject({ key: "u1", usableArea: "55", ownershipShare: "10", label: "Stan 1", entranceKey: "e1" });
    expect(r.next.parties).toHaveLength(1);
    expect(r.next.parties[0]).toMatchObject({ key: "p1", phone: "065", firstName: "Marko" });
    expect(r.next.commonAssets).toEqual(d.commonAssets);
    expect(r.report.counts.accounts.updated).toBe(1);
    expect(r.report.counts.units).toMatchObject({ added: 1, updated: 1 });
  });

  it("counts identical items as unchanged and does not touch them (including their source)", () => {
    const d = base();
    d.units[0].source = "MCP_OWNER";
    const r = plan(d, { units: [{ key: "u1", buildingKey: "b1", type: "APARTMENT", label: "Stan 1", usableArea: "50", ownershipShare: "10,00", entranceKey: "A" }] });
    expect(msgs(r)).toEqual([]);
    expect(r.report.counts.units).toMatchObject({ added: 0, updated: 0, unchanged: 1 });
    expect(r.next.units[0].source).toBe("MCP_OWNER");
    expect(r.report.added + r.report.updated).toBe(0);
  });

  it("never sets registerConfirmedAt or acks and ignores unsupported top-level data", () => {
    const r = plan(empty(), { registerConfirmedAt: "2026-01-01T00:00:00Z", noAccounts: true, draftId: "x", version: 3 });
    expect(r.next.registerConfirmedAt).toBeNull();
    expect(r.next.acks.noAccounts).toBe(false);
  });

  it("recognizes a person without e-mail by name and warns, but never merges different e-mails", () => {
    const d = base();
    const byName = plan(d, { parties: [{ kind: "PERSON", firstName: "marko", lastName: "marković", phone: "066" }] });
    expect(byName.next.parties).toHaveLength(1);
    expect(byName.report.warnings.some((w) => /samo po imenu/.test(w.message))).toBe(true);
    const other = plan(d, { parties: [{ kind: "PERSON", firstName: "Marko", lastName: "Marković", email: "drugi@x.test" }] });
    expect(other.next.parties).toHaveLength(2);
  });
});

describe("planDraftImport — same rules as the wizard", () => {
  it("rejects what the wizard rejects, with section and row", () => {
    const d = base();
    const r = plan(d, {
      accounts: [{ type: "BANK", name: "Loš", number: "123", openingDate: "2026-01-01" }, { type: "BANK", name: "Bez broja", openingDate: "2026-01-01" }],
      buildings: [{ name: "", address: "x" }],
      units: [
        { buildingKey: "b1", type: "stan", label: "Nula", usableArea: "0", ownershipShare: "5" },
        { buildingKey: "b1", type: "stan", label: "Preko", usableArea: "50", ownershipShare: "101" },
        { buildingKey: "b1", type: "kuća", label: "Vrsta", usableArea: "50", ownershipShare: "5" },
      ],
      parties: [{ kind: "PERSON", firstName: "Samo" }, { kind: "PERSON", firstName: "A", lastName: "B", email: "nije-mail" }],
    });
    const m = msgs(r);
    expect(m.filter((x) => x.startsWith("accounts:1")).length).toBe(1);
    expect(m.some((x) => x.startsWith("accounts:2:"))).toBe(true);
    expect(m).toContain("buildings:1:Naziv zgrade je obavezan.");
    expect(m.some((x) => x.startsWith("units:1:") && /veći od nule/.test(x))).toBe(true);
    expect(m.some((x) => x.startsWith("units:2:") && /najviše 100/.test(x))).toBe(true);
    expect(m).toContain("units:3:Izaberite vrstu posebnog dijela.");
    expect(m).toContain("parties:1:Za fizičko lice upišite ime i prezime.");
    expect(m).toContain("parties:2:Unesite ispravnu e-mail adresu.");
  });

  it("rejects an entrance from another building and an unknown reference", () => {
    const d = base();
    d.buildings.push({ key: "b2", name: "Zgrada B", address: "Ulica 2", cadastralRef: null, yearBuilt: null, floorsCount: null, entrances: [{ key: "e2", name: "B" }] });
    const r = plan(d, {
      units: [
        { buildingKey: "b1", entranceKey: "e2", type: "stan", label: "S", usableArea: "5", ownershipShare: "1" },
        { buildingKey: "Nepostojeća", type: "stan", label: "T", usableArea: "5", ownershipShare: "1" },
      ],
    });
    expect(msgs(r)[0]).toMatch(/^units:1:.*Ulaz „e2” nije pronađen/);
    expect(msgs(r)[1]).toMatch(/^units:2:Zgrada „Nepostojeća” nije pronađen/);
  });

  it("reports an unresolved cascade only once (units of a failed building are skipped silently)", () => {
    const r = plan(empty(), {
      buildings: [{ key: "zb", name: "", address: "x" }],
      units: [{ buildingKey: "zb", type: "stan", label: "1", usableArea: "5", ownershipShare: "1" }],
    });
    expect(r.report.errors).toHaveLength(1);
    expect(r.report.counts.units.skipped).toBe(1);
  });

  it("reports duplicates inside the file with both rows", () => {
    const r = plan(empty(), {
      buildings: [{ key: "zb", name: "A", address: "x" }],
      units: [
        { buildingKey: "zb", type: "stan", label: "1", usableArea: "5", ownershipShare: "1" },
        { buildingKey: "zb", type: "stan", label: "1", usableArea: "6", ownershipShare: "1" },
      ],
    });
    expect(r.report.errors).toHaveLength(1);
    expect(r.report.errors[0]).toMatchObject({ section: "units", row: 2 });
    expect(r.report.errors[0].message).toMatch(/redu 1/);
  });

  it("validates dates against the calendar", () => {
    const r = plan(base(), { accounts: [{ key: "a1", openingDate: "31.02.2026." }] });
    expect(msgs(r)[0]).toMatch(/datum ne postoji/);
  });
});

describe("planDraftImport — confirmed register", () => {
  const confirmed = () => ({ ...base(), registerConfirmedAt: "2026-02-01T00:00:00.000Z" });

  it("skips changes to buildings, entrances, units and common assets with one warning, but counts identical data as unchanged", () => {
    const r = plan(confirmed(), {
      buildings: [{ name: "Zgrada A", address: "Ulica 1", entrances: [{ name: "A" }, { name: "Novi" }] }, { name: "Zgrada Nova", address: "x" }],
      units: [
        { key: "u1", usableArea: "50" },
        { buildingKey: "b1", type: "stan", label: "Novi", usableArea: "20", ownershipShare: "2" },
      ],
      commonAssets: [{ buildingKey: "b1", kind: "SYSTEM", name: "Lift" }],
    });
    expect(msgs(r)).toEqual([]);
    expect(r.next.buildings).toHaveLength(1);
    expect(r.next.units).toHaveLength(1);
    expect(r.next.units[0].usableArea).toBe("50.00");
    expect(r.report.counts.units).toMatchObject({ added: 0, updated: 0, unchanged: 1, skipped: 1 });
    expect(r.report.counts.buildings.skipped).toBe(2);
    // Izmjena postojećeg posebnog dijela je takođe preskočena.
    expect(plan(confirmed(), { units: [{ key: "u1", usableArea: "99" }] }).report.counts.units.skipped).toBe(1);
    expect(r.report.warnings.filter((w) => /Registar je potvrđen/.test(w.message))).toHaveLength(1);
    expect(r.report.added + r.report.updated).toBe(0);
  });

  it("still imports parties, proposals and offices, but an owner row for an unknown unit is an error", () => {
    const r = plan(confirmed(), {
      parties: [{ key: "zp", kind: "PERSON", firstName: "Ana", lastName: "Anić" }],
      stakes: [
        { unitKey: "u1", partyKey: "zp", sharePercent: "100", validFrom: "2020-01-01" },
        { unitKey: "Zgrada A/Stan 9", partyKey: "zp", sharePercent: "100", validFrom: "2020-01-01" },
      ],
    });
    expect(r.next.stakeProposals).toHaveLength(1);
    expect(msgs(r)).toEqual([expect.stringMatching(/^stakeProposals:2:Posebni dio/)]);
  });
});

describe("planDraftImport — owners become proposals", () => {
  it("creates proposals (not stakes) and warns when a unit's stakes+proposals do not add up to 100 %", () => {
    const r = plan(base(), {
      parties: [{ key: "zp", kind: "PERSON", firstName: "Ana", lastName: "Anić" }],
      stakes: [{ unitKey: "Zgrada A/Stan 1", partyKey: "zp", sharePercent: "60", validFrom: "01.01.2020." }],
    });
    expect(msgs(r)).toEqual([]);
    expect(r.next.stakes).toHaveLength(0);
    expect(r.next.stakeProposals).toHaveLength(1);
    expect(r.next.stakeProposals[0]).toMatchObject({ unitKey: "u1", sharePercent: "60", validFrom: "2020-01-01", source: "IMPORT" });
    expect(r.report.proposals).toBe(1);
    expect(r.report.warnings.some((w) => /Stan 1.*60,00/.test(w.message))).toBe(true);
  });

  it("leaves existing stakes (with proof) untouched: same share is unchanged, different share is skipped with a warning", () => {
    const d = base();
    d.stakes.push({ key: "s1", unitKey: "u1", partyKey: "p1", sharePercent: "100", validFrom: "2019-01-01", proofFileId: "f1", proofFilename: "list.pdf" });
    const same = plan(d, { stakes: [{ unitKey: "u1", partyKey: "p1", sharePercent: "100", validFrom: "2020-01-01" }] });
    expect(same.report.counts.stakeProposals).toMatchObject({ unchanged: 1, added: 0, skipped: 0 });
    const diff = plan(d, { stakes: [{ unitKey: "u1", partyKey: "p1", sharePercent: "50", validFrom: "2020-01-01" }] });
    expect(diff.report.counts.stakeProposals.skipped).toBe(1);
    expect(diff.report.warnings).toHaveLength(1);
    expect(diff.next.stakes).toEqual(d.stakes);
    expect(diff.next.stakeProposals).toHaveLength(0);
  });

  it("updates an existing proposal, accepts the president and validates the share", () => {
    const d = base();
    d.stakeProposals.push({ key: "sp1", unitKey: "u1", partyKey: "president", sharePercent: "50", validFrom: "2020-01-01" });
    const r = plan(d, { stakes: [{ unitKey: "u1", partyKey: "president", sharePercent: "100", validFrom: "2020-01-01" }, { unitKey: "u1", partyKey: "p1", sharePercent: "0", validFrom: "2020-01-01" }] });
    expect(r.next.stakeProposals).toHaveLength(1);
    expect(r.next.stakeProposals[0]).toMatchObject({ key: "sp1", sharePercent: "100" });
    expect(msgs(r)).toEqual([expect.stringMatching(/^stakeProposals:2:Udio mora biti/)]);
  });

  it("marks disputed units", () => {
    const r = plan(base(), { disputedUnits: ["Zgrada A/Stan 1"] });
    expect(r.next.disputedUnits).toEqual(["u1"]);
  });
});

describe("planDraftImport — offices and accounts", () => {
  it("sets the accountant only when none is decided and never imports login data", () => {
    const d = base();
    const set = plan(d, { offices: { accountant: { partyKey: "p1", validFrom: "01.02.2026.", loginEmail: "r@x.test", password: "Tajna123" }, board: [{ partyKey: "p1", validFrom: "2026-02-01" }] } });
    expect(set.next.offices.accountant).toMatchObject({ partyKey: "p1", validFrom: "2026-02-01", loginEmail: null, passwordHash: null });
    expect(set.next.offices.board).toHaveLength(1);
    d.offices.accountant = "LATER";
    const kept = plan(d, { offices: { accountant: { partyKey: "p1", validFrom: "2026-02-01" } } });
    expect(kept.next.offices.accountant).toBe("LATER");
    expect(kept.report.warnings.some((w) => /Računovođa/.test(w.message))).toBe(true);
  });

  it("clears the 'no accounts' acknowledgement when an account is added", () => {
    const d = empty();
    d.acks.noAccounts = true;
    const r = plan(d, { accounts: [{ type: "CASH", name: "Blagajna", openingDate: "2026-01-01" }] });
    expect(r.next.acks.noAccounts).toBe(false);
    expect(r.next.accounts[0]).toMatchObject({ type: "CASH", number: null, openingBalance: "0" });
  });
});

describe("planDraftImport — CSV", () => {
  it("imports a CSV through the same planner, with owners as proposals and a second import being a no-op", () => {
    const text = "zgrada;adresa_zgrade;oznaka;vrsta;povrsina_m2;udio_u_troskovima;ime;prezime;email;udio_vlasnika;vlasnik_od\nZgrada Š;Ulica Đ 1;Stan 1;stan;62,40;1,25;Šćepan;Đurić;sd@x.test;100;01.01.2020.\n";
    const parsed = parseCsvImport(new TextEncoder().encode(text));
    expect(parsed.errors).toEqual([]);
    const first = planDraftImport(empty(), parsed.doc!, { newKey });
    expect(first.report.errors).toEqual([]);
    expect(first.next.units[0]).toMatchObject({ label: "Stan 1", usableArea: "62.40", ownershipShare: "1.25" });
    expect(first.next.parties[0]).toMatchObject({ firstName: "Šćepan", lastName: "Đurić", email: "sd@x.test" });
    expect(first.next.stakeProposals).toHaveLength(1);
    const again = planDraftImport(first.next, parseCsvImport(new TextEncoder().encode(text)).doc!, { newKey });
    expect(again.report.added + again.report.updated).toBe(0);
    expect(again.report.counts.units.unchanged).toBe(1);
  });
});

describe("planDraftImport — limits and round trip", () => {
  it("handles a large file in a single pass", () => {
    const units = Array.from({ length: 2000 }, (_, i) => ({ key: `u${i}`, buildingKey: "b", type: "stan", label: `S${i}`, usableArea: "40", ownershipShare: "0,05" }));
    const parties = Array.from({ length: 2000 }, (_, i) => ({ key: `p${i}`, kind: "PERSON", firstName: "A", lastName: `P${i}`, email: `p${i}@x.test` }));
    const stakes = units.map((u, i) => ({ unitKey: u.key, partyKey: `p${i}`, sharePercent: "100", validFrom: "2020-01-01" }));
    const t0 = Date.now();
    const r = plan(empty(), { buildings: [{ key: "b", name: "A", address: "x" }], units, parties, stakes });
    expect(r.report.errors).toEqual([]);
    expect(r.next.units).toHaveLength(2000);
    expect(r.next.stakeProposals).toHaveLength(2000);
    expect(Date.now() - t0).toBeLessThan(5000);
  });

  const strip = (d: OnboardingDraftData) => {
    // Poredi se sadržaj bez ključeva, `source` i zaključavanja registra.
    const clean = (v: unknown): unknown => {
      if (Array.isArray(v)) return v.map(clean);
      if (v && typeof v === "object") {
        return Object.fromEntries(Object.entries(v).filter(([k]) => !["key", "source", "proofFileId", "proofFilename", "registerConfirmedAt", "buildingKey", "entranceKey", "unitKey", "partyKey"].includes(k)).map(([k, x]) => [k, clean(x)]));
      }
      return v;
    };
    return clean(d);
  };

  function rich(): OnboardingDraftData {
    const d = base();
    d.zev = { ...d.zev, jib: "4200000000001", city: "Banja Luka", foundingDate: "2024-03-01" };
    d.president = { firstName: "Dragana", lastName: "Savić", phone: "065" };
    d.buildings[0].yearBuilt = 1985;
    d.parties.push({ key: "p2", kind: "ORGANIZATION", firstName: "", lastName: "", orgName: "Primjer d.o.o.", orgIdNumber: "44", email: "", phone: "" });
    d.stakes.push({ key: "s1", unitKey: "u1", partyKey: "p1", sharePercent: "60", validFrom: "2020-01-01", proofFileId: "f1", proofFilename: "list.pdf" });
    d.stakeProposals.push({ key: "sp1", unitKey: "u1", partyKey: "p2", sharePercent: "40", validFrom: "2021-01-01" });
    d.disputedUnits = [];
    d.offices = { accountant: { key: "o1", partyKey: "p1", validFrom: "2026-02-01", loginEmail: "r@x.test", passwordHash: "H" }, board: [{ key: "o2", partyKey: "p2", validFrom: "2026-02-01" }] };
    return d;
  }

  it("round trip: the export imported into an empty draft gives the same data, and into the same draft gives zero changes", () => {
    const d = rich();
    const exported = JSON.stringify(draftToImportDoc(d));
    expect(exported).not.toContain("proofFileId");
    expect(exported).not.toContain("passwordHash");
    expect(exported).not.toContain("r@x.test");
    const parsed = parseJsonImport(exported);
    expect(parsed.errors).toEqual([]);
    expect(parsed.warnings).toEqual([]);

    const fresh = planDraftImport(empty(), parsed.doc!, { newKey });
    expect(fresh.report.errors).toEqual([]);
    const expected = strip({ ...d, stakeProposals: [], stakes: [], offices: { accountant: d.offices.accountant, board: d.offices.board } });
    const got = strip(fresh.next) as Record<string, unknown>;
    const exp = expected as Record<string, unknown>;
    for (const k of ["zev", "president", "accounts", "buildings", "units", "commonAssets", "parties", "disputedUnits"]) expect(got[k]).toEqual(exp[k]);
    // Udjeli (sa dokazom i bez) postaju prijedlozi; prijedlozi su ista lica i iznosi.
    expect((got.stakeProposals as unknown[]).length).toBe(2);
    expect(fresh.next.offices.board).toHaveLength(1);
    expect(fresh.next.registerConfirmedAt).toBeNull();

    const same = planDraftImport(d, parseJsonImport(exported).doc!, { newKey });
    expect(same.report.errors).toEqual([]);
    expect(same.report.added + same.report.updated).toBe(0);
    expect(same.report.warnings).toEqual([]);
  });
});
