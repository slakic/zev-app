// Uvoz nacrta novog ZEV-a iz JSON/CSV fajla (Plans/mcp-onboarding-asistent-plan.md §8). Uvozi se U NACRT, nikad
// direktno u ZEV: klijent sve pregleda u koracima i sam objavljuje. Dva koraka kao kod PDF izvoda: pregled (ništa se ne
// piše) pa potvrda (isti fajl se šalje ponovo; server provjerava hash i verziju nacrta i ponovo planira nad TRENUTNIM
// nacrtom). Pravo pristupa dokazuje `DraftAccess` (vlasnik ili super admin sa aktivnim pristupom), ne ID iz forme.
// Fajl je samo podatak: vrsta se određuje po sadržaju, ništa se ne izvršava, veličina se provjerava prije čitanja.
import { createHash } from "node:crypto";
import { audit } from "@/server/audit";
import { displayNameFor } from "@/server/auth/displayName";
import { t } from "@/lib/i18n";
import type { DraftAccess } from "@/server/services/draftAccess";
import { StaleDraftError, getDraftByAccess, updateDraftByAccess } from "@/server/services/onboarding";
import { decodeText } from "@/lib/csv";
import { IMPORT_FORMAT_VERSION, IMPORT_MAX_BYTES } from "@/lib/onboarding/import/importFormat";
import { parseJsonImport, type ImportIssue, type ParsedImport } from "@/lib/onboarding/import/schema";
import { parseCsvImport } from "@/lib/onboarding/import/csvToDoc";
import { PLAN_SECTIONS, planDraftImport, type ImportReport, type SectionCounts } from "@/lib/onboarding/import/plan";
import { draftToImportDoc } from "@/lib/onboarding/import/exportDoc";
import type { OnboardingDraftData } from "@/lib/onboarding/draft";

export type ImportKind = "json" | "csv";

/** Najviše grešaka i upozorenja koje pregled vraća klijentu (ukupan broj se vraća posebno). */
const MAX_ISSUES = 200;

export type ImportPreview = {
  filename: string;
  kind: ImportKind;
  /** Verzija nacrta u trenutku čitanja i hash fajla; potvrda ih šalje nazad (brava). */
  version: number;
  sha256: string;
  counts: Record<(typeof PLAN_SECTIONS)[number], SectionCounts>;
  added: number;
  updated: number;
  proposals: number;
  errors: ImportIssue[];
  errorCount: number;
  warnings: ImportIssue[];
  warningCount: number;
};

/** Fajl ima greške; ništa nije upisano. */
export class ImportInvalidError extends Error {
  constructor(public readonly errorCount: number) {
    super(t("onboarding.import.msg.invalid"));
    this.name = "ImportInvalidError";
  }
}

function checkSize(bytes: Uint8Array) {
  if (bytes.length === 0) throw new Error(t("onboarding.import.msg.empty"));
  if (bytes.length > IMPORT_MAX_BYTES) throw new Error(t("onboarding.import.msg.tooBig"));
}

const hashOf = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");

/** Vrsta po SADRŽAJU: prvi znak koji nije razmak je `{` → JSON, inače CSV. Naziv i MIME tip se ne uzimaju u obzir. */
export function detectImportKind(bytes: Uint8Array): ImportKind {
  const { text } = decodeText(bytes.subarray(0, Math.min(bytes.length, 4096)));
  return text.trimStart().startsWith("{") ? "json" : "csv";
}

function parseFile(bytes: Uint8Array): { kind: ImportKind; parsed: ParsedImport } {
  const kind = detectImportKind(bytes);
  if (kind === "json") return { kind, parsed: parseJsonImport(decodeText(bytes).text) };
  return { kind, parsed: parseCsvImport(bytes) };
}

function planFile(data: OnboardingDraftData, bytes: Uint8Array): { kind: ImportKind; next: OnboardingDraftData | null; report: ImportReport } {
  const { kind, parsed } = parseFile(bytes);
  if (!parsed.doc) {
    const empty = planDraftImport(data, { kind }).report;
    return { kind, next: null, report: { ...empty, errors: parsed.errors, warnings: parsed.warnings } };
  }
  const { next, report } = planDraftImport(data, parsed.doc);
  // Greške po redu fajla (stabilno; one bez reda idu prve), da ih korisnik ispravlja redom.
  const errors = [...parsed.errors, ...report.errors].sort((a, b) => (a.row ?? 0) - (b.row ?? 0));
  return { kind, next, report: { ...report, errors, warnings: [...parsed.warnings, ...report.warnings] } };
}

/** Pregled: ništa se ne piše. */
export async function previewDraftImport(access: DraftAccess, input: { filename: string; bytes: Uint8Array }): Promise<ImportPreview> {
  checkSize(input.bytes);
  const draft = await getDraftByAccess(access);
  const { kind, report } = planFile(draft.data, input.bytes);
  return {
    filename: input.filename, kind, version: draft.version, sha256: hashOf(input.bytes),
    counts: report.counts, added: report.added, updated: report.updated, proposals: report.proposals,
    errors: report.errors.slice(0, MAX_ISSUES), errorCount: report.errors.length,
    warnings: report.warnings.slice(0, MAX_ISSUES), warningCount: report.warnings.length,
  };
}

export type ImportResult = { version: number; added: number; updated: number; proposals: number };

/** Potvrda: ponovo planira nad trenutnim nacrtom i upisuje JEDNOM (jedna nova verzija) ili uopšte ne. */
export async function commitDraftImport(
  access: DraftAccess,
  input: { filename: string; bytes: Uint8Array; version: number; sha256: string }
): Promise<ImportResult> {
  checkSize(input.bytes);
  if (hashOf(input.bytes) !== input.sha256) throw new Error(t("onboarding.import.msg.fileChanged"));
  const draft = await getDraftByAccess(access);
  if (draft.version !== input.version) throw new StaleDraftError();
  const { kind, next, report } = planFile(draft.data, input.bytes);
  if (!next || report.errors.length > 0) throw new ImportInvalidError(report.errors.length);
  if (report.added + report.updated === 0) throw new Error(t("onboarding.import.msg.noChanges"));
  const version = await updateDraftByAccess(access, null, draft.version, () => next);
  // Bez sadržaja i bez imena: samo vrsta, brojevi i ko je uvezao (vlasnik ili administrator).
  await audit({ userId: access.userId, label: (await displayNameFor(access.userId)) || undefined }, {
    action: "onboarding.draft.import",
    targetType: "OnboardingDraft",
    targetId: access.draftId,
    after: {
      kind, formatVersion: kind === "json" ? IMPORT_FORMAT_VERSION : null, counts: report.counts,
      added: report.added, updated: report.updated, proposals: report.proposals, warnings: report.warnings.length, via: access.via,
    },
  });
  return { version, added: report.added, updated: report.updated, proposals: report.proposals };
}

/** nacrt.json: sadržaj nacrta u formatu uvoza. */
export async function draftExportDoc(access: DraftAccess): Promise<Record<string, unknown>> {
  const draft = await getDraftByAccess(access);
  return draftToImportDoc(draft.data);
}
