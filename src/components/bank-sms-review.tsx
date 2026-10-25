"use client";
// The SMS booking queue (Plans/bank-sms-ingestion-plan.md, O3/O6): every row here came from a
// bank SMS that the phone forwarded to /api/uplate/sms. NOTHING is booked until the accountant
// reviews the row and presses "Potvrdi označene" — same contract as the PDF statement import
// (pdf-statement-import.tsx), which this component mirrors. Rows with anything to double-check
// (unknown account, possibly already imported from a statement) arrive un-ticked.
// Since v2.49.0 (F5b) the table is the shared ReviewTable primitive; the server actions are unchanged.
import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { confirmBankSmsAction, dismissBankSmsAction } from "@/server/actions/bankSms";
import type { BankSmsReview, BankSmsReviewRow } from "@/server/services/bankSms";
import { btnBase, btnVariantCls, inputCls, ConfirmAction, Field, Flash } from "@/components/ui";
import { ReviewTable, DirectionBadge, fieldLabel, reviewField, reviewFieldW, reviewMono } from "@/components/review-table";
import { formatDateTime, t, tf } from "@/lib/i18n";
import { formatKm, reviewSummary } from "@/lib/reviewSummary";

export function BankSmsReviewTable({
  review, canConfirm, receiptEnabled,
}: {
  review: BankSmsReview;
  canConfirm: boolean;
  /** Automatski prijem SMS-a je uključen (inače prazno stanje to kaže, umjesto da obećava da poruke stižu). */
  receiptEnabled: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [rows, setRows] = useState<BankSmsReviewRow[]>(review.rows);
  const [error, setError] = useState<string | null>(null);

  function updateRow(i: number, patch: Partial<BankSmsReviewRow>) {
    setRows((rs) => rs.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));
  }

  const included = rows.filter((r) => r.include);
  const summary = reviewSummary(rows.map((r) => ({ include: r.include, direction: r.kind === "PRILIV" ? "IN" : "OUT", amount: r.amount })));

  function handleConfirm() {
    setError(null);
    if (included.length === 0) {
      setError(t("smsReview.errNoneSelected"));
      return;
    }
    if (included.some((r) => !r.accountId)) {
      setError(t("smsReview.errNeedAccount"));
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
      const note = tf("smsReview.done", { broj: res.confirmed });
      router.replace(`/fakture/uplate/sms?msg=${encodeURIComponent(note)}`);
      router.refresh();
    });
  }

  if (rows.length === 0) {
    return (
      <div className="py-8 text-center">
        <div className="text-[15px] font-medium text-slate-700">
          {receiptEnabled ? t("smsReview.emptyTitle") : t("smsReceiptOff.title")}
        </div>
        <p className="mx-auto mt-1 max-w-md text-[13px] text-slate-500">
          {receiptEnabled ? (
            t("smsReview.emptyHint")
          ) : (
            <>
              {t("smsReceiptOff.hint")}{" "}
              <Link href="/podesavanja" className="font-medium text-primary-ink underline-offset-2 hover:underline">
                {t("smsReceiptOff.link")}
              </Link>
            </>
          )}
        </p>
      </div>
    );
  }

  const columns = [
    { label: t("smsReview.cols.received"), nowrap: true },
    { label: t("reviewTable.cols.direction") },
    { label: t("smsReview.cols.account") },
    { label: t("reviewTable.cols.date") },
    { label: t("reviewTable.cols.amount"), align: "right" as const },
    { label: t("reviewTable.cols.payer") },
    { label: t("smsReview.cols.purpose") },
    { label: t("reviewTable.cols.target") },
    ...(canConfirm ? [{ label: t("smsReview.cols.actions") }] : []),
  ];

  return (
    <div>
      {error && (
        <div className="mb-3">
          <Flash err={error} inset />
        </div>
      )}
      <p className="mb-3 text-sm text-slate-600">
        {tf("smsReview.intro", { broj: rows.length })}
        {!canConfirm && ` ${t("smsReview.onlyAccountant")}`}
      </p>
      <ReviewTable
        id="review-sms"
        caption={t("smsReview.title")}
        columns={columns}
        groups={[{ key: "sms", rows }]}
        isSelected={canConfirm ? (r) => r.include : undefined}
        onToggle={canConfirm ? (_g, i, checked) => updateRow(i, { include: checked }) : undefined}
        selectLabel={t("smsReview.cols.select")}
        cardTitle={(r) => `${formatKm(r.amount)} · ${r.payerNameRaw || "—"}`}
        summary={summary}
        actions={
          canConfirm ? (
            <button
              type="button"
              onClick={handleConfirm}
              disabled={pending || included.length === 0}
              className={`${btnBase} ${btnVariantCls.primary}`}
            >
              {pending ? t("smsReview.confirming") : tf("smsReview.confirm", { broj: included.length })}
            </button>
          ) : undefined
        }
        renderCells={(r, { rowNumber, rowIndex: i }) => [
          <span key="recv" className="whitespace-nowrap text-[13px] text-slate-600">{formatDateTime(new Date(r.receivedAt))}</span>,
          <DirectionBadge key="dir" direction={r.kind === "PRILIV" ? "IN" : "OUT"} />,
          <div key="acc" className="space-y-1">
            <select
              value={r.accountId}
              disabled={!canConfirm}
              onChange={(e) => updateRow(i, { accountId: e.target.value })}
              className={`${reviewField} md:min-w-40`}
              aria-label={fieldLabel(t("smsReview.cols.account"), rowNumber)}
            >
              <option value="">{t("smsReview.chooseAccount")}</option>
              {review.accounts.map((a) => (
                <option key={a.id} value={a.id}>{a.name}</option>
              ))}
            </select>
            {r.ownAccount && <div className={reviewMono}>{r.ownAccount}</div>}
          </div>,
          <input
            key="date"
            type="date"
            value={r.date}
            disabled={!canConfirm}
            onChange={(e) => updateRow(i, { date: e.target.value })}
            className={`${reviewField} ${reviewFieldW.date}`}
            aria-label={fieldLabel(t("reviewTable.cols.date"), rowNumber)}
          />,
          <input
            key="amount"
            value={r.amount}
            inputMode="decimal"
            disabled={!canConfirm}
            onChange={(e) => updateRow(i, { amount: e.target.value })}
            className={`${reviewField} ${reviewFieldW.amount}`}
            aria-label={fieldLabel(t("reviewTable.cols.amount"), rowNumber)}
          />,
          <div key="payer" className="space-y-1">
            <input
              value={r.payerNameRaw}
              disabled={!canConfirm}
              onChange={(e) => updateRow(i, { payerNameRaw: e.target.value })}
              className={`${reviewField} ${reviewFieldW.text}`}
              aria-label={fieldLabel(t("reviewTable.cols.payer"), rowNumber)}
            />
            {r.counterpartyAccount && <div className={reviewMono}>{r.counterpartyAccount}</div>}
          </div>,
          <input
            key="purpose"
            value={r.purposeRaw}
            disabled={!canConfirm}
            onChange={(e) => updateRow(i, { purposeRaw: e.target.value })}
            className={`${reviewField} ${reviewFieldW.wide}`}
            aria-label={fieldLabel(t("smsReview.cols.purpose"), rowNumber)}
          />,
          <div key="target" className="space-y-1.5">
            {r.kind === "PRILIV" ? (
              <select
                value={r.invoiceId ?? ""}
                disabled={!canConfirm}
                onChange={(e) => updateRow(i, { invoiceId: e.target.value || null })}
                className={`${reviewField} ${reviewFieldW.select}`}
                aria-label={fieldLabel(t("smsReview.invoice"), rowNumber)}
              >
                <option value="">{t("reviewTable.invoicePlaceholder")}</option>
                {review.invoiceOptions.map((o) => (
                  <option key={o.id} value={o.id}>{o.label}</option>
                ))}
              </select>
            ) : (
              <>
                <select
                  value={r.expenseId ?? ""}
                  disabled={!canConfirm}
                  onChange={(e) => updateRow(i, { expenseId: e.target.value || null })}
                  className={`${reviewField} ${reviewFieldW.select}`}
                  aria-label={fieldLabel(t("smsReview.expense"), rowNumber)}
                >
                  <option value="">{t("reviewTable.expensePlaceholder")}</option>
                  {review.expenseOptions.map((o) => (
                    <option key={o.id} value={o.id}>{o.label}</option>
                  ))}
                </select>
                {!r.expenseId && (
                  <input
                    value={r.categoryName}
                    disabled={!canConfirm}
                    onChange={(e) => updateRow(i, { categoryName: e.target.value })}
                    placeholder={t("smsReview.categoryPlaceholder")}
                    className={`${reviewField} ${reviewFieldW.select}`}
                    aria-label={fieldLabel(t("smsReview.category"), rowNumber)}
                  />
                )}
              </>
            )}
            {r.matchHint && <p className="max-w-72 text-[13px] text-slate-600">{tf("reviewTable.hint", { razlog: r.matchHint })}</p>}
            {r.warnings.map((w) => (
              <Flash key={w} warn={w} inset />
            ))}
          </div>,
          ...(canConfirm
            ? [
                <ConfirmAction
                  key="dismiss"
                  trigger={t("smsReview.dismiss.trigger")}
                  title={t("smsReview.dismiss.title")}
                  body={<p className="text-sm text-amber-900">{t("smsReview.dismiss.body")}</p>}
                  confirmLabel={t("smsReview.dismiss.confirm")}
                  action={dismissBankSmsAction}
                  hiddenFields={{ smsId: r.id }}
                >
                  <Field label={t("smsReview.dismiss.reason")}>
                    <input name="reason" required className={inputCls} />
                  </Field>
                </ConfirmAction>,
              ]
            : []),
        ]}
      />
    </div>
  );
}
