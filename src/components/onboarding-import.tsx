"use client";
// Uvoz nacrta novog ZEV-a iz JSON/CSV fajla (Plans/mcp-onboarding-asistent-plan.md §8): kartica „Kako napraviti fajl” i
// kartica „Uvoz” sa tri stanja — izbor fajla → pregled (ništa nije upisano) → uvezeno. Pregled je kompozicija postojećih
// primitiva (Card, Table, Flash inset, Btn). Isti fajl se šalje i pri pregledu i pri potvrdi; server provjerava hash i
// verziju nacrta. Isti sklop koristi vlasnik (/onboarding/uvoz) i administrator sa aktivnim pristupom (`draftId`).
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { BtnLink, Btn, Card, Flash, SubmitBtn, Table, Td, inputCls, type ColumnSpec } from "@/components/ui";
import { FilePicker } from "@/components/file-picker";
import { commitDraftImportAction, previewDraftImportAction, type ImportCommitState } from "@/server/actions/onboardingImport";
import type { ImportPreview } from "@/server/services/onboardingImport";
import { PLAN_SECTIONS } from "@/lib/onboarding/import/sections";
import { t, tf } from "@/lib/i18n";

/** Prikazuje se samo prvih toliko grešaka i upozorenja; ostalo ide kao „i još N”. */
const SHOWN = 50;

const countHeaders: ColumnSpec[] = [
  { label: t("onboarding.import.cols.section"), priority: "primary" },
  { label: t("onboarding.import.cols.added"), align: "right" },
  { label: t("onboarding.import.cols.updated"), align: "right" },
  { label: t("onboarding.import.cols.unchanged"), align: "right" },
  { label: t("onboarding.import.cols.skipped"), align: "right" },
];

const errorHeaders: ColumnSpec[] = [
  { label: t("onboarding.import.cols.section"), priority: "primary" },
  { label: t("onboarding.import.cols.row"), align: "right" },
  { label: t("onboarding.import.cols.field") },
  { label: t("onboarding.import.cols.message") },
];

export type OnboardingImportProps = {
  /** Samo za administratora: nacrt klijenta (server ponovo provjerava aktivan pristup). */
  draftId?: string;
  /** Uputstvo za asistenta (iz importFormat.ts). */
  instructions: string;
  csvHref: string;
  jsonHref: string;
  exportHref: string;
  /** Veza „Nazad na nacrt” (administrator); vlasnik ide na korak koji vrati server. */
  adminBackHref?: string;
};

function CopyInstructions({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Bez Clipboard API-ja (nesiguran kontekst) tekst se i dalje može označiti i kopirati ručno.
    }
  }
  return (
    <div className="mt-3">
      <label className="block">
        <span className="sr-only">{t("onboarding.import.how.assistantLabel")}</span>
        <textarea readOnly rows={8} value={text} onFocus={(e) => e.currentTarget.select()} className={`${inputCls} bg-slate-50 font-mono text-[13px]`} />
      </label>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <Btn type="button" variant="tonal" onClick={copy}>{t("onboarding.import.how.copy")}</Btn>
        <span aria-live="polite" className="text-[13px] text-slate-600">{copied ? t("onboarding.import.how.copied") : ""}</span>
      </div>
    </div>
  );
}

export function OnboardingImport({ draftId, instructions, csvHref, jsonHref, exportHref, adminBackHref }: OnboardingImportProps) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [files, setFiles] = useState<File[]>([]);
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<Extract<ImportCommitState, { ok: true }> | null>(null);

  function body(extra: Record<string, string> = {}) {
    const fd = new FormData();
    fd.set("file", files[0]);
    if (draftId) fd.set("draftId", draftId);
    for (const [k, v] of Object.entries(extra)) fd.set(k, v);
    return fd;
  }

  function reset() {
    setPreview(null);
    setFiles([]);
    setError(null);
    setDone(null);
  }

  function handleRead(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setDone(null);
    if (files.length === 0) {
      setError(t("onboarding.import.upload.noFile"));
      return;
    }
    startTransition(async () => {
      const res = await previewDraftImportAction(body());
      if (!res.ok) {
        setPreview(null);
        setError(res.error);
        return;
      }
      setPreview(res.preview);
    });
  }

  function handleConfirm() {
    if (!preview) return;
    setError(null);
    startTransition(async () => {
      const res = await commitDraftImportAction(body({ version: String(preview.version), sha256: preview.sha256 }));
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setPreview(null);
      setFiles([]);
      setDone(res);
      router.refresh();
    });
  }

  const blocked = preview ? preview.errorCount > 0 || preview.added + preview.updated === 0 : false;

  return (
    <div className="space-y-6">
      <Card title={t("onboarding.import.how.title")}>
        <div className="flex flex-wrap items-start gap-2">
          <BtnLink href={csvHref}>{t("onboarding.import.how.csv")}</BtnLink>
          <BtnLink href={jsonHref}>{t("onboarding.import.how.json")}</BtnLink>
          <BtnLink href={exportHref}>{t("onboarding.import.how.export")}</BtnLink>
        </div>
        <p className="mt-3 max-w-[68ch] text-[13px] text-slate-600">{t("onboarding.import.how.csvNote")}</p>
        <h3 className="mt-5 text-sm font-semibold text-slate-700">{t("onboarding.import.how.assistantTitle")}</h3>
        <p className="mt-1 max-w-[68ch] text-sm text-slate-700">{t("onboarding.import.how.assistantText")}</p>
        <CopyInstructions text={instructions} />
      </Card>

      <Card title={t("onboarding.import.upload.title")}>
        {done ? (
          <div className="space-y-4">
            <Flash inset msg={tf("onboarding.import.done.message", { novih: done.added, izmijenjenih: done.updated })} />
            <div className="flex flex-wrap items-center gap-2">
              {adminBackHref ? (
                <BtnLink href={adminBackHref} variant="primary">{t("onboarding.import.done.backToDraft")}</BtnLink>
              ) : (
                <BtnLink href={`/onboarding/${done.nextStep.slug}`} variant="primary">{tf("onboarding.import.done.goToStep", { korak: done.nextStep.label })}</BtnLink>
              )}
              <Btn type="button" variant="secondary" onClick={reset}>{t("onboarding.import.done.another")}</Btn>
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            {error && <Flash inset err={error} />}
            {!preview && (
              <form onSubmit={handleRead} className="space-y-4">
                <FilePicker
                  label={t("onboarding.import.upload.file")}
                  buttonLabel={t("onboarding.import.upload.button")}
                  hint={t("onboarding.import.upload.hint")}
                  accept=".json,.csv,.txt,application/json,text/csv,text/plain"
                  files={files}
                  onChange={setFiles}
                  disabled={pending}
                />
                <SubmitBtn variant="tonal" disabled={pending || files.length === 0}>
                  {pending ? t("onboarding.import.upload.reading") : t("onboarding.import.upload.read")}
                </SubmitBtn>
              </form>
            )}
            {preview && <PreviewPanel preview={preview} blocked={blocked} pending={pending} onCancel={reset} onConfirm={handleConfirm} />}
          </div>
        )}
      </Card>
    </div>
  );
}

function PreviewPanel({ preview, blocked, pending, onCancel, onConfirm }: { preview: ImportPreview; blocked: boolean; pending: boolean; onCancel: () => void; onConfirm: () => void }) {
  const rows = PLAN_SECTIONS.filter((s) => {
    const c = preview.counts[s];
    return c.added + c.updated + c.unchanged + c.skipped > 0;
  });
  const hasErrors = preview.errorCount > 0;
  const noChanges = !hasErrors && preview.added + preview.updated === 0;
  return (
    <div className="space-y-4">
      {hasErrors ? (
        <>
          <Flash inset err={tf("onboarding.import.preview.errorsIntro", { broj: preview.errorCount })} />
          <Table id="onboarding-import-errors" caption={t("onboarding.import.preview.errorsCaption")} headers={errorHeaders}>
            {preview.errors.slice(0, SHOWN).map((e, i) => (
              <tr key={i}>
                <Td>{t(`onboarding.import.sections.${e.section}`)}</Td>
                <Td><span className="tabular-nums">{e.row ?? "—"}</span></Td>
                <Td>{e.field ?? "—"}</Td>
                <Td>{e.message}</Td>
              </tr>
            ))}
          </Table>
          {preview.errorCount > SHOWN && <p className="text-[13px] text-slate-600">{tf("onboarding.import.preview.errorsMore", { broj: preview.errorCount - SHOWN })}</p>}
        </>
      ) : (
        <>
          <p className="text-sm text-slate-700">{tf("onboarding.import.preview.summary", { fajl: preview.filename, novih: preview.added, izmijenjenih: preview.updated })}</p>
          <Table id="onboarding-import-counts" caption={t("onboarding.import.preview.caption")} headers={countHeaders}>
            {rows.map((s) => (
              <tr key={s}>
                <Td>{t(`onboarding.import.sections.${s}`)}</Td>
                <Td><span className="tabular-nums">{preview.counts[s].added}</span></Td>
                <Td><span className="tabular-nums">{preview.counts[s].updated}</span></Td>
                <Td><span className="tabular-nums">{preview.counts[s].unchanged}</span></Td>
                <Td><span className="tabular-nums">{preview.counts[s].skipped}</span></Td>
              </tr>
            ))}
          </Table>
        </>
      )}
      {preview.warningCount > 0 && (
        <Flash
          inset
          warn={
            <>
              <p className="font-medium">{tf("onboarding.import.preview.warningsTitle", { broj: preview.warningCount })}</p>
              <ul className="mt-1 list-disc space-y-0.5 pl-5">
                {preview.warnings.slice(0, SHOWN).map((w, i) => (
                  <li key={i}>{w.row ? `${t("onboarding.import.cols.row")} ${w.row}: ` : ""}{w.message}</li>
                ))}
              </ul>
              {preview.warningCount > SHOWN && <p className="mt-1">{tf("onboarding.import.preview.warningsMore", { broj: preview.warningCount - SHOWN })}</p>}
            </>
          }
        />
      )}
      {noChanges && <p className="text-sm font-medium text-slate-700">{t("onboarding.import.preview.noChanges")}</p>}
      <div className="flex flex-wrap items-center gap-2">
        <Btn type="button" variant="secondary" onClick={onCancel} disabled={pending}>{t("onboarding.import.preview.cancel")}</Btn>
        <Btn type="button" variant="primary" onClick={onConfirm} disabled={blocked || pending}>
          {pending ? t("onboarding.import.preview.confirming") : t("onboarding.import.preview.confirm")}
        </Btn>
      </div>
    </div>
  );
}
