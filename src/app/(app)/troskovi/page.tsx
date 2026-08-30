import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireActor } from "@/server/actor";
import { listExpenses, listSuppliers, createSupplier, createExpense, payExpense, cancelExpense, DuplicateExpenseWarning } from "@/server/services/expenses";
import { listAccounts, ensureCategory } from "@/server/services/finance";
import { listBuildings } from "@/server/services/property";
import { listProjects } from "@/server/services/plans";
import { prisma } from "@/lib/prisma";
import { formatMoney, parseMoneyInput } from "@/lib/money";
import { formatDate, tEnum } from "@/lib/i18n";
import { PageHeader, Card, Table, Td, StatusBadge, Field, inputCls, SubmitBtn, Flash } from "@/components/ui";

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

async function addExpenseAction(formData: FormData) {
  "use server";
  const actor = await requireActor("ACCOUNTANT", "PRESIDENT");
  const categoryName = (formData.get("categoryName") as string) || null;
  let categoryId: string | null = null;
  if (categoryName) {
    categoryId = (await ensureCategory(categoryName, "EXPENSE")).id;
  }
  try {
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
      redirect(`/troskovi?err=${encodeURIComponent(`UPOZORENJE: mogući duplikat (${e.duplicates.map((d) => d.invoiceNumber ?? d.id).join(", ")}). Označite "dozvoli duplikat" ako je unos ispravan.`)}`);
    }
    redirect(`/troskovi?err=${encodeURIComponent(e instanceof Error ? e.message : "Greška")}`);
  }
  revalidatePath("/troskovi");
}

async function payExpenseAction(formData: FormData) {
  "use server";
  const actor = await requireActor("ACCOUNTANT");
  try {
    await payExpense(actor, {
      expenseId: String(formData.get("expenseId")),
      accountId: String(formData.get("accountId")),
      date: new Date(),
    });
  } catch (e) {
    redirect(`/troskovi?err=${encodeURIComponent(e instanceof Error ? e.message : "Greška")}`);
  }
  revalidatePath("/troskovi");
}

async function cancelExpenseAction(formData: FormData) {
  "use server";
  const actor = await requireActor("ACCOUNTANT");
  try {
    await cancelExpense(actor, String(formData.get("expenseId")), String(formData.get("reason") || "Storno"));
  } catch (e) {
    redirect(`/troskovi?err=${encodeURIComponent(e instanceof Error ? e.message : "Greška")}`);
  }
  revalidatePath("/troskovi");
}

export default async function ExpensesPage({ searchParams }: { searchParams: Promise<{ err?: string }> }) {
  const actor = await requireActor("ACCOUNTANT", "PRESIDENT");
  const { err } = await searchParams;
  const [expenses, suppliers, accounts, buildings, projects, planItems] = await Promise.all([
    listExpenses(actor),
    listSuppliers(actor),
    listAccounts(actor),
    listBuildings(actor),
    listProjects(actor),
    prisma.planItem.findMany({ where: { plan: { status: "APPROVED" } }, include: { plan: true } }),
  ]);
  return (
    <div>
      <PageHeader title="Troškovi i dobavljači" subtitle="Ulazne fakture, plaćanja, veza sa planom i održavanjem" />
      <Flash err={err} />
      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="Dobavljači i izvođači">
          <Table headers={["Naziv", "JIB", "Račun", "Kontakt"]} empty={suppliers.length === 0}>
            {suppliers.map((s) => (
              <tr key={s.id}>
                <Td>{s.name}</Td>
                <Td>{s.jib ?? "—"}</Td>
                <Td className="font-mono text-xs">{s.iban ?? "—"}</Td>
                <Td>{s.email ?? s.phone ?? "—"}</Td>
              </tr>
            ))}
          </Table>
          <details className="mt-3">
            <summary className="cursor-pointer text-sm font-medium text-blue-700">+ Novi dobavljač</summary>
            <form action={addSupplierAction} className="mt-3 grid grid-cols-2 gap-3">
              <Field label="Naziv"><input name="name" required className={inputCls} /></Field>
              <Field label="JIB"><input name="jib" className={inputCls} /></Field>
              <Field label="Žiro račun"><input name="iban" className={inputCls} /></Field>
              <Field label="E-mail"><input name="email" className={inputCls} /></Field>
              <Field label="Telefon"><input name="phone" className={inputCls} /></Field>
              <div className="flex items-end"><SubmitBtn>Sačuvaj</SubmitBtn></div>
            </form>
          </details>
        </Card>

        <Card title="Novi trošak (ulazna faktura)">
          <form action={addExpenseAction} className="grid grid-cols-2 gap-3">
            <Field label="Dobavljač">
              <select name="supplierId" className={inputCls}>
                <option value="">—</option>
                {suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </Field>
            <Field label="Broj fakture dobavljača"><input name="invoiceNumber" className={inputCls} /></Field>
            <Field label="Datum fakture"><input name="invoiceDate" type="date" className={inputCls} /></Field>
            <Field label="Iznos (KM)"><input name="amount" required className={inputCls} /></Field>
            <Field label="Rok plaćanja"><input name="dueDate" type="date" className={inputCls} /></Field>
            <Field label="Kategorija"><input name="categoryName" className={inputCls} placeholder="Struja zajedničkih prostorija" /></Field>
            <Field label="Zgrada">
              <select name="buildingId" className={inputCls}>
                <option value="">Cijela ZEV</option>
                {buildings.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
              </select>
            </Field>
            <Field label="Projekat">
              <select name="projectId" className={inputCls}>
                <option value="">—</option>
                {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
              </select>
            </Field>
            <Field label="Stavka godišnjeg plana">
              <select name="planItemId" className={inputCls}>
                <option value="">—</option>
                {planItems.map((pi) => <option key={pi.id} value={pi.id}>{pi.plan.year}: {pi.name}</option>)}
              </select>
            </Field>
            <Field label="Opis"><input name="description" className={inputCls} /></Field>
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="recurring" /> ponavljajući (mjesečno)</label>
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="allowDuplicate" /> dozvoli mogući duplikat</label>
            <div className="col-span-2"><SubmitBtn>Evidentiraj trošak</SubmitBtn></div>
          </form>
        </Card>
      </div>

      <div className="mt-4">
        <Card title="Troškovi">
          <Table headers={["Dobavljač", "Br. fakture", "Datum", "Kategorija", "Iznos", "Plaćeno", "Rok", "Status", "Radnje"]} empty={expenses.length === 0}>
            {expenses.map((e) => (
              <tr key={e.id}>
                <Td>{e.supplier?.name ?? "—"}</Td>
                <Td>{e.invoiceNumber ?? "—"}</Td>
                <Td>{formatDate(e.invoiceDate)}</Td>
                <Td>{e.category?.name ?? "—"}</Td>
                <Td right>{formatMoney(e.amount.toString())}</Td>
                <Td right>{formatMoney(e.paidAmount.toString())}</Td>
                <Td>{formatDate(e.dueDate)}</Td>
                <Td><StatusBadge status={e.status} label={tEnum("expenseStatus", e.status)} /></Td>
                <Td>
                  {(e.status === "UNPAID" || e.status === "PARTIALLY_PAID") && actor.roles.includes("ACCOUNTANT") && (
                    <div className="flex items-center gap-2">
                      <form action={payExpenseAction} className="flex items-center gap-1">
                        <input type="hidden" name="expenseId" value={e.id} />
                        <select name="accountId" className="rounded border border-slate-300 px-1 py-0.5 text-xs">
                          {accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
                        </select>
                        <button className="text-xs text-blue-700 hover:underline">plati</button>
                      </form>
                      <form action={cancelExpenseAction} className="flex items-center gap-1">
                        <input type="hidden" name="expenseId" value={e.id} />
                        <input name="reason" placeholder="razlog" className="w-20 rounded border border-slate-300 px-1 py-0.5 text-xs" />
                        <button className="text-xs text-red-700 hover:underline">storno</button>
                      </form>
                    </div>
                  )}
                </Td>
              </tr>
            ))}
          </Table>
        </Card>
      </div>
    </div>
  );
}
