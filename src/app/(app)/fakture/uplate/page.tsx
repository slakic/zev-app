import Link from "next/link";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireActor, isManagement } from "@/server/actor";
import { listPayments, enterPayment, importBankCsv } from "@/server/services/payments";
import { listAccounts } from "@/server/services/finance";
import { listParties, partyDisplayName } from "@/server/services/ownership";
import { formatMoney, parseMoneyInput } from "@/lib/money";
import { formatDate, tEnum } from "@/lib/i18n";
import { PageHeader, Card, Table, Td, StatusBadge, Field, inputCls, SubmitBtn, Flash } from "@/components/ui";
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

export default async function PaymentsPage({ searchParams }: { searchParams: Promise<{ err?: string; msg?: string }> }) {
  const actor = await requireActor();
  const management = isManagement(actor);
  const { err, msg } = await searchParams;
  const payments = await listPayments(actor);
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
        <Card title={management ? "Sve uplate" : "Moje evidentirane uplate"}>
          <Table headers={["Datum", "Platilac", "Poziv na broj", "Iznos", "Status", ""]} empty={payments.length === 0}>
            {payments.map((p) => (
              <tr key={p.id}>
                <Td>{formatDate(p.date)}</Td>
                <Td>{p.payer ? partyDisplayName(p.payer) : p.payerNameRaw ?? "—"}</Td>
                <Td className="font-mono text-xs">{p.reference ?? "—"}</Td>
                <Td right>{formatMoney(p.amount.toString())}</Td>
                <Td><StatusBadge status={p.status} label={tEnum("paymentStatus", p.status)} /></Td>
                <Td>
                  {management && (
                    <Link href={`/fakture/uplate/${p.id}`} className="text-sm text-blue-700 hover:underline">
                      {p.status === "UNAPPLIED" || p.status === "PARTIALLY_APPLIED" ? "uparivanje" : "detalji"}
                    </Link>
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
