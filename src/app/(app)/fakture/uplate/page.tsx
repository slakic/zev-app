import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireActor, isManagement } from "@/server/actor";
import { listPayments, enterPayment, importBankCsv, type PaymentSortKey } from "@/server/services/payments";
import { listAccounts } from "@/server/services/finance";
import { listParties, partyDisplayName } from "@/server/services/ownership";
import { formatMoney, parseMoneyInput } from "@/lib/money";
import { formatDate, tEnum, t } from "@/lib/i18n";
import { PageHeader, Card, Table, Td, StatusBadge, Field, inputCls, SubmitBtn, Flash, RowActionLink, FilterBar, Pagination, BtnLink, type ColumnSpec } from "@/components/ui";

const paymentHeaders: ColumnSpec[] = [
  { label: "Datum", sortKey: "date" },
  { label: "Platilac", priority: "primary" },
  { label: "Poziv na broj", priority: "detail" },
  { label: "Iznos", align: "right", nowrap: true, sortKey: "amount" },
  { label: "Status" },
  { label: "Radnje" },
];

const PAYMENT_SORT_KEYS: PaymentSortKey[] = ["date", "amount"];
import { PdfStatementImport } from "@/components/pdf-statement-import";

async function enterPaymentAction(formData: FormData) {
  "use server";
  const actor = await requireActor("ACCOUNTANT");
  try {
    await enterPayment(actor, {
      accountId: String(formData.get("accountId")),
      date: new Date(String(formData.get("date"))),
      amount: parseMoneyInput(formData.get("amount") as string | null) ?? "",
      payerId: (formData.get("payerId") as string) || null,
      payerNameRaw: (formData.get("payerNameRaw") as string) || null,
      reference: (formData.get("reference") as string) || null,
      method: String(formData.get("method") || "BANK"),
    });
  } catch (e) {
    redirect(`/fakture/uplate?err=${encodeURIComponent(e instanceof Error ? e.message : "Greška")}`);
  }
  revalidatePath("/fakture/uplate");
}

async function importCsvAction(formData: FormData) {
  "use server";
  const actor = await requireActor("ACCOUNTANT");
  const file = formData.get("file") as File | null;
  if (!file || file.size === 0) redirect(`/fakture/uplate?err=${encodeURIComponent("Odaberite CSV fajl.")}`);
  const content = Buffer.from(await file!.arrayBuffer()).toString("utf8");
  try {
    const result = await importBankCsv(actor, {
      accountId: String(formData.get("accountId")),
      filename: file!.name,
      content,
      mapping: {
        dateCol: Number(formData.get("dateCol") ?? 0),
        amountCol: Number(formData.get("amountCol") ?? 1),
        payerCol: Number(formData.get("payerCol") ?? 2),
        referenceCol: Number(formData.get("referenceCol") ?? 3),
        purposeCol: formData.get("purposeCol") ? Number(formData.get("purposeCol")) : -1,
        delimiter: String(formData.get("delimiter") || ";"),
        skipRows: Number(formData.get("skipRows") ?? 1),
        decimalComma: formData.get("decimalComma") === "on",
        dateFormat: String(formData.get("dateFormat") || "DD.MM.YYYY"),
      },
    });
    redirect(`/fakture/uplate?msg=${encodeURIComponent(`Uvezeno ${result.imported} uplata (${result.errors.length} grešaka).`)}`);
  } catch (e) {
    if (e && typeof e === "object" && "digest" in e) throw e;
    redirect(`/fakture/uplate?err=${encodeURIComponent(e instanceof Error ? e.message : "Greška pri uvozu")}`);
  }
}

export default async function PaymentsPage({
  searchParams,
}: {
  searchParams: Promise<{ err?: string; msg?: string; status?: string; sort?: string; dir?: string; page?: string }>;
}) {
  const actor = await requireActor();
  const management = isManagement(actor);
  const sp = await searchParams;
  const { err, msg } = sp;

  function uplateHref(overrides: Partial<{ status: string; sort: string; dir: string; page: string }>) {
    const merged = { status: sp.status, sort: sp.sort, dir: sp.dir, page: sp.page, ...overrides };
    const params = new URLSearchParams();
    for (const [k, v] of Object.entries(merged)) if (v) params.set(k, v);
    return `/fakture/uplate?${params.toString()}`;
  }

  const paymentSortBy = PAYMENT_SORT_KEYS.includes(sp.sort as PaymentSortKey) ? (sp.sort as PaymentSortKey) : undefined;
  const paymentDir = sp.dir === "asc" ? "asc" : sp.dir === "desc" ? "desc" : undefined;
  const paymentPage = Math.max(1, Number(sp.page) || 1);
  const paymentFilter = management ? { status: sp.status || undefined } : undefined;
  const paymentResult = await listPayments(actor, paymentFilter, { sortBy: paymentSortBy, sortDir: paymentDir, page: paymentPage });
  const payments = paymentResult.rows;
  const [accounts, parties] = management ? await Promise.all([listAccounts(actor), listParties(actor)]) : [[], []];

  return (
    <div>
      <PageHeader title={management ? "Uplate i uparivanje" : "Moje uplate"} subtitle={management ? "Ručni unos, uvoz izvoda i raspoređivanje na fakture" : undefined} />
      <Flash err={err} msg={msg} />

      {management && actor.roles.includes("ACCOUNTANT") && (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <Card title="Ručni unos uplate">
            <form action={enterPaymentAction} className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <Field label="Račun">
                <select name="accountId" className={inputCls}>
                  {accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
                </select>
              </Field>
              <Field label="Datum"><input name="date" type="date" required className={inputCls} /></Field>
              <Field label="Iznos (KM)"><input name="amount" required className={inputCls} /></Field>
              <Field label="Platilac (iz evidencije)">
                <select name="payerId" className={inputCls}>
                  <option value="">— nepoznat —</option>
                  {parties.map((p) => <option key={p.id} value={p.id}>{partyDisplayName(p)}</option>)}
                </select>
              </Field>
              <Field label="Naziv platioca (sa izvoda)"><input name="payerNameRaw" className={inputCls} /></Field>
              <Field label="Poziv na broj"><input name="reference" className={inputCls} /></Field>
              <Field label="Način">
                <select name="method" className={inputCls}>
                  <option value="BANK">Banka</option>
                  <option value="CASH">Blagajna</option>
                </select>
              </Field>
              <div className="flex items-end"><SubmitBtn>Evidentiraj uplatu</SubmitBtn></div>
            </form>
          </Card>
          <Card title="Uvoz bankovnog izvoda (CSV)">
            <form action={importCsvAction} className="grid grid-cols-1 sm:grid-cols-2 gap-3" encType="multipart/form-data">
              <div className="sm:col-span-2">
                <Field label="CSV fajl"><input name="file" type="file" accept=".csv,text/csv" required className={inputCls} /></Field>
              </div>
              <Field label="Račun">
                <select name="accountId" className={inputCls}>
                  {accounts.filter((a) => a.type === "BANK").map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
                </select>
              </Field>
              <Field label="Separator"><input name="delimiter" defaultValue=";" className={inputCls} /></Field>
              <Field label="Kolona datuma (0+)"><input name="dateCol" type="number" defaultValue={0} className={inputCls} /></Field>
              <Field label="Kolona iznosa"><input name="amountCol" type="number" defaultValue={1} className={inputCls} /></Field>
              <Field label="Kolona platioca"><input name="payerCol" type="number" defaultValue={2} className={inputCls} /></Field>
              <Field label="Kolona poziva na broj"><input name="referenceCol" type="number" defaultValue={3} className={inputCls} /></Field>
              <Field label="Kolona svrhe uplate (opciono)" hint="Ostavite prazno ako izvod nema posebnu kolonu za svrhu.">
                <input name="purposeCol" type="number" className={inputCls} />
              </Field>
              <Field label="Preskoči redova (zaglavlje)"><input name="skipRows" type="number" defaultValue={1} className={inputCls} /></Field>
              <Field label="Format datuma">
                <select name="dateFormat" className={inputCls}>
                  <option value="DD.MM.YYYY">DD.MM.GGGG</option>
                  <option value="YYYY-MM-DD">GGGG-MM-DD</option>
                </select>
              </Field>
              <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="decimalComma" defaultChecked /> decimalni zarez (1.234,56)</label>
              <div className="flex items-end"><SubmitBtn>Uvezi</SubmitBtn></div>
            </form>
          </Card>
          <Card title="Uvoz bankovnog izvoda (PDF)" className="lg:col-span-2">
            <PdfStatementImport
              accounts={accounts.filter((a) => a.type === "BANK").map((a) => ({ id: a.id, name: a.name }))}
            />
          </Card>
        </div>
      )}

      <div className="mt-4">
        {management && (
          <FilterBar>
            {paymentSortBy && <input type="hidden" name="sort" value={paymentSortBy} />}
            {paymentDir && <input type="hidden" name="dir" value={paymentDir} />}
            <Field label="Status">
              <select name="status" defaultValue={sp.status ?? ""} className={inputCls}>
                <option value="">Svi</option>
                <option value="UNAPPLIED">{tEnum("paymentStatus", "UNAPPLIED")}</option>
                <option value="PARTIALLY_APPLIED">{tEnum("paymentStatus", "PARTIALLY_APPLIED")}</option>
                <option value="APPLIED">{tEnum("paymentStatus", "APPLIED")}</option>
                <option value="REVERSED">{tEnum("paymentStatus", "REVERSED")}</option>
              </select>
            </Field>
            {sp.status && <BtnLink href="/fakture/uplate" variant="secondary">Poništi filter</BtnLink>}
          </FilterBar>
        )}
        <Card title={management ? "Sve uplate" : "Moje evidentirane uplate"}>
          <Table
            id="payments-table"
            caption={management ? "Sve uplate" : "Moje evidentirane uplate"}
            headers={paymentHeaders}
            sort={{ active: paymentSortBy, dir: paymentDir, hrefFor: (key, d) => uplateHref({ sort: key, dir: d }) }}
            empty={payments.length === 0}
            emptyTitle={t(payments.length === 0 && sp.status ? "empty.filteredQuery.title" : "empty.payments.title")}
            emptyHint={
              payments.length === 0 && sp.status
                ? t("empty.filteredQuery.hint")
                : management && actor.roles.includes("ACCOUNTANT")
                  ? t("empty.payments.hint")
                  : undefined
            }
          >
            {payments.map((p) => (
              <tr key={p.id}>
                <Td>{formatDate(p.date)}</Td>
                <Td>{p.payer ? partyDisplayName(p.payer) : p.payerNameRaw ?? "—"}</Td>
                <Td className="font-mono text-xs">{p.reference ?? "—"}</Td>
                <Td>{formatMoney(p.amount.toString())}</Td>
                <Td><StatusBadge status={p.status} label={tEnum("paymentStatus", p.status)} /></Td>
                <Td>
                  {management && (
                    <RowActionLink href={`/fakture/uplate/${p.id}`}>
                      {p.status === "UNAPPLIED" || p.status === "PARTIALLY_APPLIED" ? "uparivanje" : "detalji"}
                    </RowActionLink>
                  )}
                </Td>
              </tr>
            ))}
          </Table>
          <Pagination page={paymentResult.page} pageCount={paymentResult.pageCount} hrefFor={(p) => uplateHref({ page: String(p) })} />
        </Card>
      </div>
    </div>
  );
}
