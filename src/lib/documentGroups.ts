// F8.6: grupe vrsta dokumenata za filter na stranici „Dokumenti” (Sjednice i odluke · Fakture · Izvještaji · Ostalo).
export const DOCUMENT_GROUPS = ["sjednice", "fakture", "izvjestaji", "ostalo"] as const;
export type DocumentGroup = (typeof DOCUMENT_GROUPS)[number];

const GROUP_TYPES: Record<Exclude<DocumentGroup, "ostalo">, readonly string[]> = {
  sjednice: ["MEETING_INVITATION", "AGENDA", "PROXY_AUTHORIZATION", "ATTENDANCE_LIST", "VOTING_LIST", "MINUTES", "DECISION"],
  fakture: ["INVOICE", "OWNER_STATEMENT", "PAYMENT_REMINDER", "DEBT_STATEMENT"],
  izvjestaji: ["ANNUAL_MAINTENANCE_PLAN", "ANNUAL_FINANCIAL_PLAN", "ANNUAL_REPORT"],
};

/** Grupa kojoj pripada vrsta dokumenta; sve što nije nabrojano je „ostalo”. */
export function documentGroupOf(type: string): DocumentGroup {
  for (const g of Object.keys(GROUP_TYPES) as (keyof typeof GROUP_TYPES)[]) if (GROUP_TYPES[g].includes(type)) return g;
  return "ostalo";
}

/** Vrijednost iz query-ja → grupa, ili undefined (bez filtera) za nepoznatu vrijednost. */
export function parseDocumentGroup(raw: string | undefined): DocumentGroup | undefined {
  return (DOCUMENT_GROUPS as readonly string[]).includes(raw ?? "") ? (raw as DocumentGroup) : undefined;
}
