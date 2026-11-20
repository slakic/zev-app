import { notFound } from "next/navigation";
import { requireActor } from "@/server/actor";
import { hasCapability } from "@/lib/accountingCapabilities";
import { getZevAccount, getZevChart } from "@/server/services/chartOfAccounts";
import { ACCOUNT_NATURES } from "@/lib/accountCodes";
import { ledgerMessage } from "@/lib/ledgerMessages";
import { t, tEnum, tf } from "@/lib/i18n";
import { PageHeader, Card, Flash, Field, inputCls, SubmitBtn, ToggleBtn, ConfirmAction, StatusBadge, RowLink } from "@/components/ui";
import { AddAccountForm } from "@/components/add-account-form";
import {
  deactivateAccountAction, deleteAccountAction, reactivateAccountAction, replaceAccountAction, updateAccountAction,
} from "@/server/actions/chartOfAccounts";

/** Detalj konta ZEV-a (A1): podaci, izmjena, podkonta i radnje (deaktivacija, zamjena, brisanje u nacrtu). */
export default async function AccountPage({
  params, searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ msg?: string; err?: string }>;
}) {
  const actor = await requireActor("PRESIDENT", "ACCOUNTANT");
  const { id } = await params;
  const sp = await searchParams;
  const acc = await getZevAccount(actor, id).catch(() => null);
  if (!acc) notFound();
  const canEdit = hasCapability(actor.roles, "chart.edit") && acc.chart.status !== "RETIRED";
  const isDraft = acc.chart.status === "DRAFT";
  const isLeaf = acc.children.length === 0;
  const chart = canEdit && isDraft ? await getZevChart(actor) : null;
  const parentOptions = (chart?.accounts ?? []).filter((a) => !a.postable && a.id !== acc.id);

  return (
    <div>
      <PageHeader
        title={`${acc.code} ${acc.name}`}
        subtitle={tEnum("accountNature", acc.nature)}
        backHref="/knjigovodstvo"
        backLabel={t("ledger.account.back")}
      />
      <Flash msg={ledgerMessage(sp.msg)} err={sp.err} />
      <div className="space-y-6">
        <Card title={t("ledger.account.details")}>
          <dl className="grid grid-cols-1 gap-x-6 gap-y-3 text-sm sm:grid-cols-2">
            <div><dt className="text-hint text-slate-500">{t("ledger.account.code")}</dt><dd className="tabular-nums">{acc.code}</dd></div>
            <div><dt className="text-hint text-slate-500">{t("ledger.add.kind")}</dt><dd>{acc.postable ? t("ledger.list.postable") : t("ledger.list.summary")}</dd></div>
            <div>
              <dt className="text-hint text-slate-500">{t("ledger.list.colStatus")}</dt>
              <dd>{acc.active ? t("ledger.list.active") : <StatusBadge status="ACCOUNT_INACTIVE" label={t("ledger.list.inactive")} />}</dd>
            </div>
            <div>
              <dt className="text-hint text-slate-500">{t("ledger.account.parent")}</dt>
              <dd>{acc.parent ? <RowLink href={`/knjigovodstvo/konto/${acc.parent.id}`}>{acc.parent.code} {acc.parent.name}</RowLink> : "—"}</dd>
            </div>
            <div>
              <dt className="text-hint text-slate-500">{t("ledger.account.fromTemplate")}</dt>
              <dd>{acc.templateAccount ? `${acc.templateAccount.code} ${acc.templateAccount.name}` : t("ledger.account.local")}</dd>
            </div>
            {acc.replaces && (
              <div>
                <dt className="text-hint text-slate-500">{t("ledger.account.replaces")}</dt>
                <dd><RowLink href={`/knjigovodstvo/konto/${acc.replaces.id}`}>{acc.replaces.code} {acc.replaces.name}</RowLink></dd>
              </div>
            )}
            {acc.replacedBy && (
              <div>
                <dt className="text-hint text-slate-500">{t("ledger.account.replacedBy")}</dt>
                <dd><RowLink href={`/knjigovodstvo/konto/${acc.replacedBy.id}`}>{acc.replacedBy.code} {acc.replacedBy.name}</RowLink></dd>
              </div>
            )}
            {acc.description && (
              <div className="sm:col-span-2"><dt className="text-hint text-slate-500">{t("ledger.add.description")}</dt><dd>{acc.description}</dd></div>
            )}
          </dl>
        </Card>

        {canEdit && (
          <Card title={t("ledger.account.edit")} hint={isDraft ? undefined : t("ledger.account.editLockedHint")}>
            <form action={updateAccountAction} className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
              <input type="hidden" name="id" value={acc.id} />
              <input type="hidden" name="structural" value={isDraft ? "1" : "0"} />
              {isDraft && (
                <>
                  <Field label={t("ledger.add.code")} hint={t("ledger.add.codeHint")}>
                    <input name="code" required defaultValue={acc.code} autoComplete="off" className={inputCls} />
                  </Field>
                  <Field label={t("ledger.add.parent")}>
                    <select name="parentId" defaultValue={acc.parentId ?? ""} className={inputCls}>
                      <option value="">{t("ledger.add.noParent")}</option>
                      {parentOptions.map((p) => <option key={p.id} value={p.id}>{p.code} {p.name}</option>)}
                    </select>
                  </Field>
                  <Field label={t("ledger.add.nature")}>
                    <select name="nature" defaultValue={acc.nature} className={inputCls}>
                      {ACCOUNT_NATURES.map((n) => <option key={n} value={n}>{tEnum("accountNature", n)}</option>)}
                    </select>
                  </Field>
                  <Field label={t("ledger.add.kind")}>
                    <select name="postable" defaultValue={acc.postable ? "1" : "0"} className={inputCls}>
                      <option value="1">{t("ledger.list.postable")}</option>
                      <option value="0">{t("ledger.list.summary")}</option>
                    </select>
                  </Field>
                </>
              )}
              <Field label={t("ledger.add.name")}>
                <input name="name" required defaultValue={acc.name} className={inputCls} />
              </Field>
              <Field label={t("ledger.add.description")}>
                <input name="description" defaultValue={acc.description ?? ""} className={inputCls} />
              </Field>
              <div className="sm:col-span-2 lg:col-span-3">
                <SubmitBtn variant="tonal">{t("ledger.account.save")}</SubmitBtn>
              </div>
            </form>
          </Card>
        )}

        {!acc.postable && (
          <Card title={t("ledger.account.children")}>
            {acc.children.length === 0 ? (
              <p className="text-sm text-slate-600">{t("ledger.account.childrenEmpty")}</p>
            ) : (
              <ul className="divide-y divide-slate-100 text-sm">
                {acc.children.map((c) => (
                  <li key={c.id} className="flex flex-wrap items-center gap-2 py-2">
                    <RowLink href={`/knjigovodstvo/konto/${c.id}`}><span className="tabular-nums">{c.code}</span> {c.name}</RowLink>
                    <span className="text-hint text-slate-500">{c.postable ? t("ledger.list.postable") : t("ledger.list.summary")}</span>
                    {!c.active && <StatusBadge status="ACCOUNT_INACTIVE" label={t("ledger.list.inactive")} />}
                  </li>
                ))}
              </ul>
            )}
            {canEdit && acc.active && (
              <details className="group mt-4">
                <ToggleBtn variant="tonal">{t("ledger.account.addChild")}</ToggleBtn>
                <AddAccountForm fixedParentId={acc.id} />
              </details>
            )}
          </Card>
        )}

        {canEdit && (
          <Card title={t("ledger.account.actions")}>
            <div className="flex flex-wrap items-start gap-3">
              {acc.active ? (
                <ConfirmAction
                  trigger={t("ledger.account.deactivate")}
                  title={tf("ledger.account.deactivateTitle", { sifra: acc.code })}
                  body={<p className="text-sm text-amber-900">{t("ledger.account.deactivateBody")}</p>}
                  confirmLabel={t("ledger.account.deactivateConfirm")}
                  action={deactivateAccountAction}
                  hiddenFields={{ id: acc.id }}
                >
                  <Field label={t("ledger.account.reason")}><input name="reason" required className={inputCls} /></Field>
                </ConfirmAction>
              ) : (
                !acc.replacedBy && (
                  <form action={reactivateAccountAction}>
                    <input type="hidden" name="id" value={acc.id} />
                    <SubmitBtn variant="secondary">{t("ledger.account.reactivate")}</SubmitBtn>
                  </form>
                )
              )}
              {!isDraft && acc.active && isLeaf && !acc.replacedBy && (
                <ConfirmAction
                  trigger={t("ledger.account.replace")}
                  title={tf("ledger.account.replaceTitle", { sifra: acc.code })}
                  body={<p className="text-sm text-amber-900">{t("ledger.account.replaceBody")}</p>}
                  confirmLabel={t("ledger.account.replaceConfirm")}
                  action={replaceAccountAction}
                  hiddenFields={{ id: acc.id }}
                >
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    <Field label={t("ledger.add.code")} hint={t("ledger.add.codeHint")}>
                      <input name="code" required autoComplete="off" className={inputCls} />
                    </Field>
                    <Field label={t("ledger.add.name")}><input name="name" required defaultValue={acc.name} className={inputCls} /></Field>
                    <Field label={t("ledger.add.nature")}>
                      <select name="nature" defaultValue={acc.nature} className={inputCls}>
                        {ACCOUNT_NATURES.map((n) => <option key={n} value={n}>{tEnum("accountNature", n)}</option>)}
                      </select>
                    </Field>
                    <Field label={t("ledger.add.kind")}>
                      <select name="postable" defaultValue={acc.postable ? "1" : "0"} className={inputCls}>
                        <option value="1">{t("ledger.list.postable")}</option>
                        <option value="0">{t("ledger.list.summary")}</option>
                      </select>
                    </Field>
                    <Field label={t("ledger.add.description")}><input name="description" className={inputCls} /></Field>
                    <Field label={t("ledger.account.reason")}><input name="reason" required className={inputCls} /></Field>
                  </div>
                </ConfirmAction>
              )}
              {isDraft && isLeaf && (
                <ConfirmAction
                  trigger={t("ledger.account.delete")}
                  title={tf("ledger.account.deleteTitle", { sifra: acc.code })}
                  body={<p className="text-sm text-amber-900">{t("ledger.account.deleteBody")}</p>}
                  confirmLabel={t("ledger.account.deleteConfirm")}
                  action={deleteAccountAction}
                  hiddenFields={{ id: acc.id }}
                />
              )}
            </div>
          </Card>
        )}
      </div>
    </div>
  );
}
