import { notFound } from "next/navigation";
import { requireSuperAdminActor } from "@/server/actor";
import { getTemplate, getTemplateAccount } from "@/server/services/chartOfAccounts";
import { ledgerMessage } from "@/lib/ledgerMessages";
import { t, tEnum, tf } from "@/lib/i18n";
import { PageHeader, Card, Flash, ConfirmAction } from "@/components/ui";
import { TemplateAccountForm } from "@/components/template-account-form";
import { deleteTemplateAccountAction } from "@/server/actions/chartOfAccounts";

/** Konto u nacrtu kontnog predloška (admin): izmjena i brisanje bez ponovnog uvoza CSV-a. */
export default async function TemplateAccountPage({
  params, searchParams,
}: {
  params: Promise<{ id: string; accountId: string }>;
  searchParams: Promise<{ msg?: string; err?: string }>;
}) {
  const actor = await requireSuperAdminActor();
  const { id, accountId } = await params;
  const sp = await searchParams;
  const acc = await getTemplateAccount(actor, accountId).catch(() => null);
  if (!acc || acc.templateId !== id) notFound();
  const isDraft = acc.template.status === "DRAFT";
  const tpl = isDraft ? await getTemplate(actor, id) : null;
  const parents = (tpl?.accounts ?? []).filter((a) => !a.postable && a.id !== acc.id);

  return (
    <div>
      <PageHeader
        title={`${acc.code} ${acc.name}`}
        subtitle={`${acc.template.name} · v${acc.template.version} · ${tEnum("accountNature", acc.nature)}`}
        backHref={`/admin/kontni-okviri/${id}`}
        backLabel={t("ledger.templates.account.back")}
      />
      <Flash msg={ledgerMessage(sp.msg)} err={sp.err} />
      <div className="space-y-6">
        <Card title={t("ledger.templates.account.edit")}>
          {isDraft ? (
            <TemplateAccountForm templateId={id} parents={parents} account={acc} />
          ) : (
            <p className="max-w-[68ch] text-sm text-slate-600">{t("ledger.templates.account.locked")}</p>
          )}
        </Card>
        {isDraft && acc.children.length === 0 && (
          <Card title={t("ledger.account.actions")}>
            <ConfirmAction
              trigger={t("ledger.templates.account.delete")}
              title={tf("ledger.templates.account.deleteTitle", { sifra: acc.code })}
              body={<p className="text-sm text-amber-900">{t("ledger.templates.account.deleteBody")}</p>}
              confirmLabel={t("ledger.templates.account.deleteConfirm")}
              action={deleteTemplateAccountAction}
              hiddenFields={{ id: acc.id, templateId: id }}
            />
          </Card>
        )}
      </div>
    </div>
  );
}
