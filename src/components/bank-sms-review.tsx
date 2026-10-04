"use client";
// The SMS booking queue (Plans/bank-sms-ingestion-plan.md, O3/O6): every row here came from a
// bank SMS that the phone forwarded to /api/uplate/sms. NOTHING is booked until the accountant
// reviews the row and presses "Potvrdi označene" — same contract as the PDF statement import
// (pdf-statement-import.tsx), which this component mirrors. Rows with anything to double-check
// (unknown account, possibly already imported from a statement) arrive un-ticked.
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { confirmBankSmsAction, dismissBankSmsAction } from "@/server/actions/bankSms";
import type { BankSmsReview, BankSmsReviewRow } from "@/server/services/bankSms";
import { btnBase, btnVariantCls, inputCls, ConfirmAction, Field, StatusBadge } from "@/components/ui";
import { formatDateTime } from "@/lib/i18n";

export function BankSmsReviewTable({ review, canConfirm }: { review: BankSmsReview; canConfirm: boolean }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [rows, setRows] = useState<BankSmsReviewRow[]>(review.rows);
  const [error, setError] = useState<string | null>(null);

  function updateRow(i: number, patch: Partial<BankSmsReviewRow>) {
    setRows((rs) => rs.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));
  }

  const included = rows.filter((r) => r.include);

  function handleConfirm() {
    setError(null);
    if (included.length === 0) {
      setError("Nijedna stavka nije označena.");
      return;
    }
    if (included.some((r) => !r.accountId)) {
      setError("Izaberite bankovni račun za svaku označenu stavku.");
      return;
    }
    startTransition(async () => {
      const res = await confirmBankSmsAction(
        included.map((r) => ({
          smsId: r.id,
          accountId: r.accountId,
          date: r.date,
          amount: r.amount,
          payerNameRaw: r.payerNameRaw,
          purposeRaw: r.purposeRaw,
          invoiceId: r.invoiceId,
          expenseId: r.expenseId,
          categoryName: r.categoryName,
        }))
      );
      if (!res.ok) {
        setError(res.error);
        return;
      }
      // The page re-renders with the remaining rows (it keys this component by the row ids, so the
      // local edit state resets) and shows the confirmation as a Flash taken from the URL.
      const note = `Proknjiženo ${res.confirmed} stavki. Uplate sa izabranom fakturom su odmah raspoređene — ostale pogledajte u „Uplate i uparivanje“.`;
      router.replace(`/fakture/uplate/sms?msg=${encodeURIComponent(note)}`);
      router.refresh();
    });
  }

  if (rows.length === 0) {
    return (
      <div className="py-8 text-center">
        <div className="text-[15px] font-medium text-slate-700">Nema poruka na čekanju.</div>
        <p className="mx-auto mt-1 max-w-md text-[13px] text-slate-500">
          Nove SMS poruke banke pojavljuju se ovdje nekoliko sekundi nakon što stignu na telefon. Poruke koje aplikacija nije
          prepoznala nalaze se na kartici „Neprepoznate“.
        </p>
      </div>
    );
  }

  return (
    <div>
      {error && (
        <div role="alert" className="mb-3 rounded-xl border-l-4 border-l-red-500 bg-red-50 px-3 py-2.5 text-sm text-red-800 shadow-sm">
          {error}
        </div>
      )}
      {rows.length > 0 && (
        <>
          <p className="mb-3 text-sm text-slate-600">
            {rows.length} poruka čeka pregled. Provjerite/ispravite stavke ispod — ništa nije proknjiženo dok ne potvrdite.
            {!canConfirm && " Potvrdu može dati samo računovođa."}
          </p>
          <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50 text-left">
                  {canConfirm && <th className="px-2 py-2 text-[13px] font-medium text-slate-600">Knjiži</th>}
                  <th className="px-2 py-2 text-[13px] font-medium text-slate-600">Primljeno</th>
                  <th className="px-2 py-2 text-[13px] font-medium text-slate-600">Smjer</th>
                  <th className="px-2 py-2 text-[13px] font-medium text-slate-600">Račun</th>
                  <th className="px-2 py-2 text-[13px] font-medium text-slate-600">Datum</th>
                  <th className="px-2 py-2 text-right text-[13px] font-medium text-slate-600">Iznos</th>
                  <th className="px-2 py-2 text-[13px] font-medium text-slate-600">Platilac / primalac</th>
                  <th className="px-2 py-2 text-[13px] font-medium text-slate-600">Svrha</th>
                  <th className="px-2 py-2 text-[13px] font-medium text-slate-600">Faktura / trošak</th>
                  {canConfirm && <th className="px-2 py-2 text-[13px] font-medium text-slate-600">Radnje</th>}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {rows.map((r, i) => (
                  <tr key={r.id} className={canConfirm && !r.include ? "bg-slate-50/60" : ""}>
                    {canConfirm && (
                      <td className="px-2 py-2 align-top">
                        <input
                          type="checkbox"
                          aria-label={`Knjiži poruku ${i + 1}`}
                          checked={r.include}
                          onChange={(e) => updateRow(i, { include: e.target.checked })}
                        />
                      </td>
                    )}
                    <td className="whitespace-nowrap px-2 py-2 align-top text-[13px] text-slate-600">
                      {formatDateTime(new Date(r.receivedAt))}
                    </td>
                    <td className="px-2 py-2 align-top">
                      <StatusBadge status={r.kind === "PRILIV" ? "PAID" : "UNPAID"} label={r.kind === "PRILIV" ? "uplata" : "isplata"} />
                    </td>
                    <td className="px-2 py-2 align-top">
                      <select
                        value={r.accountId}
                        disabled={!canConfirm}
                        onChange={(e) => updateRow(i, { accountId: e.target.value })}
                        className={`${inputCls} min-w-40`}
                        aria-label="Račun"
                      >
                        <option value="">— izaberite račun —</option>
                        {review.accounts.map((a) => (
                          <option key={a.id} value={a.id}>{a.name}</option>
                        ))}
                      </select>
                      {r.ownAccount && <div className="mt-1 font-mono text-[13px] text-slate-500">{r.ownAccount}</div>}
                    </td>
                    <td className="px-2 py-2 align-top">
                      <input
                        type="date"
                        value={r.date}
                        disabled={!canConfirm}
                        onChange={(e) => updateRow(i, { date: e.target.value })}
                        className={`${inputCls} min-w-40`}
                        aria-label="Datum"
                      />
                    </td>
                    <td className="px-2 py-2 align-top">
                      <input
                        value={r.amount}
                        disabled={!canConfirm}
                        onChange={(e) => updateRow(i, { amount: e.target.value })}
                        className={`${inputCls} min-w-28 text-right tabular-nums`}
                        aria-label="Iznos"
                      />
                    </td>
                    <td className="px-2 py-2 align-top">
                      <input
                        value={r.payerNameRaw}
                        disabled={!canConfirm}
                        onChange={(e) => updateRow(i, { payerNameRaw: e.target.value })}
                        className={`${inputCls} min-w-48`}
                        aria-label="Platilac / primalac"
                      />
                      {r.counterpartyAccount && (
                        <div className="mt-1 font-mono text-[13px] text-slate-500">{r.counterpartyAccount}</div>
                      )}
                    </td>
                    <td className="px-2 py-2 align-top">
                      <input
                        value={r.purposeRaw}
                        disabled={!canConfirm}
                        onChange={(e) => updateRow(i, { purposeRaw: e.target.value })}
                        className={`${inputCls} min-w-56`}
                        aria-label="Svrha"
                      />
                    </td>
                    <td className="px-2 py-2 align-top">
                      {r.kind === "PRILIV" ? (
                        <select
                          value={r.invoiceId ?? ""}
                          disabled={!canConfirm}
                          onChange={(e) => updateRow(i, { invoiceId: e.target.value || null })}
                          className={`${inputCls} min-w-64`}
                          aria-label="Faktura"
                        >
                          <option value="">— ne uparuj sada —</option>
                          {review.invoiceOptions.map((o) => (
                            <option key={o.id} value={o.id}>{o.label}</option>
                          ))}
                        </select>
                      ) : (
                        <div className="space-y-1">
                          <select
                            value={r.expenseId ?? ""}
                            disabled={!canConfirm}
                            onChange={(e) => updateRow(i, { expenseId: e.target.value || null })}
                            className={`${inputCls} min-w-64`}
                            aria-label="Trošak"
                          >
                            <option value="">— bez veze (opšti izlaz) —</option>
                            {review.expenseOptions.map((o) => (
                              <option key={o.id} value={o.id}>{o.label}</option>
                            ))}
                          </select>
                          {!r.expenseId && (
                            <input
                              value={r.categoryName}
                              disabled={!canConfirm}
                              onChange={(e) => updateRow(i, { categoryName: e.target.value })}
                              placeholder="kategorija (opciono), npr. Bankarske naknade"
                              className={`${inputCls} min-w-64`}
                              aria-label="Kategorija"
                            />
                          )}
                        </div>
                      )}
                      {r.matchHint && <p className="mt-1 max-w-72 text-[13px] text-slate-500">Prijedlog: {r.matchHint}</p>}
                      {r.warnings.map((w) => (
                        <p key={w} className="mt-1 max-w-72 text-[13px] text-amber-800">{w}</p>
                      ))}
                    </td>
                    {canConfirm && (
                      <td className="px-2 py-2 align-top">
                        <ConfirmAction
                          trigger="Odbaci"
                          title="Odbacivanje poruke"
                          body={<p className="text-sm text-amber-900">Ništa se ne knjiži. Poruka se zatvara, a razlog ostaje u evidenciji.</p>}
                          confirmLabel="Da, odbaci poruku"
                          action={dismissBankSmsAction}
                          hiddenFields={{ smsId: r.id }}
                        >
                          <Field label="Razlog">
                            <input name="reason" required className={inputCls} />
                          </Field>
                        </ConfirmAction>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {canConfirm && (
            <div className="mt-3">
              <button
                type="button"
                onClick={handleConfirm}
                disabled={pending || included.length === 0}
                className={`${btnBase} ${btnVariantCls.primary}`}
              >
                {pending ? "Knjižim…" : `Potvrdi označene (${included.length})`}
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
