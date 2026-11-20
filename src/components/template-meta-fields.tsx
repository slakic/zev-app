// Polja podataka kontnog predloška (A1) — isti skup na „Novi predložak” i na izmjeni nacrta.
import { parseCodeRules } from "@/lib/accountCodes";
import { t, toZonedDateIso } from "@/lib/i18n";
import { Field, inputCls } from "@/components/ui";

type Initial = {
  name: string;
  jurisdiction: string;
  source: string | null;
  note: string | null;
  validFrom: Date | null;
  validTo: Date | null;
  codeRules: unknown;
};

const iso = (d: Date | null) => (d ? toZonedDateIso(d) : "");

export function TemplateMetaFields({ withKey, initial }: { withKey?: boolean; initial?: Initial }) {
  const rules = parseCodeRules(initial?.codeRules);
  return (
    <>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {withKey && (
          <Field label={t("ledger.templates.key")} hint={t("ledger.templates.keyHint")}>
            <input name="key" required pattern="[a-z0-9][a-z0-9\-]*" autoComplete="off" className={inputCls} />
          </Field>
        )}
        <Field label={t("ledger.templates.name")}>
          <input name="name" required defaultValue={initial?.name} className={inputCls} />
        </Field>
        <Field label={t("ledger.templates.jurisdiction")}>
          <input name="jurisdiction" required defaultValue={initial?.jurisdiction ?? "RS"} className={inputCls} />
        </Field>
        <Field label={t("ledger.templates.source")} hint={t("ledger.templates.sourceHint")}>
          <input name="source" defaultValue={initial?.source ?? ""} className={inputCls} />
        </Field>
        <Field label={t("ledger.templates.validFrom")}>
          <input name="validFrom" type="date" defaultValue={iso(initial?.validFrom ?? null)} className={inputCls} />
        </Field>
        <Field label={t("ledger.templates.validTo")}>
          <input name="validTo" type="date" defaultValue={iso(initial?.validTo ?? null)} className={inputCls} />
        </Field>
        <Field label={t("ledger.templates.note")}>
          <input name="note" defaultValue={initial?.note ?? ""} className={inputCls} />
        </Field>
      </div>
      <fieldset className="space-y-3">
        <legend className="text-sm font-medium text-slate-700">{t("ledger.templates.rules")}</legend>
        <label className="flex items-center gap-2 text-sm text-slate-700">
          <input type="checkbox" name="digitsOnly" value="1" defaultChecked={rules.digitsOnly} className="h-4 w-4" />
          {t("ledger.templates.digitsOnly")}
        </label>
        <label className="flex items-center gap-2 text-sm text-slate-700">
          <input type="checkbox" name="childExtendsParent" value="1" defaultChecked={rules.childExtendsParent} className="h-4 w-4" />
          {t("ledger.templates.childExtendsParent")}
        </label>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          <Field label={t("ledger.templates.allowedLengths")} hint={t("ledger.templates.allowedLengthsHint")}>
            <input name="allowedLengths" defaultValue={rules.allowedLengths.join(", ")} className={inputCls} />
          </Field>
          <Field label={t("ledger.templates.maxDepth")} hint={t("ledger.templates.maxDepthHint")}>
            <input name="maxDepth" type="number" min={1} defaultValue={rules.maxDepth ?? ""} className={inputCls} />
          </Field>
        </div>
      </fieldset>
    </>
  );
}
