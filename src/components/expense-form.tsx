"use client";
// „Novi trošak” iza ToggleBtn-a (F5b.3). Forma je `useActionState` omotač: kad servis upozori na mogući duplikat, akcija
// vraća duplikate i SVE unesene vrijednosti — forma se ponovo crta popunjena (`key={nonce}` + `defaultValue`), iznad nje
// je `Flash warn inset` sa sumnjivim troškovima, a dugme „Ipak evidentiraj” (`caution`) šalje istu formu sa
// `allowDuplicate=on`. Osnovna forma nema checkbox „dozvoli duplikat”.
import { useActionState, useRef } from "react";
import { Card, Field, Flash, RowLink, ToggleBtn, btnBase, btnVariantCls, inputCls } from "@/components/ui";
import { EXPENSE_FORM_INITIAL, type ExpenseFormState } from "@/lib/expenseFormState";
import { formatDate } from "@/lib/i18n";
import { formatKm } from "@/lib/reviewSummary";
import { t, tf } from "@/lib/i18n";

type Opt = { id: string; label: string };

const LEGEND = "mb-1 text-xs font-semibold uppercase tracking-wider text-slate-500";

export function ExpenseForm({
  action, suppliers, buildings, projects, planItems,
}: {
  action: (prev: ExpenseFormState, formData: FormData) => Promise<ExpenseFormState>;
  suppliers: Opt[];
  buildings: Opt[];
  projects: Opt[];
  planItems: Opt[];
}) {
  const [state, formAction, pending] = useActionState(action, EXPENSE_FORM_INITIAL);
  const values = state.status === "duplicate" || state.status === "error" ? state.values : {};
  const formRef = useRef<HTMLFormElement>(null);
  const allowRef = useRef<HTMLInputElement>(null);
  // „Ipak evidentiraj” NIJE submit dugme: Enter u polju forme bi inače (kao prvo dugme u stablu) slao sa allowDuplicate.
  function forceSubmit() {
    if (!formRef.current || !allowRef.current) return;
    allowRef.current.value = "on";
    formRef.current.requestSubmit();
    allowRef.current.value = "";
  }
  const needsAttention = state.status === "duplicate" || state.status === "error";

  return (
    <div className="mb-4">
      {state.status === "saved" && <Flash msg={t("expenseForm.saved")} />}
      <details className="group" open={needsAttention || undefined}>
        <ToggleBtn>{t("expenseForm.toggle")}</ToggleBtn>
        <div className="mt-3">
          <Card title={t("expenseForm.title")}>
            <form key={state.nonce} ref={formRef} action={formAction} className="space-y-4">
              <input type="hidden" name="allowDuplicate" defaultValue="" ref={allowRef} />
              {state.status === "error" && <Flash err={state.error} inset />}
              {state.status === "duplicate" && (
                <Flash
                  warn={
                    <div className="space-y-2">
                      <p className="font-medium">{t("expenseForm.duplicateTitle")}</p>
                      <p>{t("expenseForm.duplicateHint")}</p>
                      <ul className="list-disc space-y-1 pl-5">
                        {state.duplicates.map((d) => (
                          <li key={d.id}>
                            {tf("expenseForm.duplicateRow", {
                              broj: d.invoiceNumber ?? t("expenseForm.noNumber"),
                              dobavljac: d.supplierName ?? "—",
                              iznos: formatKm(d.amount),
                              datum: d.invoiceDate ? formatDate(d.invoiceDate) : "—",
                            })}{" "}
                            <RowLink newTab href={d.supplierId ? `/troskovi?tab=troskovi&supplier=${encodeURIComponent(d.supplierId)}` : "/troskovi?tab=troskovi"}>
                              {t("expenseForm.view")}
                            </RowLink>
                          </li>
                        ))}
                      </ul>
                      <button type="button" onClick={forceSubmit} disabled={pending} className={`${btnBase} ${btnVariantCls.caution}`}>
                        {t("expenseForm.force")}
                      </button>
                    </div>
                  }
                  inset
                />
              )}
              <fieldset className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                <legend className={LEGEND}>{t("expenseForm.legendInvoice")}</legend>
                <Field label={t("expenseForm.supplier")}>
                  <select name="supplierId" defaultValue={values.supplierId ?? ""} className={inputCls}>
                    <option value="">—</option>
                    {suppliers.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
                  </select>
                </Field>
                <Field label={t("expenseForm.invoiceNumber")}><input name="invoiceNumber" defaultValue={values.invoiceNumber ?? ""} className={inputCls} /></Field>
                <Field label={t("expenseForm.invoiceDate")}><input name="invoiceDate" type="date" defaultValue={values.invoiceDate ?? ""} className={inputCls} /></Field>
                <Field label={t("expenseForm.amount")}><input name="amount" required inputMode="decimal" defaultValue={values.amount ?? ""} className={inputCls} /></Field>
                <Field label={t("expenseForm.dueDate")}><input name="dueDate" type="date" defaultValue={values.dueDate ?? ""} className={inputCls} /></Field>
                <Field label={t("expenseForm.description")}><input name="description" defaultValue={values.description ?? ""} className={inputCls} /></Field>
              </fieldset>
              <fieldset className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                <legend className={LEGEND}>{t("expenseForm.legendLayout")}</legend>
                <Field label={t("expenseForm.category")}>
                  <input name="categoryName" defaultValue={values.categoryName ?? ""} className={inputCls} placeholder={t("expenseForm.categoryPlaceholder")} />
                </Field>
                <Field label={t("expenseForm.building")}>
                  <select name="buildingId" defaultValue={values.buildingId ?? ""} className={inputCls}>
                    <option value="">{t("expenseForm.wholeZev")}</option>
                    {buildings.map((b) => <option key={b.id} value={b.id}>{b.label}</option>)}
                  </select>
                </Field>
                <label className="flex items-center gap-2 pb-2 text-sm sm:self-end">
                  <input type="checkbox" name="recurring" defaultChecked={values.recurring === "on"} /> {t("expenseForm.recurring")}
                </label>
              </fieldset>
              <fieldset className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <legend className={LEGEND}>{t("expenseForm.legendLinks")}</legend>
                <Field label={t("expenseForm.project")}>
                  <select name="projectId" defaultValue={values.projectId ?? ""} className={inputCls}>
                    <option value="">—</option>
                    {projects.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
                  </select>
                </Field>
                <Field label={t("expenseForm.planItem")}>
                  <select name="planItemId" defaultValue={values.planItemId ?? ""} className={inputCls}>
                    <option value="">—</option>
                    {planItems.map((pi) => <option key={pi.id} value={pi.id}>{pi.label}</option>)}
                  </select>
                </Field>
              </fieldset>
              <div>
                <button type="submit" disabled={pending} className={`${btnBase} ${btnVariantCls.primary}`}>
                  {t("expenseForm.submit")}
                </button>
              </div>
            </form>
          </Card>
        </div>
      </details>
    </div>
  );
}
