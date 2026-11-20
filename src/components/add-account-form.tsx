// Obrazac novog konta (A1) — na kontnom planu (bira se nadređeni) i na detalju zbirnog konta (nadređeni je fiksan).
import { ACCOUNT_NATURES } from "@/lib/accountCodes";
import { t, tEnum } from "@/lib/i18n";
import { Field, inputCls, SubmitBtn } from "@/components/ui";
import { addAccountAction } from "@/server/actions/chartOfAccounts";

export function AddAccountForm({
  parents, allowRoot, fixedParentId,
}: {
  parents?: { id: string; code: string; name: string }[];
  allowRoot?: boolean;
  fixedParentId?: string;
}) {
  return (
    <form action={addAccountAction} className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {fixedParentId ? (
        <>
          <input type="hidden" name="parentId" value={fixedParentId} />
          <input type="hidden" name="back" value="account" />
        </>
      ) : (
        <Field label={t("ledger.add.parent")}>
          <select name="parentId" className={inputCls} required={!allowRoot}>
            {allowRoot && <option value="">{t("ledger.add.noParent")}</option>}
            {(parents ?? []).map((p) => (
              <option key={p.id} value={p.id}>{p.code} {p.name}</option>
            ))}
          </select>
        </Field>
      )}
      <Field label={t("ledger.add.code")} hint={t("ledger.add.codeHint")}>
        <input name="code" required inputMode="text" autoComplete="off" className={inputCls} />
      </Field>
      <Field label={t("ledger.add.name")}>
        <input name="name" required className={inputCls} />
      </Field>
      <Field label={t("ledger.add.nature")}>
        <select name="nature" className={inputCls}>
          <option value="">{t("ledger.add.natureFromParent")}</option>
          {ACCOUNT_NATURES.map((n) => <option key={n} value={n}>{tEnum("accountNature", n)}</option>)}
        </select>
      </Field>
      <Field label={t("ledger.add.kind")}>
        <select name="postable" defaultValue="1" className={inputCls}>
          <option value="1">{t("ledger.list.postable")}</option>
          <option value="0">{t("ledger.list.summary")}</option>
        </select>
      </Field>
      <Field label={t("ledger.add.description")}>
        <input name="description" className={inputCls} />
      </Field>
      <div className="sm:col-span-2 lg:col-span-3">
        <SubmitBtn variant="tonal">{t("ledger.add.submit")}</SubmitBtn>
      </div>
    </form>
  );
}

