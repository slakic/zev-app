"use client";
// Two-step PDF bank-statement import: parse (server action, writes nothing) -> the
// accountant reviews/edits every row in an editable table -> commit (server action,
// writes exactly what was reviewed). Unlike the CSV import, nothing is written to the
// database until this component's user explicitly confirms — see importPdfPreview()/
// commitPdfImport() in payments.ts for why reading a PDF's text layer isn't trusted
// the same way structured CSV columns are.
// Since v2.39.0 several statements can be chosen at once (FilePicker); they are reviewed in one
// table grouped by statement and imported together, each still as its own import batch.
import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { parsePdfPreviewsAction, commitPdfImportsAction } from "@/server/actions/bankPdfImport";
import type { PdfPreviewRow, PdfStatementPreview } from "@/server/services/payments";
import { inputCls, btnBase, btnVariantCls } from "@/components/ui";
import { FilePicker } from "@/components/file-picker";
import { formatDate, formatDateTime } from "@/lib/i18n";

type Account = { id: string; name: string };

// Server actions accept up to MAX_UPLOAD_MB (default 4 MB, next.config.ts) per request.
const MAX_TOTAL_BYTES = 4 * 1024 * 1024;
const MAX_FILES = 31;

const cellInputCls = "rounded border border-slate-300 px-1.5 py-1 text-[13px]";
const alertCls = "rounded-xl border-l-4 px-3 py-2.5 text-sm shadow-sm";

async function sha256Hex(file: File): Promise<string | null> {
  if (!globalThis.crypto?.subtle) return null; // non-secure context: the server then skips the check
  const digest = await crypto.subtle.digest("SHA-256", await file.arrayBuffer());
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export function PdfStatementImport({ accounts }: { accounts: Account[] }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [accountId, setAccountId] = useState(accounts[0]?.id ?? "");
  const [files, setFiles] = useState<File[]>([]);
  const [previews, setPreviews] = useState<PdfStatementPreview[] | null>(null);
  const [rows, setRows] = useState<PdfPreviewRow[][]>([]);
  const [failures, setFailures] = useState<{ filename: string; error: string }[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  function handleParse(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setMessage(null);
    if (files.length === 0) {
      setError("Izaberite bar jedan PDF izvod.");
      return;
    }
    if (files.length > MAX_FILES) {
      setError(`Najviše ${MAX_FILES} izvoda odjednom.`);
      return;
    }
    if (files.reduce((n, f) => n + f.size, 0) > MAX_TOTAL_BYTES) {
      setError("Izabrani fajlovi su zajedno veći od 4 MB. Učitajte ih u dva dijela.");
      return;
    }
    startTransition(async () => {
      const fd = new FormData();
      fd.set("accountId", accountId);
      for (const f of files) {
        fd.append("file", f);
        fd.append("sha256", (await sha256Hex(f)) ?? "");
      }
      const res = await parsePdfPreviewsAction(fd);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setPreviews(res.previews);
      setRows(res.previews.map((p) => p.rows));
      setFailures(res.failures);
    });
  }

  function updateRow(si: number, ri: number, patch: Partial<PdfPreviewRow>) {
    setRows((all) => all.map((rs, s) => (s !== si ? rs : rs.map((r, i) => (i === ri ? { ...r, ...patch } : r)))));
  }

  function reset() {
    setPreviews(null);
    setRows([]);
    setFailures([]);
    setFiles([]);
  }

  function handleCancel() {
    reset();
    setError(null);
  }

  function handleCommit() {
    if (!previews) return;
    setError(null);
    const statements = previews.map((p, si) => ({
      filename: p.filename,
      rawText: p.rawText,
      rows: rows[si]
        .filter((r) => r.include)
        .map((r) => ({
          direction: r.direction,
          date: r.date,
          amount: r.amount,
          payerNameRaw: r.payerNameRaw,
          purposeRaw: r.purposeRaw,
          reference: r.reference,
          invoiceId: r.invoiceId,
          expenseId: r.expenseId,
          categoryName: r.categoryName,
        })),
      // Rows left un-ticked because the SMS already booked them: the statement confirms that SMS,
      // and the link is kept (Plans/sms-statement-payment-matching-plan.md R2).
      skippedSmsIds: rows[si].flatMap((r) => (!r.include && r.duplicateOf ? [r.duplicateOf.smsId] : [])),
    }));
    if (statements.every((st) => st.rows.length === 0 && st.skippedSmsIds.length === 0)) {
      setError("Nijedna stavka nije označena za uvoz.");
      return;
    }
    startTransition(async () => {
      const res = await commitPdfImportsAction({ accountId, statements });
      if (!res.ok) {
        setError(res.error);
        return;
      }
      const all = rows.flat().filter((r) => r.include);
      const inCount = all.filter((r) => r.direction === "IN").length;
      setMessage(
        `Uvezeno ${res.imported} stavki (${inCount} uplata, ${res.imported - inCount} isplata) iz ${res.statements} izvoda. Uplate sa izabranom fakturom su odmah raspoređene — ostale pogledajte ` +
          `u tabeli ispod, u koloni "detalji/uparivanje".` +
          (res.linkedToSms > 0 ? ` Izvod je potvrdio ${res.linkedToSms} već proknjiženih SMS stavki (nisu uvezene ponovo).` : "")
      );
      reset();
      router.refresh();
    });
  }

  const flat = rows.flat();
  const includedCount = flat.filter((r) => r.include).length;
  const smsConfirmCount = flat.filter((r) => !r.include && r.duplicateOf).length;
  const invoiceOptions = previews?.[0]?.invoiceOptions ?? [];
  const expenseOptions = previews?.[0]?.expenseOptions ?? [];

  return (
    <div>
      {error && <div role="alert" className={`mb-3 ${alertCls} border-l-red-500 bg-red-50 text-red-800`}>{error}</div>}
      {message && <div role="status" className={`mb-3 ${alertCls} border-l-emerald-500 bg-emerald-50 text-emerald-800`}>{message}</div>}

      {!previews && (
        <form onSubmit={handleParse} className="space-y-3">
          <FilePicker
            label="PDF izvodi"
            buttonLabel="Izaberi PDF izvode…"
            hint="Možete izabrati više izvoda odjednom ili ih prevući ovdje."
            accept=".pdf,application/pdf"
            multiple
            files={files}
            onChange={setFiles}
            disabled={pending}
          />
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <label className="block text-sm">
              <span className="mb-1 block font-medium text-slate-700">Račun</span>
              <select value={accountId} onChange={(e) => setAccountId(e.target.value)} className={inputCls}>
                {accounts.map((a) => (
                  <option key={a.id} value={a.id}>{a.name}</option>
                ))}
              </select>
            </label>
            <div className="flex items-end">
              <button type="submit" disabled={pending || files.length === 0} className={`${btnBase} ${btnVariantCls.primary}`}>
                {pending ? "Čitam izvode…" : files.length > 1 ? `Učitaj i pregledaj (${files.length})` : "Učitaj i pregledaj"}
              </button>
            </div>
          </div>
        </form>
      )}

      {previews && (
        <div>
          {failures.length > 0 && (
            <div role="alert" className={`mb-3 ${alertCls} border-l-red-500 bg-red-50 text-red-800`}>
              <p className="font-medium">Nisu učitani ({failures.length}):</p>
              <ul className="mt-1 list-disc pl-5">
                {failures.map((f) => (
                  <li key={f.filename}>{f.filename}: {f.error}</li>
                ))}
              </ul>
            </div>
          )}
          <p className="mb-3 text-sm text-slate-600">
            Prepoznato {flat.length} stavki iz {previews.length} izvoda. Provjerite/ispravite
            ispod prije uvoza — ništa još nije sačuvano.
          </p>
          <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50 text-left">
                  <th className="px-2 py-2 font-medium text-slate-600">Uvezi</th>
                  <th className="px-2 py-2 font-medium text-slate-600">Smjer</th>
                  <th className="px-2 py-2 font-medium text-slate-600">Datum</th>
                  <th className="px-2 py-2 font-medium text-slate-600">Iznos</th>
                  <th className="px-2 py-2 font-medium text-slate-600">Platilac / primalac</th>
                  <th className="px-2 py-2 font-medium text-slate-600">Svrha / opis</th>
                  <th className="px-2 py-2 font-medium text-slate-600">Faktura / trošak</th>
                </tr>
              </thead>
              {previews.map((p, si) => {
                const rs = rows[si] ?? [];
                const inCount = rs.filter((r) => r.include && r.direction === "IN").length;
                const outCount = rs.filter((r) => r.include && r.direction === "OUT").length;
                return (
                  <tbody key={p.sha256} className="divide-y divide-slate-100 border-t-2 border-slate-200">
                    <tr className="bg-slate-50/70">
                      <td colSpan={7} className="px-3 py-2">
                        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                          <span className="font-medium text-slate-900">{p.filename}</span>
                          {p.statementDateIso && <span className="text-[13px] text-slate-600">izvod od {formatDate(p.statementDateIso)}</span>}
                          <span className="text-[13px] text-slate-600">
                            {rs.length} stavki, za uvoz {inCount} uplata i {outCount} isplata
                            {p.skipped > 0 && `, ${p.skipped} bez iznosa preskočeno`}
                          </span>
                        </div>
                        {p.alreadyImportedAt && (
                          <p className="mt-1 text-[13px] text-amber-800">
                            Ovaj izvod je već uvezen {formatDateTime(p.alreadyImportedAt)} — stavke nisu označene za uvoz.
                          </p>
                        )}
                        {p.accountMismatch && (
                          <p className="mt-1 text-[13px] text-amber-800">
                            Broj računa u izvodu ({p.ownAccountNumber}) ne izgleda kao odabrani račun. Provjerite izbor računa.
                          </p>
                        )}
                      </td>
                    </tr>
                    {rs.map((r, ri) => (
                      <tr key={ri} className={r.include ? "" : "opacity-50"}>
                        <td className="px-2 py-1.5">
                          <input
                            type="checkbox"
                            aria-label="Uvezi stavku"
                            checked={r.include}
                            onChange={(e) => updateRow(si, ri, { include: e.target.checked })}
                          />
                        </td>
                        <td className="px-2 py-1.5">
                          <span
                            className={`inline-block rounded px-1.5 py-0.5 text-[13px] font-medium ${
                              r.direction === "IN" ? "bg-emerald-50 text-emerald-800" : "bg-amber-50 text-amber-800"
                            }`}
                          >
                            {r.direction === "IN" ? "uplata" : "isplata"}
                          </span>
                        </td>
                        <td className="px-2 py-1.5">
                          <input type="date" value={r.date} onChange={(e) => updateRow(si, ri, { date: e.target.value })} className={`w-36 ${cellInputCls}`} />
                        </td>
                        <td className="px-2 py-1.5">
                          <input value={r.amount} onChange={(e) => updateRow(si, ri, { amount: e.target.value })} className={`w-24 text-right ${cellInputCls}`} />
                        </td>
                        <td className="px-2 py-1.5">
                          <input value={r.payerNameRaw} onChange={(e) => updateRow(si, ri, { payerNameRaw: e.target.value })} className={`w-40 ${cellInputCls}`} />
                        </td>
                        <td className="px-2 py-1.5">
                          <input value={r.purposeRaw} onChange={(e) => updateRow(si, ri, { purposeRaw: e.target.value })} className={`w-56 ${cellInputCls}`} />
                        </td>
                        <td className="px-2 py-1.5">
                          {r.direction === "IN" ? (
                            <select
                              value={r.invoiceId ?? ""}
                              onChange={(e) => updateRow(si, ri, { invoiceId: e.target.value || null })}
                              className={`w-64 ${cellInputCls}`}
                            >
                              <option value="">— ne uparuj sada —</option>
                              {invoiceOptions.map((o) => (
                                <option key={o.id} value={o.id}>{o.label}</option>
                              ))}
                            </select>
                          ) : (
                            <div className="space-y-1">
                              <select
                                value={r.expenseId ?? ""}
                                onChange={(e) => updateRow(si, ri, { expenseId: e.target.value || null })}
                                className={`w-64 ${cellInputCls}`}
                              >
                                <option value="">— bez veze (opšti izlaz) —</option>
                                {expenseOptions.map((o) => (
                                  <option key={o.id} value={o.id}>{o.label}</option>
                                ))}
                              </select>
                              {!r.expenseId && (
                                <input
                                  value={r.categoryName}
                                  onChange={(e) => updateRow(si, ri, { categoryName: e.target.value })}
                                  placeholder="kategorija (opciono)"
                                  className={`w-64 ${cellInputCls}`}
                                />
                              )}
                            </div>
                          )}
                          {r.matchHint && <p className="mt-1 max-w-64 text-[13px] text-slate-500">Predlog: {r.matchHint}</p>}
                          {r.duplicateOf && (
                            <p className="mt-1 max-w-64 text-[13px] text-amber-800">
                              Već evidentirano preko SMS obavještenja (stavka nije označena za uvoz; pri uvozu se bilježi da je izvod potvrdio SMS).{" "}
                              {r.duplicateOf.paymentId && (
                                <Link href={`/fakture/uplate/${r.duplicateOf.paymentId}`} className="font-medium underline underline-offset-2">
                                  Pogledaj uplatu
                                </Link>
                              )}
                            </p>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                );
              })}
            </table>
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={handleCommit}
              disabled={pending || (includedCount === 0 && smsConfirmCount === 0)}
              className={`${btnBase} ${btnVariantCls.primary}`}
            >
              {pending
                ? "Uvozim…"
                : includedCount === 0 && smsConfirmCount > 0
                  ? `Potvrdi SMS stavke izvodom (${smsConfirmCount})`
                  : `Uvezi (${includedCount})`}
            </button>
            <button type="button" onClick={handleCancel} disabled={pending} className={`${btnBase} ${btnVariantCls.secondary}`}>
              Odustani
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
