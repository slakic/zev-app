import Link from "next/link";
import type { ReactNode } from "react";
import type { Actor } from "@/server/auth/guards";
import { listAuditActors, listAuditTrail } from "@/server/services/records";
import { labelForAction, labelForTarget, summarize } from "@/lib/activity/catalog";
import { isIsoDate, recordsHref } from "@/lib/records";
import { endOfDay, formatDateTime, parseZonedDateTime, t } from "@/lib/i18n";
import { Card, Table, Td, Pagination, Field, FilterBar, inputCls, type ColumnSpec } from "@/components/ui";

const headers: ColumnSpec[] = [
  { label: t("records.audit.action"), priority: "primary" },
  // Ispod `md` se Ko i Vrijeme izvode u prvoj ćeliji (jedan red po zapisu), pa se kolone tamo krije.
  { label: t("records.audit.when"), priority: "secondary", nowrap: true },
  { label: t("records.audit.who"), priority: "secondary" },
];

export type AuditSearch = { from?: string; to?: string; akter?: string; q?: string; str?: string };

function Json({ label, value }: { label: string; value: unknown }) {
  if (value === null || value === undefined) return null;
  return (
    <div>
      <dt className="font-medium text-slate-700">{label}</dt>
      <dd>
        <pre className="mt-1 max-h-48 overflow-auto whitespace-pre-wrap break-all rounded-lg bg-white p-2 font-mono text-[13px] text-slate-700">
          {JSON.stringify(value, null, 2)}
        </pre>
      </dd>
    </div>
  );
}

function Detail({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <dt className="font-medium text-slate-700">{label}</dt>
      <dd className="break-all text-slate-600">{children}</dd>
    </div>
  );
}

/** Revizorski trag (X-R13): prevedena radnja, sirovi kod i JSON „prije/poslije” samo na zahtjev (`<details>`). */
export async function AuditTab({ actor, sp }: { actor: Actor; sp: AuditSearch }) {
  const from = isIsoDate(sp.from) ? sp.from : undefined;
  const to = isIsoDate(sp.to) ? sp.to : undefined;
  const q = sp.q?.trim() || undefined;
  const page = Math.max(1, Number(sp.str) || 1);

  const [actors, result] = await Promise.all([
    listAuditActors(actor),
    listAuditTrail(actor, {
      from: from ? parseZonedDateTime(`${from}T00:00`) ?? undefined : undefined,
      to: to ? endOfDay(to) : undefined,
      actorUserId: sp.akter || undefined,
      q,
      page,
    }),
  ]);
  const actorLabelById = new Map(actors.map((a) => [a.id, a.label]));
  const filters = { from, to, akter: sp.akter, q };
  const filtered = Boolean(from || to || sp.akter || q);

  return (
    <>
      <FilterBar>
        <input type="hidden" name="tab" value="audit" />
        <div className="w-full sm:w-40">
          <Field label={t("records.audit.from")}><input type="date" name="from" defaultValue={from} className={inputCls} /></Field>
        </div>
        <div className="w-full sm:w-40">
          <Field label={t("records.audit.to")}><input type="date" name="to" defaultValue={to} className={inputCls} /></Field>
        </div>
        <div className="w-full sm:w-52">
          <Field label={t("records.audit.who")}>
            <select name="akter" defaultValue={sp.akter ?? ""} className={inputCls}>
              <option value="">{t("records.audit.all")}</option>
              {actors.map((a) => (
                <option key={a.id} value={a.id}>{a.label}</option>
              ))}
            </select>
          </Field>
        </div>
        <div className="w-full sm:w-64">
          <Field label={t("records.audit.search")}>
            <input name="q" defaultValue={q} placeholder={t("records.audit.searchPlaceholder")} className={inputCls} />
          </Field>
        </div>
      </FilterBar>

      <Card hint={t("records.audit.hint")}>
        <Table
          id="audit-table"
          caption={t("records.tabs.audit")}
          headers={headers}
          empty={result.rows.length === 0}
          emptyTitle={t(filtered ? "empty.filteredQuery.title" : "empty.auditEmpty.title")}
          emptyHint={
            filtered ? (
              <>
                {t("empty.filteredQuery.hint")}{" "}
                <Link href={recordsHref("audit")} className="font-medium text-primary-ink underline-offset-2 hover:underline">
                  {t("records.audit.clearFilter")}
                </Link>
              </>
            ) : undefined
          }
        >
          {result.rows.map((e) => {
            const action = labelForAction(e.action);
            const summary = summarize(e);
            const who = e.actorId
              ? actorLabelById.get(e.actorId) ?? e.actorLabel ?? e.actorId.slice(-8)
              : e.actorLabel ?? t("records.audit.system");
            const when = formatDateTime(e.createdAt);
            return (
              <tr key={e.id} className="align-top">
                <Td>
                  <div className={action.translated ? "text-sm font-medium text-slate-900" : "break-all font-mono text-[13px] text-slate-600"}>
                    {action.label}
                    {summary && <span className="font-normal text-slate-500"> — {summary}</span>}
                  </div>
                  {action.translated && (
                    <div className="hidden break-all font-mono text-[13px] text-slate-500 md:block">{e.action}</div>
                  )}
                  {e.reason && <div className="mt-0.5 text-[13px] text-slate-600">{t("records.audit.reason")}: {e.reason}</div>}
                  <details className="group">
                    <summary className="flex cursor-pointer list-none items-center justify-between gap-3 rounded max-md:min-h-[44px] md:justify-start [&::-webkit-details-marker]:hidden focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-1">
                      <span className="text-[13px] text-slate-500 md:hidden">{who} · {when}</span>
                      <span className="inline-flex items-center gap-1 text-[13px] font-medium text-primary-ink">
                        <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" className="h-3.5 w-3.5 shrink-0 transition-transform duration-150 group-open:rotate-90" aria-hidden="true">
                          <path d="M7 5l6 5-6 5" />
                        </svg>
                        <span className="group-open:hidden">{t("records.audit.details")}</span>
                        <span className="hidden group-open:inline">{t("records.audit.hide")}</span>
                      </span>
                    </summary>
                    <dl className="mt-1 space-y-2 rounded-lg bg-slate-50 p-3 text-[13px]">
                      <Detail label={t("records.audit.target")}>{labelForTarget(e.targetType)}</Detail>
                      {e.targetId && <Detail label={t("records.audit.recordId")}><span className="font-mono">{e.targetId}</span></Detail>}
                      <Detail label={t("records.audit.code")}><span className="font-mono">{e.action}</span></Detail>
                      <Json label={t("records.audit.before")} value={e.before} />
                      <Json label={t("records.audit.after")} value={e.after} />
                      {e.before == null && e.after == null && <p className="text-slate-500">{t("records.audit.noChange")}</p>}
                    </dl>
                  </details>
                </Td>
                <Td className="text-sm">{when}</Td>
                <Td className="text-sm">{who}</Td>
              </tr>
            );
          })}
        </Table>
        <Pagination page={result.page} pageCount={result.pageCount} hrefFor={(p) => recordsHref("audit", { ...filters, str: String(p) })} />
      </Card>
    </>
  );
}
