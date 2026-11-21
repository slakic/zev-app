import { notFound } from "next/navigation";
import { requireActor } from "@/server/actor";
import { hasCapability } from "@/lib/accountingCapabilities";
import { getEntry } from "@/server/services/journal";
import { partyDisplayName } from "@/server/services/ownership";
import { dec, formatMoney, sumDecimals } from "@/lib/money";
import { ledgerMessage } from "@/lib/ledgerMessages";
import { formatDate, formatDateTime, t, tEnum, tf, toZonedDateIso } from "@/lib/i18n";
import { Card, ConfirmAction, Field, Flash, inputCls, PageHeader, RowLink, StatusBadge, Table, Td, type ColumnSpec } from "@/components/ui";
import { JournalEditor } from "@/components/journal-editor";
import { deleteJournalDraftAction, postJournalAction, reverseJournalAction, saveJournalDraftAction } from "@/server/actions/journal";
import { editorLabels, editorOptionsFor } from "../editor-props";

const lineHeaders: ColumnSpec[] = [
  { label: t("ledger.journal.detail.colAccount"), priority: "primary" },
  { label: t("ledger.journal.detail.colAnalytics"), priority: "secondary" },
  { label: t("ledger.journal.detail.colDebit"), align: "right" },
  { label: t("ledger.journal.detail.colCredit"), align: "right" },
];

/** Nalog (B1a): nacrt se uređuje i knjiži; proknjižen nalog se samo pregleda i stornira. */
export default async function JournalEntryPage({
  params, searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ msg?: string; err?: string }>;
}) {
  const actor = await requireActor("PRESIDENT", "ACCOUNTANT");
  const { id } = await params;
  const sp = await searchParams;
  const e = await getEntry(actor, id).catch(() => null);
  if (!e) notFound();
  const isDraft = e.status === "DRAFT";
  const canPrepare = hasCapability(actor.roles, "journal.prepare") && isDraft && e.kind === "MANUAL";
  const canPost = hasCapability(actor.roles, "journal.post") && isDraft;
  const canReverse = hasCapability(actor.roles, "journal.reverse") && !isDraft && e.kind !== "REVERSAL" && !e.reversedBy;
  const debit = sumDecimals(e.lines.map((l) => dec(l.debit.toString())));
  const credit = sumDecimals(e.lines.map((l) => dec(l.credit.toString())));
  const options = canPrepare ? await editorOptionsFor(actor) : null;
  const iso = (d: Date) => d.toISOString().slice(0, 10);
  const analytics = (l: (typeof e.lines)[number]) =>
    [l.party ? partyDisplayName(l.party) : null, l.unit?.label, l.supplier?.name, l.project?.name, l.purpose ? `${l.purpose.code} ${l.purpose.name}` : null, l.description]
      .filter(Boolean).join(" · ") || "—";

  return (
    <div>
      <PageHeader
        title={e.number ? tf("ledger.journal.detail.title", { broj: e.number }) : t("ledger.journal.detail.draftTitle")}
        subtitle={e.description}
        backHref="/knjigovodstvo?tab=nalozi"
        backLabel={t("ledger.journal.detail.back")}
      />
      <Flash msg={ledgerMessage(sp.msg)} err={sp.err} />
      <div className="space-y-6">
        <Card>
          <div className="space-y-4">
            <div className="flex flex-wrap items-center gap-2">
              <StatusBadge status={e.status} label={tEnum("journalStatus", e.status)} />
              <span className="text-hint text-slate-500">{tEnum("journalKind", e.kind)}</span>
            </div>
            <dl className="grid grid-cols-1 gap-x-6 gap-y-3 text-sm sm:grid-cols-2 lg:grid-cols-3">
              <div><dt className="text-hint text-slate-500">{t("ledger.journal.detail.documentDate")}</dt><dd>{formatDate(e.documentDate)}</dd></div>
              <div><dt className="text-hint text-slate-500">{t("ledger.journal.detail.postingDate")}</dt><dd>{formatDate(e.postingDate)}</dd></div>
              <div><dt className="text-hint text-slate-500">{t("ledger.journal.detail.period")}</dt><dd>{e.period.label}</dd></div>
              {e.postedAt && <div><dt className="text-hint text-slate-500">{t("ledger.journal.detail.postedBy")}</dt><dd>{formatDateTime(e.postedAt)}</dd></div>}
              {e.reversalOf && (
                <div><dt className="text-hint text-slate-500">{t("ledger.journal.detail.reversalOf")}</dt><dd><RowLink href={`/knjigovodstvo/nalozi/${e.reversalOf.id}`}>{e.reversalOf.number}</RowLink></dd></div>
              )}
              {e.reversedBy && (
                <div><dt className="text-hint text-slate-500">{t("ledger.journal.detail.reversedBy")}</dt><dd><RowLink href={`/knjigovodstvo/nalozi/${e.reversedBy.id}`}>{e.reversedBy.number}</RowLink></dd></div>
              )}
            </dl>
          </div>
        </Card>

        {canPrepare && options ? (
          <Card title={t("ledger.journal.editor.editTitle")} hint={t("ledger.journal.editor.controlNote")}>
            <JournalEditor
              action={saveJournalDraftAction}
              entryId={e.id}
              options={options}
              labels={editorLabels}
              initial={{
                documentDate: iso(e.documentDate), postingDate: iso(e.postingDate), description: e.description,
                lines: e.lines.map((l) => ({
                  accountId: l.accountId, debit: dec(l.debit.toString()).gt(0) ? l.debit.toFixed(2) : "", credit: dec(l.credit.toString()).gt(0) ? l.credit.toFixed(2) : "",
                  partyId: l.partyId ?? "", unitId: l.unitId ?? "", supplierId: l.supplierId ?? "", projectId: l.projectId ?? "", purposeId: l.purposeId ?? "", description: l.description ?? "",
                })),
              }}
            />
          </Card>
        ) : (
          <Card title={t("ledger.journal.detail.lines")}>
            <Table id="journal-lines" caption={t("ledger.journal.detail.lines")} headers={lineHeaders}>
              {e.lines.map((l) => (
                <tr key={l.id}>
                  <Td><span className="tabular-nums">{l.account.code}</span> {l.account.name}</Td>
                  <Td>{analytics(l)}</Td>
                  <Td><span className="tabular-nums">{dec(l.debit.toString()).gt(0) ? formatMoney(l.debit.toString()) : ""}</span></Td>
                  <Td><span className="tabular-nums">{dec(l.credit.toString()).gt(0) ? formatMoney(l.credit.toString()) : ""}</span></Td>
                </tr>
              ))}
              <tr>
                <Td><span className="font-semibold">{t("ledger.journal.detail.total")}</span></Td>
                <Td>{""}</Td>
                <Td><span className="font-semibold tabular-nums">{formatMoney(debit)}</span></Td>
                <Td><span className="font-semibold tabular-nums">{formatMoney(credit)}</span></Td>
              </tr>
            </Table>
          </Card>
        )}

        {(canPost || canPrepare || canReverse) && (
          <Card>
            <div className="flex flex-wrap items-start gap-3">
              {canPost && (
                <ConfirmAction
                  trigger={t("ledger.journal.detail.post")}
                  title={t("ledger.journal.detail.postTitle")}
                  body={<p className="text-sm text-amber-900">{tf("ledger.journal.detail.postBody", { stavke: e.lines.length, iznos: formatMoney(debit, "") .trim() })}</p>}
                  confirmLabel={t("ledger.journal.detail.postConfirm")}
                  confirmVariant="primary"
                  action={postJournalAction}
                  hiddenFields={{ id: e.id }}
                />
              )}
              {canPrepare && (
                <ConfirmAction
                  trigger={t("ledger.journal.detail.delete")}
                  title={t("ledger.journal.detail.deleteTitle")}
                  body={<p className="text-sm text-amber-900">{t("ledger.journal.detail.deleteBody")}</p>}
                  confirmLabel={t("ledger.journal.detail.deleteConfirm")}
                  action={deleteJournalDraftAction}
                  hiddenFields={{ id: e.id }}
                />
              )}
              {canReverse && (
                <ConfirmAction
                  trigger={t("ledger.journal.detail.reverse")}
                  title={tf("ledger.journal.detail.reverseTitle", { broj: e.number ?? "" })}
                  body={<p className="text-sm text-amber-900">{t("ledger.journal.detail.reverseBody")}</p>}
                  confirmLabel={t("ledger.journal.detail.reverseConfirm")}
                  action={reverseJournalAction}
                  hiddenFields={{ id: e.id }}
                >
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    <Field label={t("ledger.journal.detail.reverseReason")}><input name="reason" required className={inputCls} /></Field>
                    <Field label={t("ledger.journal.detail.reverseDate")}><input type="date" name="postingDate" required defaultValue={toZonedDateIso(new Date())} className={inputCls} /></Field>
                  </div>
                </ConfirmAction>
              )}
            </div>
          </Card>
        )}
      </div>
    </div>
  );
}
