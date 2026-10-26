// Vote receipt (V-Q3, F4.3): rendered right after sending (client form) and again from `?potvrda={receiptId}` (server
// page) — hence no directive. Shows the proposal, who voted, when, the choice and the receipt number. The choice is
// read server-side by token + receipt id and is NEVER put in a URL.
import { Card, Flash } from "@/components/ui";
import { formatDateTime, t, tf } from "@/lib/i18n";
import { PrintButton } from "./print-button";

export type ReceiptView = {
  meetingTitle: string;
  voterName: string;
  submittedAt: string;
  closesAt: string | null;
  items: { code: string; title: string; voteId: string; choice: string }[];
  skipped: { code: string; title: string; reason: "closed" | "voted" }[];
};

const CHOICE_LABEL: Record<string, string> = {
  APPROVE: "ballot.page.reviewFor",
  REJECT: "ballot.page.reviewAgainst",
  ABSTAIN: "ballot.page.reviewAbstain",
};

export function VoteReceipt({ receipt: r }: { receipt: ReceiptView }) {
  return (
    <div>
      <Flash msg={t("ballot.receipt.done")} />
      <Card title={t("ballot.receipt.title")}>
        <dl className="grid grid-cols-1 gap-x-4 gap-y-1 text-[15px] sm:grid-cols-[auto_1fr]">
          <dt className="text-slate-600">{t("ballot.receipt.meeting")}</dt>
          <dd className="mb-2 text-slate-900 sm:mb-0">{r.meetingTitle}</dd>
          <dt className="text-slate-600">{t("ballot.receipt.voter")}</dt>
          <dd className="mb-2 text-slate-900 sm:mb-0">{r.voterName}</dd>
          <dt className="text-slate-600">{t("ballot.receipt.time")}</dt>
          <dd className="text-slate-900">{formatDateTime(r.submittedAt)}</dd>
        </dl>
        <ul className="mt-4 divide-y divide-slate-100 border-t border-slate-100">
          {r.items.map((i) => (
            <li key={i.voteId} className="py-3">
              <p className="text-[15px] font-medium text-slate-900">{i.code} — {i.title}</p>
              <p className="mt-1 text-[15px] text-slate-900">
                {t("ballot.receipt.yourChoice")}: <b>{t(CHOICE_LABEL[i.choice] ?? "")}</b>
              </p>
              <p className="mt-1 break-all font-mono text-[13px] text-slate-600">
                {t("ballot.receipt.number")}: {i.voteId}
              </p>
            </li>
          ))}
        </ul>
        {r.skipped.length > 0 && (
          <div className="mt-1 border-t border-slate-100 pt-3 text-[15px] text-slate-600">
            <p className="font-medium">{t("ballot.receipt.skipped")}</p>
            <ul className="list-disc pl-5">
              {r.skipped.map((s) => (
                <li key={s.code}>
                  {tf(s.reason === "voted" ? "ballot.receipt.skippedVoted" : "ballot.receipt.skippedClosed", { kod: s.code, naslov: s.title })}
                </li>
              ))}
            </ul>
          </div>
        )}
        <p className="mt-4 max-w-[68ch] text-[15px] text-slate-700">
          {r.closesAt ? tf("ballot.receipt.final", { rok: formatDateTime(r.closesAt) }) : t("ballot.receipt.finalNoDate")}
        </p>
        <div className="mt-3 max-w-[68ch]">
          <Flash warn={t("ballot.receipt.keep")} inset />
        </div>
        <PrintButton />
      </Card>
    </div>
  );
}
