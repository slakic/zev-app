// CSV uvoz izvoda (F5b.2): kolone se u UI-ju biraju od 1 ("1. kolona"), a servis (`importBankCsv`) i dalje radi sa
// indeksima od 0. Pretvaranje je jedna čista funkcija; ovdje je i pamćenje mapiranja po računu u `localStorage`
// (F5-Q5 (a), bez migracije) — svaki pristup skladištu je u try/catch, a stranica radi i bez njega.

/** Mapiranje onako kako ga forma šalje: brojevi kolona od 1, ostalo kao tekst. */
export type CsvUiMapping = {
  delimiter: string;
  dateCol: string;
  amountCol: string;
  payerCol: string;
  referenceCol: string;
  /** Prazno = izvod nema posebnu kolonu za svrhu. */
  purposeCol: string;
  skipRows: string;
  dateFormat: string;
  decimalComma: boolean;
};

export const DEFAULT_CSV_UI_MAPPING: CsvUiMapping = {
  delimiter: ";",
  dateCol: "1",
  amountCol: "2",
  payerCol: "3",
  referenceCol: "4",
  purposeCol: "",
  skipRows: "1",
  dateFormat: "DD.MM.YYYY",
  decimalComma: true,
};

/** Servisni oblik (`CsvMapping` iz payments.ts), ponovljen ovdje da klijentski kod ne uvozi servis. */
export type CsvServiceMapping = {
  dateCol: number;
  amountCol: number;
  payerCol: number;
  referenceCol: number;
  purposeCol: number;
  delimiter: string;
  skipRows: number;
  decimalComma: boolean;
  dateFormat: string;
};

/** Broj kolone iz UI-ja (od 1) u indeks servisa (od 0). Prazno/neispravno → `null`. */
export function uiColumnToIndex(value: string | number | null | undefined): number | null {
  if (value === null || value === undefined) return null;
  const s = String(value).trim();
  if (!/^\d+$/.test(s)) return null;
  const n = Number(s);
  return n >= 1 ? n - 1 : null;
}

/** Indeks servisa (od 0) u broj kolone za UI (od 1). */
export function indexToUiColumn(index: number): number {
  return index + 1;
}

/** Forma (brojevi kolona od 1) → mapiranje za `importBankCsv` (indeksi od 0). Obavezne kolone moraju biti 1 ili veće. */
export function uiMappingToService(ui: CsvUiMapping): CsvServiceMapping {
  const required = (label: string, v: string): number => {
    const i = uiColumnToIndex(v);
    if (i === null) throw new Error(`${label}: izaberite kolonu (1. kolona ili veća).`);
    return i;
  };
  const skip = Number(ui.skipRows);
  return {
    dateCol: required("Datum", ui.dateCol),
    amountCol: required("Iznos", ui.amountCol),
    payerCol: required("Platilac", ui.payerCol),
    referenceCol: required("Poziv na broj", ui.referenceCol),
    purposeCol: uiColumnToIndex(ui.purposeCol) ?? -1,
    delimiter: ui.delimiter || ";",
    skipRows: Number.isInteger(skip) && skip >= 0 ? skip : 1,
    decimalComma: ui.decimalComma,
    dateFormat: ui.dateFormat || "DD.MM.YYYY",
  };
}

/** Čita mapiranje iz `FormData`-sličnog izvora (kolone od 1). */
export function uiMappingFromForm(get: (name: string) => FormDataEntryValue | null): CsvUiMapping {
  const text = (name: string, fallback: string) => {
    const v = get(name);
    return typeof v === "string" && v.trim() !== "" ? v.trim() : fallback;
  };
  const purpose = get("purposeCol");
  return {
    delimiter: text("delimiter", DEFAULT_CSV_UI_MAPPING.delimiter),
    dateCol: text("dateCol", DEFAULT_CSV_UI_MAPPING.dateCol),
    amountCol: text("amountCol", DEFAULT_CSV_UI_MAPPING.amountCol),
    payerCol: text("payerCol", DEFAULT_CSV_UI_MAPPING.payerCol),
    referenceCol: text("referenceCol", DEFAULT_CSV_UI_MAPPING.referenceCol),
    purposeCol: typeof purpose === "string" ? purpose.trim() : "",
    skipRows: text("skipRows", DEFAULT_CSV_UI_MAPPING.skipRows),
    dateFormat: text("dateFormat", DEFAULT_CSV_UI_MAPPING.dateFormat),
    decimalComma: get("decimalComma") === "on",
  };
}

// ---- Pamćenje po računu (localStorage) ----

export const CSV_MAPPING_STORAGE_PREFIX = "zev-csv-mapping:";

type StorageLike = Pick<Storage, "getItem" | "setItem">;

function browserStorage(): StorageLike | null {
  try {
    return typeof window !== "undefined" ? window.localStorage : null;
  } catch {
    return null;
  }
}

function isUiMapping(v: unknown): v is CsvUiMapping {
  if (!v || typeof v !== "object") return false;
  const o = v as Record<string, unknown>;
  return (
    ["delimiter", "dateCol", "amountCol", "payerCol", "referenceCol", "purposeCol", "skipRows", "dateFormat"].every((k) => typeof o[k] === "string") &&
    typeof o.decimalComma === "boolean"
  );
}

/** Sačuvano mapiranje računa, ili `null` (nema ga, pokvareno je, ili skladište nije dostupno). */
export function readSavedCsvMapping(accountId: string, storage: StorageLike | null = browserStorage()): CsvUiMapping | null {
  try {
    const raw = storage?.getItem(CSV_MAPPING_STORAGE_PREFIX + accountId);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    return isUiMapping(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

/** Pamti mapiranje računa; vraća `false` ako skladište nije dostupno (stranica radi i bez njega). */
export function saveCsvMapping(accountId: string, mapping: CsvUiMapping, storage: StorageLike | null = browserStorage()): boolean {
  try {
    if (!storage) return false;
    storage.setItem(CSV_MAPPING_STORAGE_PREFIX + accountId, JSON.stringify(mapping));
    return true;
  } catch {
    return false;
  }
}
