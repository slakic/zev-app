// Obrazac konta u NACRTU kontnog predloška (admin) — dodavanje (bez `account`) i izmjena (sa `account`).
import { ACCOUNT_NATURES } from "@/lib/accountCodes";
import { t, tEnum } from "@/lib/i18n";
import { Field, inputCls, SubmitBtn } from "@/components/ui";
import { addTemplateAccountAction, updateTemplateAccountAction } from "@/server/actions/chartOfAccounts";

export function TemplateAccountForm({
  templateId, parents, account,
}: {
  templateId: string;
  /** Zbirna konta predloška koja mogu biti nadređena (bez samog konta koje se mijenja). */
  parents: { id: string; code: string; name: string }[];
  account?: { id: string; code: string; name: string; description: string | null; parentId: string | null; nature: string; postable: boolean };
}) {
  return (
    <form action={account ? updateTemplateAccountAction : addTemplateAccountAction} className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
      <input type="hidden" name="templateId" value={templateId} />
      {account && <input type="hidden" name="id" value={account.id} />}
      <Field label={t("ledger.add.parent")}>
        <select name="parentId" defaultValue={account?.parentId ?? ""} className={inputCls}>
          <option value="">{t("ledger.add.noParent")}</option>
          {parents.map((p) => <option key={p.id} value={p.id}>{p.code} {p.name}</option>)}
        </select>
      </Field>
      <Field label={t("ledger.add.code")} hint={t("ledger.add.codeHint")}>
        <input name="code" required defaultValue={account?.code} autoComplete="off" className={inputCls} />
      </Field>
      <Field label={t("ledger.add.name")}>
        <input name="name" required defaultValue={account?.name} className={inputCls} />
      </Field>
      <Field label={t("ledger.add.nature")}>
        <select name="nature" required defaultValue={account?.nature ?? "ASSET"} className={inputCls}>
          {ACCOUNT_NATURES.map((n) => <option key={n} value={n}>{tEnum("accountNature", n)}</option>)}
        </select>
      </Field>
      <Field label={t("ledger.add.kind")}>
        <select name="postable" defaultValue={account ? (account.postable ? "1" : "0") : "1"} className={inputCls}>
          <option value="1">{t("ledger.list.postable")}</option>
          <option value="0">{t("ledger.list.summary")}</option>
        </select>
      </Field>
      <Field label={t("ledger.add.description")}>
        <input name="description" defaultValue={account?.description ?? ""} className={inputCls} />
      </Field>
      <div className="sm:col-span-2 lg:col-span-3">
        <SubmitBtn variant="tonal">{account ? t("ledger.templates.account.save") : t("ledger.add.submit")}</SubmitBtn>
      </div>
    </form>
  );
}
