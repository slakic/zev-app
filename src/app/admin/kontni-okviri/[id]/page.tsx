import { notFound } from "next/navigation";
import { requireSuperAdminActor } from "@/server/actor";
import { getTemplate } from "@/server/services/chartOfAccounts";
import { ledgerMessage } from "@/lib/ledgerMessages";
import { formatDate, t, tEnum, tf, toZonedDateIso } from "@/lib/i18n";
import { PageHeader, Card, Flash, Field, inputCls, SubmitBtn, ConfirmAction, StatusBadge } from "@/components/ui";
import { AccountTreeTable } from "@/components/account-tree-table";
import { TemplateMetaFields } from "@/components/template-meta-fields";
import { ProofFileField } from "@/components/proof-file-field";
import {
  createTemplateVersionAction, importTemplateAccountsAction, setTemplateStatusAction, updateTemplateAction,
} from "@/server/actions/chartOfAccounts";

/** Detalj kontnog predloška (A1): podaci, uvoz konta u nacrt, stručna provjera, verzije i povlačenje. */
export default async function ChartTemplatePage({
  params, searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ msg?: string; err?: string; n?: string }>;
}) {
  const actor = await requireSuperAdminActor();
  const { id } = await params;
  const sp = await searchParams;
  const tpl = await getTemplate(actor, id).catch(() => null);
  if (!tpl) notFound();
  const isDraft = tpl.status === "DRAFT";

  return (
    <div>
      <PageHeader
        title={`${tpl.name} · v${tpl.version}`}
        subtitle={`${tpl.key} · ${tpl.jurisdiction}`}
        backHref="/admin/kontni-okviri"
        backLabel={t("ledger.templates.back")}
      />
      <Flash msg={ledgerMessage(sp.msg, { broj: sp.n ?? "" })} err={sp.err} />
      <div className="space-y-6">
        <Card title={t("ledger.templates.meta")}>
          <div className="space-y-4">
            <div className="flex flex-wrap items-center gap-2">
              <StatusBadge status={tpl.status} label={tEnum("chartTemplateStatus", tpl.status)} />
              <span className="text-hint text-slate-500">{tf("ledger.templates.usedBy", { broj: tpl._count.zevCharts })}</span>
            </div>
            {tpl.status === "DEMO" && <Flash inset warn={t("ledger.templates.demoWarning")} />}
            {isDraft ? (
              <form action={updateTemplateAction} className="space-y-4">
                <input type="hidden" name="id" value={tpl.id} />
                <TemplateMetaFields initial={tpl} />
                <SubmitBtn variant="tonal">{t("ledger.templates.save")}</SubmitBtn>
              </form>
            ) : (
              <>
                <dl className="grid grid-cols-1 gap-x-6 gap-y-3 text-sm sm:grid-cols-2">
                  <div><dt className="text-hint text-slate-500">{t("ledger.templates.source")}</dt><dd>{tpl.source ?? "—"}</dd></div>
                  <div>
                    <dt className="text-hint text-slate-500">{t("ledger.chart.review")}</dt>
                    <dd>{tpl.reviewedBy ? `${tpl.reviewedBy}, ${formatDate(tpl.reviewedAt)}` : "—"}</dd>
                  </div>
                  <div><dt className="text-hint text-slate-500">{t("ledger.templates.validFrom")}</dt><dd>{tpl.validFrom ? formatDate(tpl.validFrom) : "—"}</dd></div>
                  <div><dt className="text-hint text-slate-500">{t("ledger.templates.validTo")}</dt><dd>{tpl.validTo ? formatDate(tpl.validTo) : "—"}</dd></div>
                  {tpl.note && <div className="sm:col-span-2"><dt className="text-hint text-slate-500">{t("ledger.templates.note")}</dt><dd>{tpl.note}</dd></div>}
                </dl>
                <p className="max-w-[68ch] text-sm text-slate-600">{t("ledger.templates.lockedHint")}</p>
              </>
            )}
            <div className="flex flex-wrap items-start gap-3">
              {isDraft && (
                <>
                  <ConfirmAction
                    trigger={t("ledger.templates.review")}
                    title={t("ledger.templates.reviewTitle")}
                    body={<p className="text-sm text-amber-900">{t("ledger.templates.reviewBody")}</p>}
                    confirmLabel={t("ledger.templates.reviewConfirm")}
                    confirmVariant="primary"
                    action={setTemplateStatusAction}
                    hiddenFields={{ id: tpl.id, target: "REVIEWED" }}
                  >
                    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                      <Field label={t("ledger.templates.source")}><input name="source" required defaultValue={tpl.source ?? ""} className={inputCls} /></Field>
                      <Field label={t("ledger.templates.reviewedBy")}><input name="reviewedBy" required className={inputCls} /></Field>
                      <Field label={t("ledger.templates.reviewedAt")}>
                        <input name="reviewedAt" type="date" required defaultValue={toZonedDateIso(new Date())} className={inputCls} />
                      </Field>
                    </div>
                  </ConfirmAction>
                  <ConfirmAction
                    trigger={t("ledger.templates.demo")}
                    title={t("ledger.templates.demoTitle")}
                    body={<p className="text-sm text-amber-900">{t("ledger.templates.demoBody")}</p>}
                    confirmLabel={t("ledger.templates.demoConfirm")}
                    action={setTemplateStatusAction}
                    hiddenFields={{ id: tpl.id, target: "DEMO" }}
                  />
                </>
              )}
              {!isDraft && (
                <ConfirmAction
                  trigger={t("ledger.templates.newVersion")}
                  title={t("ledger.templates.newVersionTitle")}
                  body={<p className="text-sm text-amber-900">{t("ledger.templates.newVersionBody")}</p>}
                  confirmLabel={t("ledger.templates.newVersionConfirm")}
                  action={createTemplateVersionAction}
                  hiddenFields={{ id: tpl.id }}
                />
              )}
              {(tpl.status === "REVIEWED" || tpl.status === "DEMO") && (
                <ConfirmAction
                  trigger={t("ledger.templates.retire")}
                  title={t("ledger.templates.retireTitle")}
                  body={<p className="text-sm text-amber-900">{t("ledger.templates.retireBody")}</p>}
                  confirmLabel={t("ledger.templates.retireConfirm")}
                  action={setTemplateStatusAction}
                  hiddenFields={{ id: tpl.id, target: "RETIRED" }}
                />
              )}
            </div>
          </div>
        </Card>

        {isDraft && (
          <Card title={t("ledger.templates.importTitle")} hint={t("ledger.templates.importHint")}>
            <form action={importTemplateAccountsAction} className="space-y-3">
              <input type="hidden" name="id" value={tpl.id} />
              <ProofFileField name="file" label={t("ledger.templates.importFile")} buttonLabel={t("ledger.templates.importButton")} accept=".csv,text/csv" required />
              <SubmitBtn variant="tonal">{t("ledger.templates.importSubmit")}</SubmitBtn>
            </form>
          </Card>
        )}

        <Card title={t("ledger.templates.accounts")}>
          <AccountTreeTable
            id="template-accounts"
            caption={t("ledger.templates.accounts")}
            rows={tpl.accounts}
            emptyTitle={t("ledger.templates.accountsEmpty")}
            emptyHint={isDraft ? t("ledger.templates.accountsEmptyHint") : undefined}
          />
        </Card>
      </div>
    </div>
  );
}
