"use client";
// CSV uvoz izvoda (F5b.2): FilePicker umjesto golog <input type="file">, kolone se biraju od "1. kolona", a mapiranje se
// pamti po računu u localStorage (F5-Q5 (a)). Skladište je opcionalno: svaki pristup je u try/catch (`csvMapping.ts`),
// pa forma radi isto i kad ga pregledač ne daje. Server akcija prima kolone od 1 i sama ih pretvara u indekse od 0.
import { useEffect, useState } from "react";
import { FilePicker } from "@/components/file-picker";
import { Field, inputCls, SubmitBtn, ToggleBtn } from "@/components/ui";
import {
  DEFAULT_CSV_UI_MAPPING, readSavedCsvMapping, saveCsvMapping, uiMappingFromForm, type CsvUiMapping,
} from "@/lib/csvMapping";
import { t, tf } from "@/lib/i18n";

type Account = { id: string; name: string };

const MAX_COLUMN = 20;

function ColumnSelect({ name, value, onChange, optional, label }: { name: string; value: string; onChange: (v: string) => void; optional?: boolean; label: string }) {
  return (
    <select name={name} value={value} onChange={(e) => onChange(e.target.value)} className={inputCls} aria-label={label}>
      {optional && <option value="">{t("csvImport.noColumn")}</option>}
      {Array.from({ length: MAX_COLUMN }, (_, i) => (
        <option key={i + 1} value={String(i + 1)}>{tf("csvImport.columnN", { broj: i + 1 })}</option>
      ))}
    </select>
  );
}

export function CsvImportForm({ accounts, action }: { accounts: Account[]; action: (formData: FormData) => Promise<void> }) {
  const [accountId, setAccountId] = useState(accounts[0]?.id ?? "");
  const [files, setFiles] = useState<File[]>([]);
  const [mapping, setMapping] = useState<CsvUiMapping>(DEFAULT_CSV_UI_MAPPING);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Mapiranje izabranog računa (ako je sačuvano) — čita se tek u pregledaču, poslije prvog prikaza.
  useEffect(() => {
    const found = accountId ? readSavedCsvMapping(accountId) : null;
    setSaved(found !== null);
    setMapping(found ?? DEFAULT_CSV_UI_MAPPING);
  }, [accountId]);

  const set = <K extends keyof CsvUiMapping>(key: K, value: CsvUiMapping[K]) => setMapping((m) => ({ ...m, [key]: value }));
  const accountName = accounts.find((a) => a.id === accountId)?.name ?? "";

  async function submit(fd: FormData) {
    if (files.length === 0) {
      setError(t("csvImport.errNoFile"));
      return;
    }
    setError(null);
    fd.set("file", files[0]);
    saveCsvMapping(accountId, uiMappingFromForm((n) => fd.get(n)));
    await action(fd);
  }

  const fields = (
    <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
      <Field label={t("csvImport.delimiter")}>
        <input name="delimiter" value={mapping.delimiter} onChange={(e) => set("delimiter", e.target.value)} className={inputCls} />
      </Field>
      <Field label={t("csvImport.dateCol")}>
        <ColumnSelect name="dateCol" value={mapping.dateCol} onChange={(v) => set("dateCol", v)} label={t("csvImport.dateCol")} />
      </Field>
      <Field label={t("csvImport.amountCol")}>
        <ColumnSelect name="amountCol" value={mapping.amountCol} onChange={(v) => set("amountCol", v)} label={t("csvImport.amountCol")} />
      </Field>
      <Field label={t("csvImport.payerCol")}>
        <ColumnSelect name="payerCol" value={mapping.payerCol} onChange={(v) => set("payerCol", v)} label={t("csvImport.payerCol")} />
      </Field>
      <Field label={t("csvImport.referenceCol")}>
        <ColumnSelect name="referenceCol" value={mapping.referenceCol} onChange={(v) => set("referenceCol", v)} label={t("csvImport.referenceCol")} />
      </Field>
      <Field label={t("csvImport.purposeCol")} hint={t("csvImport.purposeHint")}>
        <ColumnSelect name="purposeCol" value={mapping.purposeCol} onChange={(v) => set("purposeCol", v)} optional label={t("csvImport.purposeCol")} />
      </Field>
      <Field label={t("csvImport.skipRows")}>
        <input name="skipRows" type="number" min={0} value={mapping.skipRows} onChange={(e) => set("skipRows", e.target.value)} className={inputCls} />
      </Field>
      <Field label={t("csvImport.dateFormat")}>
        <select name="dateFormat" value={mapping.dateFormat} onChange={(e) => set("dateFormat", e.target.value)} className={inputCls}>
          <option value="DD.MM.YYYY">{t("csvImport.formatDmy")}</option>
          <option value="YYYY-MM-DD">{t("csvImport.formatIso")}</option>
        </select>
      </Field>
      <label className="flex items-center gap-2 pb-2 text-sm sm:self-end">
        <input type="checkbox" name="decimalComma" checked={mapping.decimalComma} onChange={(e) => set("decimalComma", e.target.checked)} />
        {t("csvImport.decimalComma")}
      </label>
    </div>
  );

  return (
    <form action={submit} className="space-y-3">
      <FilePicker label={t("csvImport.file")} buttonLabel={t("csvImport.pick")} hint={t("csvImport.pickHint")} accept=".csv,text/csv" files={files} onChange={setFiles} />
      {error && <p role="alert" className="text-sm text-red-800">{error}</p>}
      <div className="max-w-sm">
        <Field label={t("csvImport.account")}>
          <select name="accountId" value={accountId} onChange={(e) => setAccountId(e.target.value)} className={inputCls}>
            {accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
          </select>
        </Field>
      </div>
      {saved ? (
        <div>
          <p className="text-sm text-slate-700">{tf("csvImport.saved", { racun: accountName })}</p>
          <p className="text-[13px] text-slate-500">{t("csvImport.savedHint")}</p>
          <details className="group mt-2">
            <ToggleBtn>{t("csvImport.change")}</ToggleBtn>
            {fields}
          </details>
        </div>
      ) : (
        fields
      )}
      <SubmitBtn variant="tonal">{t("csvImport.submit")}</SubmitBtn>
    </form>
  );
}
