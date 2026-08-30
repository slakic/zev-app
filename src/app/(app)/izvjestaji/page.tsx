import { requireActor } from "@/server/actor";
import { cashFlowReport, incomeExpenseReport, receivablesReport, supplierReport, unpaidSupplierInvoices, allocationSummary } from "@/server/services/reports";
import { reserveFundBalance } from "@/server/services/finance";
import { formatMoney } from "@/lib/money";
import { formatDate } from "@/lib/i18n";
import { PageHeader, Card, Table, Td, BtnLink } from "@/components/ui";

export default async function ReportsPage({ searchParams }: { searchParams: Promise<{ from?: string; to?: string }> }) {
  const actor = await requireActor("PRESIDENT", "ACCOUNTANT");
  const sp = await searchParams;
  const range = {
    from: sp.from ? new Date(sp.from) : undefined,
    to: sp.to ? new Date(sp.to) : undefined,
  };
  const [cashFlow, incExp, receivables, suppliers, supplierUnpaid, fund, byBuilding, byProject] = await Promise.all([
    cashFlowReport(actor, range),
    incomeExpenseReport(actor, range),
    receivablesReport(actor, range.to ?? new Date()),
    supplierReport(actor, range),
    unpaidSupplierInvoices(actor),
    reserveFundBalance(actor),
    allocationSummary(actor, "building", range),
    allocationSummary(actor, "project", range),
  ]);
  const csvQ = `?from=${sp.from ?? ""}&to=${sp.to ?? ""}`;
  return (
    <div>
      <PageHeader
        title="Izvještaji"
        subtitle="Operativni finansijski pregledi — izvoz u CSV za eksternog računovođu"
      />
      <form className="mb-4 flex flex-wrap items-end gap-3 rounded-lg border border-slate-200 bg-white p-3">
        <label className="text-sm">Od <input type="date" name="from" defaultValue={sp.from} className="ml-1 rounded border border-slate-300 px-2 py-1" /></label>
        <label className="text-sm">Do <input type="date" name="to" defaultValue={sp.to} className="ml-1 rounded border border-slate-300 px-2 py-1" /></label>
        <button className="rounded-md bg-blue-600 px-3 py-1.5 text-sm font-medium text-white">Primijeni period</button>
      </form>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="Stanje računa i tok novca">
          <Table headers={["Račun", "Početno", "Prilivi", "Odlivi", "Neto", "Trenutno stanje"]} empty={cashFlow.length === 0}>
            {cashFlow.map((r) => (
              <tr key={r.accountId}>
                <Td>{r.accountName}</Td>
                <Td right>{formatMoney(r.opening, "")}</Td>
                <Td right>{formatMoney(r.income, "")}</Td>
                <Td right>{formatMoney(r.expense, "")}</Td>
                <Td right>{formatMoney(r.net, "")}</Td>
                <Td right className="font-semibold">{formatMoney(r.currentBalance, "")}</Td>
              </tr>
            ))}
          </Table>
          <div className="mt-2"><BtnLink href={`/api/izvjestaji/csv${csvQ}&type=cashflow`} variant="secondary">Izvoz CSV</BtnLink></div>
        </Card>

        <Card title="Prihodi i rashodi po kategorijama">
          <Table headers={["Kategorija", "Vrsta", "Iznos"]} empty={incExp.length === 0}>
            {incExp.map((r, i) => (
              <tr key={i}>
                <Td>{r.category}</Td>
                <Td>{r.kind === "INCOME" ? "Prihod" : "Rashod"}</Td>
                <Td right>{formatMoney(r.total, "")}</Td>
              </tr>
            ))}
          </Table>
          <div className="mt-2"><BtnLink href={`/api/izvjestaji/csv${csvQ}&type=incexp`} variant="secondary">Izvoz CSV</BtnLink></div>
        </Card>

        <Card title={`Neplaćene fakture vlasnika (otvoreno: ${formatMoney(receivables.totalOpen)} · dospjelo: ${formatMoney(receivables.totalOverdue)})`}>
          <Table headers={["Faktura", "Dužnik", "Jedinica", "Dospijeće", "Otvoreno", "Starost"]} empty={receivables.rows.length === 0}>
            {receivables.rows.map((r) => (
              <tr key={r.invoiceId}>
                <Td>{r.number}</Td>
                <Td>{r.debtor}</Td>
                <Td>{r.unit}</Td>
                <Td>{formatDate(r.dueDate)}</Td>
                <Td right>{formatMoney(r.open, "")}</Td>
                <Td>{r.bucket}</Td>
              </tr>
            ))}
          </Table>
          <div className="mt-2"><BtnLink href={`/api/izvjestaji/csv${csvQ}&type=receivables`} variant="secondary">Izvoz CSV (starosna struktura)</BtnLink></div>
        </Card>

        <Card title="Dobavljači">
          <Table headers={["Dobavljač", "Faktura", "Ukupno", "Neplaćeno"]} empty={suppliers.length === 0}>
            {suppliers.map((s, i) => (
              <tr key={i}>
                <Td>{s.supplier}</Td>
                <Td right>{s.count}</Td>
                <Td right>{formatMoney(s.total, "")}</Td>
                <Td right>{formatMoney(s.unpaid, "")}</Td>
              </tr>
            ))}
          </Table>
          <div className="mt-2"><BtnLink href={`/api/izvjestaji/csv${csvQ}&type=suppliers`} variant="secondary">Izvoz CSV</BtnLink></div>
        </Card>

        <Card title={`Fond održavanja (uplaćeno ${formatMoney(fund.income)}, utrošeno ${formatMoney(fund.spent)})`}>
          <p className="text-2xl font-semibold tabular-nums">{formatMoney(fund.balance)}</p>
          <p className="mt-1 text-xs text-slate-500">Prati se preko oznake „fond održavanja” na stavkama naknada i transakcijama.</p>
        </Card>

        <Card title="Neplaćene fakture dobavljača">
          <Table headers={["Dobavljač", "Br. fakture", "Rok", "Otvoreno"]} empty={supplierUnpaid.length === 0}>
            {supplierUnpaid.map((e) => (
              <tr key={e.id}>
                <Td>{e.supplier?.name ?? "—"}</Td>
                <Td>{e.invoiceNumber ?? "—"}</Td>
                <Td>{formatDate(e.dueDate)}</Td>
                <Td right>{formatMoney((Number(e.amount) - Number(e.paidAmount)).toFixed(2), "")}</Td>
              </tr>
            ))}
          </Table>
        </Card>

        <Card title="Pregled po zgradama">
          <Table headers={["Zgrada", "Prilivi", "Odlivi", "Neto"]} empty={byBuilding.length === 0}>
            {byBuilding.map((r) => (
              <tr key={r.key}>
                <Td>{r.name}</Td>
                <Td right>{formatMoney(r.income, "")}</Td>
                <Td right>{formatMoney(r.expense, "")}</Td>
                <Td right>{formatMoney(r.net, "")}</Td>
              </tr>
            ))}
          </Table>
        </Card>

        <Card title="Pregled po projektima">
          <Table headers={["Projekat", "Prilivi", "Odlivi", "Neto"]} empty={byProject.length === 0}>
            {byProject.map((r) => (
              <tr key={r.key}>
                <Td>{r.name}</Td>
                <Td right>{formatMoney(r.income, "")}</Td>
                <Td right>{formatMoney(r.expense, "")}</Td>
                <Td right>{formatMoney(r.net, "")}</Td>
              </tr>
            ))}
          </Table>
        </Card>
      </div>
    </div>
  );
}
