// Opis formata uvoza nacrta novog ZEV-a (Plans/mcp-onboarding-asistent-plan.md §8): JEDAN izvor za stranicu uvoza
// (uputstvo za asistenta, obrazac, primjer), rute za preuzimanje i MCP alat `get_import_format`. Čisto, bez baze.
// Format JSON-a je isti oblik kao izlaz alata get_draft (uz `format` i `formatVersion`), pa se izvezeni nacrt može
// ponovo uvesti.

export const IMPORT_FORMAT_ID = "zev-upravnik/onboarding-draft";
export const IMPORT_FORMAT_VERSION = 1;
/** Najveća veličina fajla za uvoz (prije čitanja sadržaja). */
export const IMPORT_MAX_BYTES = 1024 * 1024;
export const IMPORT_LIMITS = { units: 2000, parties: 5000, stakes: 5000, items: 10000 } as const;

export type CsvColumn = { name: string; aliases: string[]; required?: boolean };

/** Kolone CSV obrasca „Posebni dijelovi i vlasnici”. Redoslijed je redoslijed obrasca; pri čitanju je redoslijed proizvoljan. */
export const CSV_COLUMNS: CsvColumn[] = [
  { name: "zgrada", aliases: ["building"], required: true },
  { name: "adresa_zgrade", aliases: ["building_address", "adresa"] },
  { name: "ulaz", aliases: ["entrance"] },
  { name: "oznaka", aliases: ["label", "unit", "posebni_dio"], required: true },
  { name: "vrsta", aliases: ["type"], required: true },
  { name: "sprat", aliases: ["floor"] },
  { name: "povrsina_m2", aliases: ["povrsina", "usable_area", "area"], required: true },
  { name: "udio_u_troskovima", aliases: ["udio_jedinice", "ownership_share"], required: true },
  { name: "vlasnik_vrsta", aliases: ["owner_kind"] },
  { name: "ime", aliases: ["first_name"] },
  { name: "prezime", aliases: ["last_name"] },
  { name: "naziv_pravnog_lica", aliases: ["org_name"] },
  { name: "jib_jmbg", aliases: ["org_id_number", "id_number"] },
  { name: "email", aliases: ["e_mail"] },
  { name: "telefon", aliases: ["phone"] },
  { name: "udio_vlasnika", aliases: ["owner_share", "share"] },
  { name: "vlasnik_od", aliases: ["valid_from", "since"] },
];

/** Naziv kolone kako ga CSV čitač poredi: mala slova, bez dijakritika, razmak/crta/tačka/zagrade u „_”. */
export function normalizeHeader(raw: string): string {
  return raw
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/đ/g, "d")
    .replace(/²/g, "2")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

const CSV_EXAMPLE_ROWS = [
  ["Zgrada A", "Ulica Primjera 1, Banja Luka", "A", "Stan 1", "stan", "1", "62,40", "1,25", "fizičko", "Marko", "Marković", "", "", "marko@primjer.ba", "065 123 456", "100", "01.01.2020."],
  ["Zgrada A", "", "A", "Stan 2", "stan", "1", "48,00", "0,96", "fizičko", "Jelena", "Đurić", "", "", "jelena@primjer.ba", "", "50", "15.03.2018."],
  ["Zgrada A", "", "A", "Stan 2", "stan", "1", "48,00", "0,96", "fizičko", "Nikola", "Đurić", "", "", "", "", "50", "15.03.2018."],
  ["Zgrada A", "", "", "Lokal 1", "poslovni prostor", "0", "35,50", "0,70", "pravno", "", "", "Primjer d.o.o.", "4400000000000", "", "", "100", "01.06.2021."],
];

/** Sadržaj obrasca za preuzimanje: BOM + razdjelnik `;` + decimalni zarez, da ga Excel i LibreOffice otvore bez uvoza. */
export function csvTemplate(): string {
  const q = (v: string) => (/[;"\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
  const lines = [CSV_COLUMNS.map((c) => c.name), ...CSV_EXAMPLE_ROWS].map((r) => r.map(q).join(";"));
  return "﻿" + lines.join("\r\n") + "\r\n";
}

export const IMPORT_JSON_EXAMPLE = {
  format: IMPORT_FORMAT_ID,
  formatVersion: IMPORT_FORMAT_VERSION,
  zev: {
    legalName: "Zajednica etažnih vlasnika Primjer", shortName: "ZEV Primjer", registrationNumber: "65-01-0001-24",
    jib: "4400000000001", registeredAddress: "Ulica Primjera 1", city: "Banja Luka", municipality: "Banja Luka",
    foundingDate: "01.03.2024.", registrationDate: "2024-04-15",
  },
  president: { firstName: "Dragana", lastName: "Savić", phone: "065 111 222" },
  accounts: [{ key: "r1", type: "BANK", name: "Tekući račun", bankName: "Primjer banka", number: "0060000123456758", openingBalance: "1.234,56", openingDate: "01.01.2025." }],
  buildings: [{ key: "z1", name: "Zgrada A", address: "Ulica Primjera 1", cadastralRef: "k.č. 100/1", yearBuilt: 1985, floorsCount: 5, entrances: [{ key: "u1", name: "A" }] }],
  units: [
    { key: "s1", buildingKey: "z1", entranceKey: "u1", type: "APARTMENT", label: "Stan 1", floor: 1, usableArea: "62,40", ownershipShare: "1,25" },
    { key: "s2", buildingKey: "z1", entranceKey: "u1", type: "BUSINESS", label: "Lokal 1", floor: 0, usableArea: 35.5, ownershipShare: 0.7 },
  ],
  commonAssets: [{ key: "c1", buildingKey: "z1", kind: "AREA", name: "Stubište", description: "Zajedničko stubište i hodnici" }],
  parties: [
    { key: "p1", kind: "PERSON", firstName: "Marko", lastName: "Marković", email: "marko@primjer.ba", phone: "065 123 456" },
    { key: "p2", kind: "ORGANIZATION", orgName: "Primjer d.o.o.", orgIdNumber: "4400000000000" },
  ],
  stakes: [
    { unitKey: "s1", partyKey: "p1", sharePercent: "100", validFrom: "01.01.2020." },
    { unitKey: "s2", partyKey: "p2", sharePercent: "100", validFrom: "2021-06-01" },
  ],
  disputedUnits: [],
  offices: { accountant: "LATER", board: [{ partyKey: "p1", validFrom: "01.03.2024." }] },
};

/** Opis polja za asistenta (i za alat get_import_format). */
export const IMPORT_SCHEMA_DESCRIPTION = [
  `Fajl je JSON (UTF-8). Obavezno: "format": "${IMPORT_FORMAT_ID}" i "formatVersion": ${IMPORT_FORMAT_VERSION}. Svaka sekcija je opciona; sekcija koje nema u fajlu se ne dira.`,
  `zev: legalName, shortName, registrationNumber, jib, registeredAddress, city, municipality, foundingDate, registrationDate (tekst; datumi yyyy-mm-dd ili dd.mm.yyyy.).`,
  `president: firstName, lastName, phone.`,
  `accounts[]: key?, type ("BANK" ili "CASH"), name, bankName?, number? (obavezan za BANK, 16 cifara), openingBalance? (npr. "1.234,56"), openingDate (obavezan).`,
  `buildings[]: key?, name, address, cadastralRef?, yearBuilt? (cio broj), floorsCount? (cio broj), entrances?: [{ key?, name }].`,
  `units[]: key?, buildingKey, entranceKey?, type ("APARTMENT", "BUSINESS", "GARAGE", "GARAGE_SPACE", "OTHER" ili "stan", "poslovni prostor", "garaža", "garažno mjesto", "ostalo"), label (oznaka, jedinstvena u zgradi), floor? (cio broj; "P" = prizemlje), usableArea (m², veće od 0), ownershipShare (udio u troškovima u %, veći od 0, najviše 100).`,
  `commonAssets[]: key?, buildingKey, kind ("AREA", "SYSTEM", "EQUIPMENT"), name, description?.`,
  `parties[]: key, kind ("PERSON" ili "ORGANIZATION"), firstName?, lastName? (obavezni za PERSON), orgName? (obavezan za ORGANIZATION), orgIdNumber?, email?, phone?.`,
  `stakes[]: unitKey, partyKey, sharePercent (veće od 0, najviše 100), validFrom (datum). Vlasnički udjeli iz fajla postaju PRIJEDLOZI; klijent ih upisuje u koraku „Vlasnici” uz dokaz o vlasništvu.`,
  `disputedUnits[]: unitKey posebnih dijelova čije je vlasništvo sporno.`,
  `offices: accountant? (null, "LATER" ili { partyKey, validFrom }), board?: [{ partyKey, validFrom }].`,
  `Veze: *Key polja upućuju na "key" druge stavke u fajlu (ili na ključ stavke koja već postoji u nacrtu); za zgradu može i naziv, za posebni dio "Zgrada A/Stan 3". partyKey "president" je predsjednik ZEV-a. Brojevi mogu biti tekst ("62,40") ili broj (62.4).`,
  `Spajanje: uvoz dopunjava i ažurira, nikad ne briše. Stavka se prepoznaje po "key", a zatim po prirodnom identitetu (zgrada po nazivu, posebni dio po zgradi i oznaci, lice po e-adresi pa po imenu).`,
  `Ograničenja: do 1 MB; do ${IMPORT_LIMITS.units} posebnih dijelova, ${IMPORT_LIMITS.parties} lica, ${IMPORT_LIMITS.stakes} udjela i ${IMPORT_LIMITS.items} stavki ukupno.`,
  `Ne uvozi se: lozinke, nalog računovođe (loginEmail), potvrda registra, dokazi o vlasništvu.`,
].join("\n");

/** Uputstvo koje korisnik kopira u razgovor sa asistentom (ChatGPT, Claude…). */
export function assistantInstructions(): string {
  return [
    `Pripremi JSON fajl sa podacima za podešavanje novog ZEV-a (zajednice etažnih vlasnika) iz priloženih dokumenata (etažni elaborat, rješenje o registraciji, spisak vlasnika).`,
    ``,
    `Pravila:`,
    `- Odgovori samo jednim JSON dokumentom, bez objašnjenja i bez markdown ograde, kodiran u UTF-8.`,
    `- Ne izmišljaj podatke. Ako podatka nema u dokumentima, izostavi polje.`,
    `- Svaka zgrada, ulaz, posebni dio i lice dobija svoj "key" (npr. "z1", "s1", "p1"); veze ("buildingKey", "unitKey", "partyKey") upućuju na te ključeve.`,
    `- Za lica upiši e-adresu kad je poznata: preko nje se isto lice prepoznaje u više redova.`,
    `- Površine i udjele upiši kao brojeve (npr. "62,40"). Udjeli u troškovima svih posebnih dijelova treba da daju 100 %.`,
    `- Vlasničke udjele ("stakes") upiši samo kad su u dokumentima; klijent će ih potvrditi dokazom o vlasništvu.`,
    ``,
    `Format:`,
    IMPORT_SCHEMA_DESCRIPTION,
    ``,
    `Primjer:`,
    JSON.stringify(IMPORT_JSON_EXAMPLE, null, 2),
  ].join("\n");
}
