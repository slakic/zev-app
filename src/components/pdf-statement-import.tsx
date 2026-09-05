"use client";
// Two-step PDF bank-statement import: parse (server action, writes nothing) -> the
// accountant reviews/edits every row in an editable table -> commit (server action,
// writes exactly what was reviewed). Unlike the CSV import, nothing is written to the
// database until this component's user explicitly confirms — see importPdfPreview()/
// commitPdfImport() in payments.ts for why reading a PDF's text layer isn't trusted
// the same way structured CSV columns are.
import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { parsePdfPreviewAction, commitPdfImportAction } from "@/server/actions/bankPdfImport";
import type { PdfImportPreview, PdfPreviewRow } from "@/server/services/payments";
import { inputCls } from "@/components/ui";

type Account = { id: string; name: string };

export function PdfStatementImport({ accounts }: { accounts: Account[] }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [accountId, setAccountId] = useState(accounts[0]?.id ?? "");
  const [preview, setPreview] = useState<PdfImportPreview | null>(null);
  const [rows, setRows] = useState<PdfPreviewRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  function handleParse(formData: FormData) {
    setError(null);
    setMessage(null);
    formData.set("accountId", accountId);
    startTransition(async () => {
      const res = await parsePdfPreviewAction(formData);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setPreview(res.preview);
      setRows(res.preview.rows);
    });
  }

  function updateRow(i: number, patch: Partial<PdfPreviewRow>) {
    setRows((rs) => rs.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));
  }

  function handleCancel() {
    setPreview(null);
    setRows([]);
    setError(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
  }

  function handleCommit() {
    if (!preview) return;
    setError(null);
    const included = rows.filter((r) => r.include);
    if (included.length === 0) {
      setError("Nijedna stavka nije označena za uvoz.");
      return;
    }
    startTransition(async () => {
      const res = await commitPdfImportAction({
        accountId,
        filename: preview.filename,
        rawText: preview.rawText,
        rows: included.map((r) => ({
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
      });
      if (!res.ok) {
        setError(res.error);
        return;
      }
      const inCount = included.filter((r) => r.direction === "IN").length;
      const outCount = included.filter((r) => r.direction === "OUT").length;
      setMessage(
        `Uvezeno ${res.imported} stavki (${inCount} uplata, ${outCount} isplata). Uplate sa izabranom fakturom su odmah raspoređene — ` +
          `ostale pogledajte u tabeli ispod, u koloni "detalji/uparivanje".`
      );
      setPreview(null);
      setRows([]);
      if (fileInputRef.current) fileInputRef.current.value = "";
      router.refresh();
    });
  }

  const includedCount = rows.filter((r) => r.include).length;
  const inCount = rows.filter((r) => r.include && r.direction === "IN").length;
  const outCount = rows.filter((r) => r.include && r.direction === "OUT").length;

  return (
    <div>
      {error && (
        <div role="alert" className="mb-3 rounded-xl border-l-4 border-l-red-500 bg-red-50 px-3 py-2.5 text-sm text-red-800 shadow-sm">
          {error}
        </div>
      )}
      {message && (
        <div role="status" className="mb-3 rounded-xl border-l-4 border-l-emerald-500 bg-emerald-50 px-3 py-2.5 text-sm text-emerald-800 shadow-sm">
          {message}
        </div>
      )}

      {!preview && (
        <form action={handleParse} className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div className="sm:col-span-2">
            <label className="block text-sm">
              <span className="mb-1 block font-medium text-slate-700">PDF izvod</span>
              <input ref={fileInputRef} name="file" type="file" accept=".pdf,application/pdf" required className={inputCls} />
            </label>
          </div>
          <label className="block text-sm">
            <span className="mb-1 block font-medium text-slate-700">Račun</span>
            <select value={accountId} onChange={(e) => setAccountId(e.target.value)} className={inputCls}>
              {accounts.map((a) => (
                <option key={a.id} value={a.id}>{a.name}</option>
              ))}
            </select>
          </label>
          <div className="flex items-end">
            <button
              type="submit"
              disabled={pending}
              className="rounded-full border border-transparent bg-blue-600 px-4 py-1.5 text-sm font-medium text-white shadow-sm transition-all hover:bg-blue-700 hover:shadow active:scale-[0.97] disabled:opacity-50"
            >
              {pending ? "Čitam izvod…" : "Učitaj i pregledaj"}
            </button>
          </div>
        </form>
      )}

      {preview && (
        <div>
          {preview.accountMismatch && (
            <div className="mb-3 rounded-xl border-l-4 border-l-amber-500 bg-amber-50 px-3 py-2.5 text-sm text-amber-800 shadow-sm">
              Upozorenje: broj računa u izvodu ({preview.ownAccountNumber}) ne izgleda kao odabrani račun. Provjerite da li ste
              odabrali ispravan račun prije uvoza.
            </div>
          )}
          <p className="mb-3 text-sm text-slate-600">
            Prepoznato {rows.length} stavki iz &quot;{preview.filename}&quot; ({inCount} uplata, {outCount} isplata)
            {preview.statementDateIso ? ` (datum izvoda: ${preview.statementDateIso})` : ""}. Provjerite/ispravite ispod prije
            uvoza — ništa još nije sačuvano.
            {preview.skipped > 0 && ` (${preview.skipped} stavki bez iznosa preskočeno.)`}
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
              <tbody className="divide-y divide-slate-100">
                {rows.map((r, i) => (
                  <tr key={i} className={r.include ? "" : "opacity-50"}>
                    <td className="px-2 py-1.5">
                      <input
                        type="checkbox"
                        checked={r.include}
                        onChange={(e) => updateRow(i, { include: e.target.checked })}
                      />
                    </td>
                    <td className="px-2 py-1.5">
                      <span
                        className={`inline-block rounded px-1.5 py-0.5 text-xs font-medium ${
                          r.direction === "IN" ? "bg-emerald-50 text-emerald-800" : "bg-amber-50 text-amber-800"
                        }`}
                      >
                        {r.direction === "IN" ? "uplata" : "isplata"}
                      </span>
                    </td>
                    <td className="px-2 py-1.5">
                      <input
                        type="date"
                        value={r.date}
                        onChange={(e) => updateRow(i, { date: e.target.value })}
                        className="w-36 rounded border border-slate-300 px-1.5 py-1 text-xs"
                      />
                    </td>
                    <td className="px-2 py-1.5">
                      <input
                        value={r.amount}
                        onChange={(e) => updateRow(i, { amount: e.target.value })}
                        className="w-20 rounded border border-slate-300 px-1.5 py-1 text-xs text-right"
                      />
                    </td>
                    <td className="px-2 py-1.5">
                      <input
                        value={r.payerNameRaw}
                        onChange={(e) => updateRow(i, { payerNameRaw: e.target.value })}
                        className="w-40 rounded border border-slate-300 px-1.5 py-1 text-xs"
                      />
                    </td>
                    <td className="px-2 py-1.5">
                      <input
                        value={r.purposeRaw}
                        onChange={(e) => updateRow(i, { purposeRaw: e.target.value })}
                        className="w-56 rounded border border-slate-300 px-1.5 py-1 text-xs"
                      />
                    </td>
                    <td className="px-2 py-1.5">
                      {r.direction === "IN" ? (
                        <select
                          value={r.invoiceId ?? ""}
                          onChange={(e) => updateRow(i, { invoiceId: e.target.value || null })}
                          className="w-64 rounded border border-slate-300 px-1.5 py-1 text-xs"
                        >
                          <option value="">— ne uparuj sada —</option>
                          {preview.invoiceOptions.map((o) => (
                            <option key={o.id} value={o.id}>{o.label}</option>
                          ))}
                        </select>
                      ) : (
                        <div className="space-y-1">
                          <select
                            value={r.expenseId ?? ""}
                            onChange={(e) => updateRow(i, { expenseId: e.target.value || null })}
                            className="w-64 rounded border border-slate-300 px-1.5 py-1 text-xs"
                          >
                            <option value="">— bez veze (opšti izlaz) —</option>
                            {preview.expenseOptions.map((o) => (
                              <option key={o.id} value={o.id}>{o.label}</option>
                            ))}
                          </select>
                          {!r.expenseId && (
                            <input
                              value={r.categoryName}
                              onChange={(e) => updateRow(i, { categoryName: e.target.value })}
                              placeholder="kategorija (opciono)"
                              className="w-64 rounded border border-slate-300 px-1.5 py-1 text-xs"
                            />
                          )}
                        </div>
                      )}
                      {r.matchHint && <p className="mt-1 max-w-64 text-[11px] text-slate-400">Predlog: {r.matchHint}</p>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={handleCommit}
              disabled={pending || includedCount === 0}
              className="rounded-full border border-transparent bg-blue-600 px-4 py-1.5 text-sm font-medium text-white shadow-sm transition-all hover:bg-blue-700 hover:shadow active:scale-[0.97] disabled:opacity-50"
            >
              {pending ? "Uvozim…" : `Uvezi (${includedCount})`}
            </button>
            <button
              type="button"
              onClick={handleCancel}
              disabled={pending}
              className="rounded-full border border-slate-300 bg-white px-4 py-1.5 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50 disabled:opacity-50"
            >
              Odustani
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
