// Čitanje fajla uvoza nacrta (JSON i CSV) u međuoblik: format/formatVersion, normalizacije, upozorenja, CSV zaglavlja i grupisanje.
import { describe, it, expect } from "vitest";
import { parseJsonImport } from "@/lib/onboarding/import/schema";
import { parseCsvImport } from "@/lib/onboarding/import/csvToDoc";
import { csvTemplate, IMPORT_FORMAT_ID, IMPORT_JSON_EXAMPLE } from "@/lib/onboarding/import/importFormat";
import { draftForAssistant } from "@/lib/onboarding/draftForAssistant";
import { parseDraftData } from "@/lib/onboarding/draft";

const json = (o: unknown) => JSON.stringify(o);
const doc = (extra: Record<string, unknown> = {}) => json({ format: IMPORT_FORMAT_ID, formatVersion: 1, ...extra });
const csv = (s: string) => parseCsvImport(new TextEncoder().encode(s));

describe("parseJsonImport", () => {
  it("requires format and formatVersion (and rejects non-JSON and other versions)", () => {
    expect(parseJsonImport("nije json").errors[0].message).toMatch(/JSON/);
    expect(parseJsonImport(json({ formatVersion: 1 })).errors[0].message).toMatch(/format/);
    expect(parseJsonImport(json({ format: IMPORT_FORMAT_ID })).errors[0].message).toMatch(/verzij/i);
    expect(parseJsonImport(json({ format: IMPORT_FORMAT_ID, formatVersion: 2 })).errors[0].message).toMatch(/2/);
    // `version` je verzija NACRTA, ne formata: ne smije zamijeniti formatVersion.
    expect(parseJsonImport(json({ format: IMPORT_FORMAT_ID, version: 1 })).doc).toBeNull();
    expect(parseJsonImport(doc()).errors).toEqual([]);
  });

  it("accepts the shipped example without errors or warnings", () => {
    const r = parseJsonImport(json(IMPORT_JSON_EXAMPLE));
    expect(r.errors).toEqual([]);
    expect(r.warnings).toEqual([]);
    expect(r.doc!.units).toHaveLength(2);
  });

  it("normalizes numbers to text, dates to ISO and unit/account/kind names to codes", () => {
    const r = parseJsonImport(doc({
      zev: { foundingDate: "01.03.2024." , registrationDate: "2024-04-15" },
      accounts: [{ type: "bankovni račun", name: "T", number: 5620000000000000, openingBalance: "1.234,56", openingDate: "1.1.2025" }],
      units: [{ buildingKey: "b", type: "garažno mjesto", label: "G1", floor: "P", usableArea: 12.5, ownershipShare: "0,5" }],
      commonAssets: [{ buildingKey: "b", kind: "Oprema", name: "Lift" }],
      parties: [{ key: "p", kind: "pravno lice", orgName: "X d.o.o." }],
    }));
    expect(r.errors).toEqual([]);
    expect(r.doc!.zev).toMatchObject({ foundingDate: "2024-03-01", registrationDate: "2024-04-15" });
    expect(r.doc!.accounts![0]).toMatchObject({ type: "BANK", number: "5620000000000000", openingBalance: "1.234,56", openingDate: "2025-01-01" });
    expect(r.doc!.units![0]).toMatchObject({ type: "GARAGE_SPACE", floor: "0", usableArea: "12.5", ownershipShare: "0,5" });
    expect(r.doc!.commonAssets![0].kind).toBe("EQUIPMENT");
    expect(r.doc!.parties![0].kind).toBe("ORGANIZATION");
  });

  it("warns about unknown fields with their path and never reads accountant login data", () => {
    const r = parseJsonImport(doc({
      units: [{ buildingKey: "b", label: "1", povrsina: 5 }],
      offices: { accountant: { partyKey: "p", validFrom: "2026-01-01", loginEmail: "r@x.test", password: "Tajna123" } },
      nepoznato: 1,
    }));
    expect(r.warnings.map((w) => w.field)).toEqual(expect.arrayContaining(["units[0].povrsina", "nepoznato"]));
    expect(r.warnings.some((w) => /Organi i nalozi/.test(w.message))).toBe(true);
    expect(JSON.stringify(r.doc)).not.toContain("Tajna123");
    expect(JSON.stringify(r.doc)).not.toContain("r@x.test");
  });

  it("imports get_draft output plus format/formatVersion unchanged: version, hasPassword, proof and friends are ignored silently", () => {
    const data = parseDraftData({
      zev: { legalName: "ZEV", jib: "4200000000001" },
      accounts: [{ key: "a1", type: "BANK", name: "T", number: "5620000000000000", openingBalance: "0.00", openingDate: "2026-01-01" }],
      buildings: [{ key: "b1", name: "A", address: "Ulica 1", entrances: [{ key: "e1", name: "A" }] }],
      units: [{ key: "u1", buildingKey: "b1", type: "APARTMENT", label: "1", usableArea: "50.00", ownershipShare: "10" }],
      parties: [{ key: "p1", kind: "PERSON", firstName: "M", lastName: "M", email: "m@x.test" }],
      stakes: [{ key: "s1", unitKey: "u1", partyKey: "p1", sharePercent: "100", validFrom: "2026-01-01", proofFileId: "f1", proofFilename: "list.pdf" }],
      offices: { accountant: { key: "o1", partyKey: "p1", validFrom: "2026-02-01", loginEmail: "r@x.test", passwordHash: "HASH" }, board: [] },
    });
    const out = draftForAssistant(data, [{ id: "f1", filename: "list.pdf", mime: "application/pdf", size: 1 }]);
    const r = parseJsonImport(json({ format: IMPORT_FORMAT_ID, formatVersion: 1, draftId: "x", label: "L", tier: "FULL", version: 7, access: "OWNER", ...out }));
    expect(r.errors).toEqual([]);
    // Jedino upozorenje: nalog računovođe se ne uvozi.
    expect(r.warnings.map((w) => w.message)).toEqual([expect.stringMatching(/Organi i nalozi/)]);
    expect(r.doc!.stakes).toHaveLength(1);
  });

  it("reports wrong shapes with section and row", () => {
    const r = parseJsonImport(doc({ units: "x", accounts: [1, { name: { a: 1 } }] }));
    expect(r.errors.map((e) => `${e.section}:${e.row}`)).toEqual(expect.arrayContaining(["units:null", "accounts:1", "accounts:2"]));
  });

  it("enforces item limits", () => {
    const units = Array.from({ length: 2001 }, (_, i) => ({ buildingKey: "b", label: String(i) }));
    expect(parseJsonImport(doc({ units })).errors[0].message).toMatch(/2000/);
  });
});

describe("parseCsvImport", () => {
  it("reads the shipped template (semicolon, decimal comma, diacritics) and groups co-owners under one unit", () => {
    const r = parseCsvImport(new TextEncoder().encode(csvTemplate()));
    expect(r.errors).toEqual([]);
    expect(r.doc!.buildings).toHaveLength(1);
    expect(r.doc!.buildings![0]).toMatchObject({ name: "Zgrada A", address: "Ulica Primjera 1, Banja Luka" });
    expect(r.doc!.units!.map((u) => u.label)).toEqual(["Stan 1", "Stan 2", "Lokal 1"]);
    expect(r.doc!.units![0]).toMatchObject({ type: "APARTMENT", usableArea: "62,40", ownershipShare: "1,25", floor: "1" });
    expect(r.doc!.units![2].type).toBe("BUSINESS");
    expect(r.doc!.parties!.map((p) => p.lastName ?? p.orgName)).toEqual(["Marković", "Đurić", "Đurić", "Primjer d.o.o."]);
    expect(r.doc!.parties![3].kind).toBe("ORGANIZATION");
    expect(r.doc!.stakes).toHaveLength(4);
    expect(r.doc!.stakes![0].validFrom).toBe("2020-01-01");
    expect(r.doc!.stakes![1].unitKey).toBe(r.doc!.stakes![2].unitKey); // suvlasnici iste jedinice
  });

  it("matches header aliases, case and diacritics in any order, with a comma delimiter and quoted decimals", () => {
    const r = csv('Udio u troškovima (%),Površina (m²),Vrsta,Oznaka,Building,Adresa\n"1,5","62,4",Garaža,G1,"Zgrada, A",Ulica 1\n');
    expect(r.errors).toEqual([]);
    expect(r.doc!.units![0]).toMatchObject({ label: "G1", type: "GARAGE", usableArea: "62,4", ownershipShare: "1,5" });
    expect(r.doc!.buildings![0]).toMatchObject({ name: "Zgrada, A", address: "Ulica 1" });
  });

  it("warns about unknown columns and Windows-1250 files, and fails on missing required columns", () => {
    const r = csv("zgrada;oznaka;vrsta;povrsina;udio_jedinice;boja\nA;1;stan;50;1;plava\n");
    expect(r.warnings.map((w) => w.field)).toContain("boja");
    expect(csv("zgrada;oznaka\nA;1\n").errors[0].message).toMatch(/vrsta/);
    const bytes = new Uint8Array([...new TextEncoder().encode("zgrada;oznaka;vrsta;povrsina;udio_jedinice\nZgrada;"), 0x9a, ...new TextEncoder().encode(";stan;50;1\n")]);
    expect(parseCsvImport(bytes).warnings.some((w) => /Windows-1250/.test(w.message))).toBe(true);
  });

  it("reports errors with physical line numbers (header = 1), including after multi-line cells", () => {
    const r = csv('zgrada;oznaka;vrsta;povrsina;udio_jedinice\nA;1;stan;50;1\n"A\nB";2;stan;;1\nA;3;stan;40;1\n');
    // Red 3 počinje u ćeliji koja se proteže na red 4; nedostaje površina.
    expect(r.errors).toEqual([expect.objectContaining({ row: 3, field: "povrsina_m2" })]);
  });

  it("flags two rows of the same unit with different unit data, naming the first row", () => {
    const r = csv("zgrada;oznaka;vrsta;povrsina;udio_jedinice;ime;prezime;udio_vlasnika;vlasnik_od\nA;1;stan;50;1;Ana;Anić;50;01.01.2020.\nA;1;stan;55;1;Ivo;Ivić;50;01.01.2020.\n");
    expect(r.errors).toHaveLength(1);
    expect(r.errors[0]).toMatchObject({ row: 3, field: "oznaka" });
    expect(r.errors[0].message).toMatch(/2/);
  });

  it("requires share and date when an owner is present, and treats an owner-less row as a unit without owners", () => {
    const r = csv("zgrada;oznaka;vrsta;povrsina;udio_jedinice;ime;prezime;udio_vlasnika;vlasnik_od\nA;1;stan;50;1;Ana;Anić;;\nA;2;stan;50;1;;;;\n");
    expect(r.errors.map((e) => e.field)).toContain("udio_vlasnika");
    expect(r.doc!.units).toHaveLength(2);
    expect(r.doc!.stakes ?? []).toHaveLength(0);
  });

  it("names a year-only unit floor 'P' as ground floor and merges the same owner across units by e-mail", () => {
    const r = csv("zgrada;oznaka;vrsta;povrsina;udio_jedinice;sprat;ime;prezime;email;udio_vlasnika;vlasnik_od\nA;1;stan;50;1;P;Ana;Anić;ANA@x.test;100;2020-01-01\nA;2;stan;50;1;2;Ana;Anić;ana@x.test;100;2020-01-01\n");
    expect(r.doc!.units![0].floor).toBe("0");
    expect(r.doc!.parties).toHaveLength(1);
    expect(r.doc!.stakes).toHaveLength(2);
  });
});
