import Link from "next/link";
import type { Actor } from "@/server/auth/guards";
import { listSentMessages, MESSAGE_STATUSES } from "@/server/services/records";
import { describeEmailProvider } from "@/server/notifications/providers";
import { recordsHref } from "@/lib/records";
import { formatDateTime, t, tEnum } from "@/lib/i18n";
import { Card, Table, Td, Field, FilterBar, StatusBadge, inputCls, Pagination, type ColumnSpec } from "@/components/ui";

const headers: ColumnSpec[] = [
  { label: t("records.messages.when"), nowrap: true },
  { label: t("records.messages.channel"), priority: "detail" },
  { label: t("records.messages.recipient"), priority: "primary" },
  { label: t("records.messages.subject") },
  { label: t("records.messages.status") },
  { label: t("records.messages.attempts"), align: "right", priority: "detail" },
];

export type MessagesSearch = { q?: string; status?: string; str?: string };

export async function MessagesTab({ actor, sp }: { actor: Actor; sp: MessagesSearch }) {
  const q = sp.q?.trim() || undefined;
  const status = (MESSAGE_STATUSES as readonly string[]).includes(sp.status ?? "") ? sp.status : undefined;
  const page = Math.max(1, Number(sp.str) || 1);
  const result = await listSentMessages(actor, { q, status, page });
  const filtered = Boolean(q || status);
  const subtitle =
    describeEmailProvider().kind === "mailjet" ? t("records.messages.subtitleLive") : t("records.messages.subtitleSimulated");

  return (
    <>
      <FilterBar>
        <input type="hidden" name="tab" value="poruke" />
        <div className="w-full sm:w-64">
          <Field label={t("records.messages.search")}>
            <input name="q" defaultValue={q} placeholder={t("records.messages.searchPlaceholder")} className={inputCls} />
          </Field>
        </div>
        <div className="w-full sm:w-52">
          <Field label={t("records.messages.status")}>
            <select name="status" defaultValue={status ?? ""} className={inputCls}>
              <option value="">{t("records.messages.allStatuses")}</option>
              {MESSAGE_STATUSES.map((s) => (
                <option key={s} value={s}>{tEnum("records.messages.statusLabel", s)}</option>
              ))}
            </select>
          </Field>
        </div>
      </FilterBar>

      <Card hint={subtitle}>
        <Table
          id="messages-table"
          caption={t("records.tabs.messages")}
          headers={headers}
          empty={result.rows.length === 0}
          emptyTitle={t(filtered ? "empty.filteredQuery.title" : "empty.messages.title")}
          emptyHint={
            filtered ? (
              <>
                {t("empty.filteredQuery.hint")}{" "}
                <Link href={recordsHref("poruke")} className="font-medium text-primary-ink underline-offset-2 hover:underline">
                  {t("records.audit.clearFilter")}
                </Link>
              </>
            ) : (
              t("empty.messages.hint")
            )
          }
        >
          {result.rows.map((m) => (
            <tr key={m.id}>
              <Td className="text-sm">{formatDateTime(m.createdAt)}</Td>
              <Td className="text-sm">{m.channel === "EMAIL" ? t("records.messages.email") : t("records.messages.viber")}</Td>
              <Td className="text-sm">{m.toAddress}</Td>
              <Td className="text-sm">
                {m.subject ?? m.template ?? "—"}
                {m.attachmentDocumentId && <span className="text-[13px] text-slate-600"> {t("records.messages.pdfAttached")}</span>}
              </Td>
              <Td>
                <StatusBadge status={m.status} label={tEnum("records.messages.statusLabel", m.status)} />
                {m.status === "FAILED" && m.lastError && <p className="mt-1 max-w-72 text-[13px] text-slate-600">{m.lastError}</p>}
              </Td>
              <Td className="text-sm">{m.attempts}</Td>
            </tr>
          ))}
        </Table>
        <Pagination page={result.page} pageCount={result.pageCount} hrefFor={(p) => recordsHref("poruke", { q, status, str: String(p) })} />
        <p className="mt-2 text-[13px] text-slate-500">{t("records.messages.footnote")}</p>
      </Card>
    </>
  );
}
