"use client";
// Two-step PDF bank-statement import: parse (server action, writes nothing) -> the
// accountant reviews/edits every row in an editable table -> commit (server action,
// writes exactly what was reviewed). Unlike the CSV import, nothing is written to the
// database until this component's user explicitly confirms — see importPdfPreview()/
// commitPdfImport() in payments.ts for why reading a PDF's text layer isn't trusted
// the same way structured CSV columns are.
// Since v2.39.0 several statements can be chosen at once (FilePicker); they are reviewed in one
// table grouped by statement and imported together, each still as its own import batch.
// Since v2.49.0 (F5b) the review step is the shared ReviewTable primitive; the server actions are unchanged.
import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { parsePdfPreviewsAction, commitPdfImportsAction } from "@/server/actions/bankPdfImport";
import type { PdfPreviewRow, PdfStatementPreview } from "@/server/services/payments";
import { inputCls, btnBase, btnVariantCls, BtnLink, Flash } from "@/components/ui";
import { FilePicker } from "@/components/file-picker";
import { ReviewTable, DirectionBadge, fieldLabel, reviewField, reviewFieldW, type ReviewGroup } from "@/components/review-table";
import { formatDate, formatDateTime, t, tf } from "@/lib/i18n";
import { formatKm, pluralForm, reviewSummary } from "@/lib/reviewSummary";

type Account = { id: string; name: string };

// Server actions accept up to MAX_UPLOAD_MB (default 4 MB, next.config.ts) per request.
const MAX_TOTAL_BYTES = 4 * 1024 * 1024;
const MAX_FILES = 31;

type ImportDone = { imported: number; statements: number; linkedToSms: number; inTotal: string; outTotal: string };

async function sha256Hex(file: File): Promise<string | null> {
  if (!globalThis.crypto?.subtle) return null; // non-secure context: the server then skips the check
  const digest = await crypto.subtle.digest("SHA-256", await file.arrayBuffer());
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** „N uplata čeka uparivanje” u ispravnom obliku množine. */
function pendingSentence(count: number): string {
  if (count <= 0) return t("pdfImport.pendingNone");
  const form = pluralForm(count);
  return tf(form === "one" ? "pdfImport.pendingOne" : form === "few" ? "pdfImport.pendingFew" : "pdfImport.pendingMany", { broj: count });
}

/** `toMatchCount` je broj uplata „za uparivanje” (isti upit kao filter `ZA_UPARIVANJE`); stranica ga osvježava poslije uvoza. */
export function PdfStatementImport({ accounts, toMatchCount }: { accounts: Account[]; toMatchCount: number }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [accountId, setAccountId] = useState(accounts[0]?.id ?? "");
  const [files, setFiles] = useState<File[]>([]);
  const [previews, setPreviews] = useState<PdfStatementPreview[] | null>(null);
  const [rows, setRows] = useState<PdfPreviewRow[][]>([]);
  const [failures, setFailures] = useState<{ filename: string; error: string }[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<ImportDone | null>(null);

  function handleParse(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setDone(null);
    if (files.length === 0) {
      setError(t("pdfImport.errNoFile"));
      return;
    }
    if (files.length > MAX_FILES) {
      setError(tf("pdfImport.errTooMany", { broj: MAX_FILES }));
      return;
    }
    if (files.reduce((n, f) => n + f.size, 0) > MAX_TOTAL_BYTES) {
      setError(t("pdfImport.errTooBig"));
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
      setError(t("pdfImport.errNoneSelected"));
      return;
    }
    const totals = reviewSummary(rows.flat());
    startTransition(async () => {
      const res = await commitPdfImportsAction({ accountId, statements });
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setDone({ imported: res.imported, statements: res.statements, linkedToSms: res.linkedToSms, inTotal: totals.inTotal, outTotal: totals.outTotal });
      reset();
      router.refresh();
    });
  }

  const flat = rows.flat();
  const summary = reviewSummary(flat);
  const smsConfirmCount = flat.filter((r) => !r.include && r.duplicateOf).length;
  const invoiceOptions = previews?.[0]?.invoiceOptions ?? [];
  const expenseOptions = previews?.[0]?.expenseOptions ?? [];

  const groups: ReviewGroup<PdfPreviewRow>[] = (previews ?? []).map((p, si) => {
    const rs = rows[si] ?? [];
    const inCount = rs.filter((r) => r.include && r.direction === "IN").length;
    const outCount = rs.filter((r) => r.include && r.direction === "OUT").length;
    return {
      key: p.sha256,
      rows: rs,
      header: (
        <div className="space-y-2">
          <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <span className="font-medium text-ink">{p.filename}</span>
            {p.statementDateIso && <span className="text-[13px] text-slate-600">{tf("pdfImport.statementOf", { datum: formatDate(p.statementDateIso) })}</span>}
            <span className="text-[13px] text-slate-600">
              {tf("pdfImport.statementCounts", { stavki: rs.length, uplata: inCount, isplata: outCount })}
              {p.skipped > 0 && `, ${tf("pdfImport.skipped", { broj: p.skipped })}`}
            </span>
          </div>
          {p.alreadyImportedAt && <Flash warn={tf("pdfImport.alreadyImported", { datum: formatDateTime(p.alreadyImportedAt) })} inset />}
          {p.accountMismatch && <Flash warn={tf("pdfImport.accountMismatch", { broj: p.ownAccountNumber ?? "" })} inset />}
        </div>
      ),
    };
  });

  return (
    <div>
      <div className="space-y-3 empty:hidden">
        {error && <Flash err={error} inset />}
        {done && (
          <Flash
            inset
            msg={
              <div className="space-y-2">
                <p>
                  {tf("pdfImport.done", {
                    broj: done.imported,
                    izvoda: done.statements,
                    ulaz: formatKm(done.inTotal),
                    izlaz: formatKm(done.outTotal),
                  })}
                  {done.linkedToSms > 0 && ` ${tf("pdfImport.linkedSms", { broj: done.linkedToSms })}`}
                </p>
                <p className="font-medium">{pendingSentence(toMatchCount)}</p>
                {toMatchCount > 0 && (
                  <BtnLink href="/fakture/uplate?status=ZA_UPARIVANJE" variant="secondary">{t("pdfImport.matchNow")}</BtnLink>
                )}
              </div>
            }
          />
        )}
      </div>

      {!previews && (
        <form onSubmit={handleParse} className={`space-y-3 ${error || done ? "mt-3" : ""}`}>
          <FilePicker
            label={t("pdfImport.filesLabel")}
            buttonLabel={t("pdfImport.pick")}
            hint={t("pdfImport.pickHint")}
            accept=".pdf,application/pdf"
            multiple
            files={files}
            onChange={setFiles}
            disabled={pending}
          />
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <label className="block text-sm">
              <span className="mb-1 block font-medium text-slate-700">{t("pdfImport.account")}</span>
              <select value={accountId} onChange={(e) => setAccountId(e.target.value)} className={inputCls}>
                {accounts.map((a) => (
                  <option key={a.id} value={a.id}>{a.name}</option>
                ))}
              </select>
            </label>
            <div className="flex items-end">
              <button type="submit" disabled={pending || files.length === 0} className={`${btnBase} ${btnVariantCls.primary}`}>
                {pending ? t("pdfImport.loading") : files.length > 1 ? tf("pdfImport.loadMany", { broj: files.length }) : t("pdfImport.load")}
              </button>
            </div>
          </div>
        </form>
      )}

      {previews && (
        <div className="mt-3 space-y-3">
          {failures.length > 0 && (
            <Flash
              inset
              warn={
                <div>
                  <p className="font-medium">{tf("pdfImport.failedTitle", { broj: failures.length })}</p>
                  <ul className="mt-1 list-disc pl-5">
                    {failures.map((f) => (
                      <li key={f.filename}>{f.filename}: {f.error}</li>
                    ))}
                  </ul>
                </div>
              }
            />
          )}
          <p className="text-sm text-slate-600">{tf("pdfImport.intro", { stavki: flat.length, izvoda: previews.length })}</p>
          <ReviewTable
            id="review-pdf"
            caption={t("pdfImport.title")}
            columns={[
              { label: t("reviewTable.cols.direction") },
              { label: t("reviewTable.cols.date") },
              { label: t("reviewTable.cols.amount"), align: "right" },
              { label: t("reviewTable.cols.payer") },
              { label: t("reviewTable.cols.purpose") },
              { label: t("reviewTable.cols.target") },
            ]}
            groups={groups}
            isSelected={(r) => r.include}
            onToggle={(si, ri, checked) => updateRow(si, ri, { include: checked })}
            cardTitle={(r) => `${formatKm(r.amount)} · ${r.payerNameRaw || "—"}`}
            renderCells={(r, { rowNumber, groupIndex: si, rowIndex: ri }) => [
              <DirectionBadge key="d" direction={r.direction} />,
              <input
                key="date"
                type="date"
                value={r.date}
                aria-label={fieldLabel(t("reviewTable.cols.date"), rowNumber)}
                onChange={(e) => updateRow(si, ri, { date: e.target.value })}
                className={`${reviewField} ${reviewFieldW.date}`}
              />,
              <input
                key="amount"
                value={r.amount}
                inputMode="decimal"
                aria-label={fieldLabel(t("reviewTable.cols.amount"), rowNumber)}
                onChange={(e) => updateRow(si, ri, { amount: e.target.value })}
                className={`${reviewField} ${reviewFieldW.amount}`}
              />,
              <input
                key="payer"
                value={r.payerNameRaw}
                aria-label={fieldLabel(t("reviewTable.cols.payer"), rowNumber)}
                onChange={(e) => updateRow(si, ri, { payerNameRaw: e.target.value })}
                className={`${reviewField} ${reviewFieldW.text}`}
              />,
              <input
                key="purpose"
                value={r.purposeRaw}
                aria-label={fieldLabel(t("reviewTable.cols.purpose"), rowNumber)}
                onChange={(e) => updateRow(si, ri, { purposeRaw: e.target.value })}
                className={`${reviewField} ${reviewFieldW.wide}`}
              />,
              <div key="target" className="space-y-1.5">
                {r.direction === "IN" ? (
                  <select
                    value={r.invoiceId ?? ""}
                    aria-label={fieldLabel(t("reviewTable.cols.target"), rowNumber)}
                    onChange={(e) => updateRow(si, ri, { invoiceId: e.target.value || null })}
                    className={`${reviewField} ${reviewFieldW.select}`}
                  >
                    <option value="">{t("reviewTable.invoicePlaceholder")}</option>
                    {invoiceOptions.map((o) => (
                      <option key={o.id} value={o.id}>{o.label}</option>
                    ))}
                  </select>
                ) : (
                  <>
                    <select
                      value={r.expenseId ?? ""}
                      aria-label={fieldLabel(t("reviewTable.cols.target"), rowNumber)}
                      onChange={(e) => updateRow(si, ri, { expenseId: e.target.value || null })}
                      className={`${reviewField} ${reviewFieldW.select}`}
                    >
                      <option value="">{t("reviewTable.expensePlaceholder")}</option>
                      {expenseOptions.map((o) => (
                        <option key={o.id} value={o.id}>{o.label}</option>
                      ))}
                    </select>
                    {!r.expenseId && (
                      <input
                        value={r.categoryName}
                        onChange={(e) => updateRow(si, ri, { categoryName: e.target.value })}
                        placeholder={t("reviewTable.categoryPlaceholder")}
                        aria-label={fieldLabel(t("reviewTable.categoryPlaceholder"), rowNumber)}
                        className={`${reviewField} ${reviewFieldW.select}`}
                      />
                    )}
                  </>
                )}
                {r.matchHint && <p className="max-w-72 text-[13px] text-slate-600">{tf("reviewTable.hint", { razlog: r.matchHint })}</p>}
                {r.duplicateOf && (
                  <Flash
                    inset
                    warn={
                      <span>
                        {t("pdfImport.smsDuplicate")}{" "}
                        {r.duplicateOf.paymentId && (
                          <Link href={`/fakture/uplate/${r.duplicateOf.paymentId}`} className="font-medium underline underline-offset-2">
                            {t("pdfImport.viewPayment")}
                          </Link>
                        )}
                      </span>
                    }
                  />
                )}
              </div>,
            ]}
            summary={summary}
            actions={
              <>
                <button
                  type="button"
                  onClick={handleCommit}
                  disabled={pending || (summary.selected === 0 && smsConfirmCount === 0)}
                  className={`${btnBase} ${btnVariantCls.primary}`}
                >
                  {pending
                    ? t("pdfImport.committing")
                    : summary.selected === 0 && smsConfirmCount > 0
                      ? tf("pdfImport.commitSms", { broj: smsConfirmCount })
                      : tf("pdfImport.commit", { broj: summary.selected })}
                </button>
                <button type="button" onClick={handleCancel} disabled={pending} className={`${btnBase} ${btnVariantCls.secondary}`}>
                  {t("pdfImport.cancel")}
                </button>
              </>
            }
          />
        </div>
      )}
    </div>
  );
}
