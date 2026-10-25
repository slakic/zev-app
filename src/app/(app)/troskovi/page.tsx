import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireActor } from "@/server/actor";
import { requireZev } from "@/server/auth/guards";
import { listExpenses, listSuppliers, createSupplier, createExpense, payExpense, cancelExpense, DuplicateExpenseWarning } from "@/server/services/expenses";
import { listAccounts, ensureCategory } from "@/server/services/finance";
import { listBuildings } from "@/server/services/property";
import { listProjects } from "@/server/services/plans";
import { prisma } from "@/lib/prisma";
import { EXPENSE_DUE_DAYS } from "@/lib/accountantTasks";
import { formatMoney, parseMoneyInput, dec } from "@/lib/money";
import { formatDate, tEnum, t, tf, toZonedDateIso } from "@/lib/i18n";
import { ExpenseForm } from "@/components/expense-form";
import { expenseValuesFromForm, type ExpenseFormState } from "@/lib/expenseFormState";
import { PageHeader, Card, Table, Td, StatusBadge, Field, inputCls, SubmitBtn, Flash, ToggleBtn, ConfirmAction, Tabs, FilterBar, BtnLink, type ColumnSpec } from "@/components/ui";

const supplierHeaders: ColumnSpec[] = [
  { label: "Naziv" },
  { label: "JIB" },
  { label: "Račun" },
  { label: "Kontakt" },
];

const expenseHeaders: ColumnSpec[] = [
  { label: "Dobavljač", priority: "primary" },
  { label: "Br. fakture", priority: "detail" },
  { label: "Datum", sortKey: "date" },
  { label: "Kategorija", priority: "detail" },
  { label: "Iznos", align: "right", nowrap: true, sortKey: "amount" },
  { label: "Plaćeno", align: "right", nowrap: true },
  { label: "Rok", sortKey: "due" },
  { label: "Status" },
  { label: "Radnje" },
];

async function addSupplierAction(formData: FormData) {
  "use server";
  const actor = await requireActor("ACCOUNTANT", "PRESIDENT");
  await createSupplier(actor, {
    name: String(formData.get("name")),
    jib: (formData.get("jib") as string) || null,
    iban: (formData.get("iban") as string) || null,
    email: (formData.get("email") as string) || null,
    phone: (formData.get("phone") as string) || null,
  });
  revalidatePath("/troskovi");
}

/** `useActionState` akcija (F5b.3): ne preusmjerava, nego vraća stanje — pri upozorenju o duplikatu to su duplikati i sve unesene vrijednosti. */
async function addExpenseAction(prev: ExpenseFormState, formData: FormData): Promise<ExpenseFormState> {
  "use server";
  const actor = await requireActor("ACCOUNTANT", "PRESIDENT");
  const values = expenseValuesFromForm((n) => formData.get(n));
  const nonce = prev.nonce + 1;
  try {
    const categoryName = (formData.get("categoryName") as string) || null;
    let categoryId: string | null = null;
    if (categoryName) {
      categoryId = (await ensureCategory(actor, categoryName, "EXPENSE")).id;
    }
    await createExpense(actor, {
      supplierId: (formData.get("supplierId") as string) || null,
      invoiceNumber: (formData.get("invoiceNumber") as string) || null,
      invoiceDate: formData.get("invoiceDate") ? new Date(String(formData.get("invoiceDate"))) : null,
      categoryId,
      amount: parseMoneyInput(formData.get("amount") as string | null) ?? "",
      dueDate: formData.get("dueDate") ? new Date(String(formData.get("dueDate"))) : null,
      buildingId: (formData.get("buildingId") as string) || null,
      projectId: (formData.get("projectId") as string) || null,
      planItemId: (formData.get("planItemId") as string) || null,
      description: (formData.get("description") as string) || null,
      recurring: formData.get("recurring") === "on",
      recurrenceRule: formData.get("recurring") === "on" ? "MONTHLY" : null,
      allowDuplicate: formData.get("allowDuplicate") === "on",
    });
  } catch (e) {
    if (e instanceof DuplicateExpenseWarning) {
      return {
        status: "duplicate",
        nonce,
        values,
        duplicates: e.duplicates.map((d) => ({
          id: d.id,
          invoiceNumber: d.invoiceNumber,
          amount: d.amount,
          supplierId: d.supplierId ?? null,
          supplierName: d.supplierName ?? null,
          invoiceDate: d.invoiceDate ?? null,
        })),
      };
    }
    return { status: "error", nonce, values, error: e instanceof Error ? e.message : "Greška" };
  }
  revalidatePath("/troskovi");
  return { status: "saved", nonce };
}

async function payExpenseAction(formData: FormData) {
  "use server";
  const actor = await requireActor("ACCOUNTANT");
  try {
    await payExpense(actor, {
      expenseId: String(formData.get("expenseId")),
      accountId: String(formData.get("accountId") ?? ""),
      date: formData.get("date") ? new Date(String(formData.get("date"))) : new Date(),
      amount: parseMoneyInput(formData.get("amount") as string | null) ?? undefined,
    });
  } catch (e) {
    redirect(`/troskovi?tab=troskovi&err=${encodeURIComponent(e instanceof Error ? e.message : "Greška")}`);
  }
  revalidatePath("/troskovi");
}

async function cancelExpenseAction(formData: FormData) {
  "use server";
  const actor = await requireActor("ACCOUNTANT");
  try {
    await cancelExpense(actor, String(formData.get("expenseId")), String(formData.get("reason") ?? ""));
  } catch (e) {
    redirect(`/troskovi?tab=troskovi&err=${encodeURIComponent(e instanceof Error ? e.message : "Greška")}`);
  }
  revalidatePath("/troskovi");
}

export default async function ExpensesPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string; err?: string; status?: string; supplier?: string; rok?: string; sort?: string; dir?: string }>;
}) {
  const actor = await requireActor("ACCOUNTANT", "PRESIDENT");
  const zevId = requireZev(actor);
  const sp = await searchParams;
  const { tab, err } = sp;
  const activeTab = tab === "dobavljaci" ? "dobavljaci" : "troskovi";

  // „Rok plaćanja”: ista kalendarska definicija kao brojač „Troškovi koji dospijevaju” na početnoj računovođe (`expensesDueWhere`).
  const dueWithinDays = sp.rok === String(EXPENSE_DUE_DAYS) ? EXPENSE_DUE_DAYS : undefined;

  function troskoviHref(overrides: Partial<{ status: string; supplier: string; rok: string; sort: string; dir: string }>) {
    const merged = { status: sp.status, supplier: sp.supplier, rok: sp.rok, sort: sp.sort, dir: sp.dir, ...overrides };
    const params = new URLSearchParams({ tab: "troskovi" });
    for (const [k, v] of Object.entries(merged)) if (v) params.set(k, v);
    return `/troskovi?${params.toString()}`;
  }

  const expenseSort = sp.sort === "amount" || sp.sort === "due" ? sp.sort : sp.sort === "date" ? "date" : undefined;
  const expenseDir: "asc" | "desc" | undefined = sp.dir === "asc" ? "asc" : sp.dir === "desc" ? "desc" : undefined;
  const [suppliers, expenseCount] = await Promise.all([listSuppliers(actor), prisma.expense.count({ where: { zevId } })]);
  const [rawExpenses, accounts, buildings, projects, planItems] =
    activeTab === "troskovi"
      ? await Promise.all([
          listExpenses(actor, { status: sp.status || undefined, supplierId: sp.supplier || undefined, dueWithinDays }),
          listAccounts(actor),
          listBuildings(actor),
          listProjects(actor),
          // zevId added 2026-09-09 — was unscoped, populating this dropdown with every
          // tenant's approved plan items (createExpense itself does validate zevId, so this
          // was a UI-only leak, not a write-path one — see docs/multitenancy-plan.md addendum).
          prisma.planItem.findMany({ where: { zevId, plan: { status: "APPROVED" } }, include: { plan: true } }),
        ])
      : [[], [], [], [], []];
  const expenses = expenseSort
    ? [...rawExpenses].sort((a, b) => {
        const dir = expenseDir === "desc" ? -1 : 1;
        const av = expenseSort === "amount" ? Number(a.amount.toString()) : (expenseSort === "due" ? a.dueDate : a.invoiceDate)?.getTime() ?? 0;
        const bv = expenseSort === "amount" ? Number(b.amount.toString()) : (expenseSort === "due" ? b.dueDate : b.invoiceDate)?.getTime() ?? 0;
        return (av - bv) * dir;
      })
    : rawExpenses;
  return (
    <div>
      <PageHeader title="Troškovi i dobavljači" subtitle="Ulazne fakture, plaćanja, veza sa planom i održavanjem" />
      <Flash err={err} />
      <Tabs
        tabs={[
          { key: "troskovi", label: "Troškovi", count: expenseCount },
          { key: "dobavljaci", label: "Dobavljači", count: suppliers.length },
        ]}
        active={activeTab}
        hrefFor={(key) => `/troskovi?tab=${key}`}
      />
      {activeTab === "dobavljaci" && (
        <Card title="Dobavljači i izvođači">
          <Table
            id="suppliers-table"
            caption="Dobavljači i izvođači"
            headers={supplierHeaders}
            empty={suppliers.length === 0}
            emptyTitle={t("empty.suppliers.title")}
            emptyHint={t("empty.suppliers.hint")}
          >
            {suppliers.map((s) => (
              <tr key={s.id}>
                <Td>{s.name}</Td>
                <Td>{s.jib ?? "—"}</Td>
                <Td className="font-mono text-[13px]">{s.iban ?? "—"}</Td>
                <Td>{s.email ?? s.phone ?? "—"}</Td>
              </tr>
            ))}
          </Table>
          <details className="group mt-3">
            <ToggleBtn>Novi dobavljač</ToggleBtn>
            <form action={addSupplierAction} className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-3">
              <Field label="Naziv"><input name="name" required className={inputCls} /></Field>
              <Field label="JIB"><input name="jib" className={inputCls} /></Field>
              <Field label="Žiro račun"><input name="iban" className={inputCls} /></Field>
              <Field label="E-mail"><input name="email" className={inputCls} /></Field>
              <Field label="Telefon"><input name="phone" className={inputCls} /></Field>
              <div className="flex items-end"><SubmitBtn>Sačuvaj</SubmitBtn></div>
            </form>
          </details>
        </Card>
      )}

      {activeTab === "troskovi" && (
      <>
        <ExpenseForm
          action={addExpenseAction}
          suppliers={suppliers.map((s) => ({ id: s.id, label: s.name }))}
          buildings={buildings.map((b) => ({ id: b.id, label: b.name }))}
          projects={projects.map((p) => ({ id: p.id, label: p.name }))}
          planItems={planItems.map((pi) => ({ id: pi.id, label: `${pi.plan.year}: ${pi.name}` }))}
        />
        <FilterBar>
          <input type="hidden" name="tab" value="troskovi" />
          {expenseSort && <input type="hidden" name="sort" value={expenseSort} />}
          {expenseDir && <input type="hidden" name="dir" value={expenseDir} />}
          <Field label="Status">
            <select name="status" defaultValue={sp.status ?? ""} className={inputCls}>
              <option value="">Svi</option>
              <option value="UNPAID">{tEnum("expenseStatus", "UNPAID")}</option>
              <option value="PARTIALLY_PAID">{tEnum("expenseStatus", "PARTIALLY_PAID")}</option>
              <option value="PAID">{tEnum("expenseStatus", "PAID")}</option>
              <option value="CANCELLED">{tEnum("expenseStatus", "CANCELLED")}</option>
            </select>
          </Field>
          <Field label="Dobavljač">
            <select name="supplier" defaultValue={sp.supplier ?? ""} className={inputCls}>
              <option value="">Svi</option>
              {suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </Field>
          <Field label={t("expensesFilter.due")}>
            <select name="rok" defaultValue={dueWithinDays ? String(dueWithinDays) : ""} className={inputCls}>
              <option value="">{t("expensesFilter.any")}</option>
              <option value={EXPENSE_DUE_DAYS}>{t("expensesFilter.dueSoon")}</option>
            </select>
          </Field>
          {(sp.status || sp.supplier || dueWithinDays) && <BtnLink href="/troskovi?tab=troskovi" variant="secondary">Poništi filter</BtnLink>}
        </FilterBar>
        <Card title="Troškovi">
          <Table
            id="expenses-table"
            caption="Troškovi"
            headers={expenseHeaders}
            sort={{ active: expenseSort, dir: expenseDir, hrefFor: (key, d) => troskoviHref({ sort: key, dir: d }) }}
            empty={expenses.length === 0}
            emptyTitle={t(expenses.length === 0 && (sp.status || sp.supplier || dueWithinDays) ? "empty.filteredQuery.title" : "empty.expenses.title")}
            emptyHint={
              expenses.length === 0 && (sp.status || sp.supplier || dueWithinDays)
                ? t("empty.filteredQuery.hint")
                : t("empty.expenses.hint")
            }
          >
            {expenses.map((e) => (
              <tr key={e.id}>
                <Td>{e.supplier?.name ?? "—"}</Td>
                <Td>{e.invoiceNumber ?? "—"}</Td>
                <Td>{formatDate(e.invoiceDate)}</Td>
                <Td>{e.category?.name ?? "—"}</Td>
                <Td>{formatMoney(e.amount.toString())}</Td>
                <Td>{formatMoney(e.paidAmount.toString())}</Td>
                <Td>{formatDate(e.dueDate)}</Td>
                <Td><StatusBadge status={e.status} label={tEnum("expenseStatus", e.status)} /></Td>
                <Td>
                  {(e.status === "UNPAID" || e.status === "PARTIALLY_PAID") && actor.roles.includes("ACCOUNTANT") && (() => {
                    const remaining = dec(e.amount.toString()).minus(dec(e.paidAmount.toString()));
                    const who = e.supplier?.name ?? "—";
                    const docNo = e.invoiceNumber ?? "—";
                    return (
                      <div className="flex flex-wrap items-center gap-1.5">
                        <div className="min-w-0 max-w-full">
                        <ConfirmAction
                          trigger="Plati…"
                          triggerVariant="caution"
                          title={t("confirm.expensePay.title")}
                          body={
                            <p className="text-sm text-amber-900">
                              {tf("confirm.expensePay.body", { dobavljac: who, broj: docNo, preostalo: formatMoney(remaining.toFixed(2)) })}
                            </p>
                          }
                          confirmLabel={t("confirm.expensePay.confirm")}
                          confirmVariant="primary"
                          action={payExpenseAction}
                          hiddenFields={{ expenseId: e.id }}
                        >
                          <Field label="Račun">
                            <select name="accountId" required defaultValue="" className={inputCls}>
                              <option value="">{t("confirm.expensePay.chooseAccount")}</option>
                              {accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
                            </select>
                          </Field>
                          <Field label="Datum plaćanja">
                            <input name="date" type="date" required defaultValue={toZonedDateIso(new Date())} className={inputCls} />
                          </Field>
                          <Field label="Iznos (KM)" hint={t("confirm.expensePay.amountHint")}>
                            <input name="amount" required inputMode="decimal" defaultValue={remaining.toFixed(2)} className={inputCls} />
                          </Field>
                        </ConfirmAction>
                        </div>
                        {dec(e.paidAmount.toString()).isZero() && (
                          <div className="min-w-0 max-w-full">
                          <ConfirmAction
                            trigger="Storniraj"
                            triggerVariant="caution"
                            title={t("confirm.expenseCancel.title")}
                            body={
                              <p className="text-sm text-amber-900">
                                {tf("confirm.expenseCancel.body", { dobavljac: who, broj: docNo, iznos: formatMoney(e.amount.toString()) })}
                              </p>
                            }
                            confirmLabel={t("confirm.expenseCancel.confirm")}
                            confirmVariant="caution"
                            action={cancelExpenseAction}
                            hiddenFields={{ expenseId: e.id }}
                          >
                            <Field label="Razlog storniranja"><input name="reason" required className={inputCls} /></Field>
                          </ConfirmAction>
                          </div>
                        )}
                      </div>
                    );
                  })()}
                </Td>
              </tr>
            ))}
          </Table>
        </Card>

      </>
      )}
    </div>
  );
}
