import { requireActor } from "@/server/actor";
import { cashFlowReport, incomeExpenseReport, receivablesReport, supplierReport, unpaidSupplierInvoices, allocationSummary, ownerDebtReport } from "@/server/services/reports";
import { reserveFundBalance } from "@/server/services/finance";
import { listParties, partyDisplayName } from "@/server/services/ownership";
import { formatMoney } from "@/lib/money";
import { formatDate, endOfDay } from "@/lib/i18n";
import { PageHeader, Card, Table, Td, BtnLink } from "@/components/ui";
import { OwnerMultiSelect } from "@/components/owner-multiselect";

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

/**
 * Label a signed balance ("prethodni saldo" or the final "saldo") in plain
 * words, since the sign alone (+/-) reads as ambiguous to an accountant
 * scanning a table: positive = the owner owes the ZEV (duguje), negative =
 * the owner has overpaid / has credit (preplata), zero = settled (izmireno).
 */
function balanceStatus(balance: string): { text: string; cls: string } {
  const n = Number(balance);
  if (n > 0) return { text: "duguje", cls: "text-red-700" };
  if (n < 0) return { text: "preplata", cls: "text-emerald-700" };
  return { text: "izmireno", cls: "text-slate-400" };
}

export default async function ReportsPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; to?: string; asOf?: string; owner?: string | string[] }>;
}) {
  const actor = await requireActor("PRESIDENT", "ACCOUNTANT");
  const sp = await searchParams;
  const range = {
    from: sp.from ? new Date(sp.from) : undefined,
    to: sp.to ? new Date(sp.to) : undefined,
  };
  const asOfStr = sp.asOf || todayIso();
  const ownerIds = sp.owner ? (Array.isArray(sp.owner) ? sp.owner : [sp.owner]) : [];
  const [cashFlow, incExp, receivables, suppliers, supplierUnpaid, fund, byBuilding, byProject, parties, debt] = await Promise.all([
    cashFlowReport(actor, range),
    incomeExpenseReport(actor, range),
    receivablesReport(actor, range.to ?? new Date()),
    supplierReport(actor, range),
    unpaidSupplierInvoices(actor),
    reserveFundBalance(actor),
    allocationSummary(actor, "building", range),
    allocationSummary(actor, "project", range),
    listParties(actor),
    ownerDebtReport(actor, { asOf: endOfDay(asOfStr), partyIds: ownerIds.length > 0 ? ownerIds : undefined }),
  ]);
  const owners = parties
    .filter((p) => p.ownershipStakes.length > 0)
    .map((p) => ({
      id: p.id,
      label: `${partyDisplayName(p)} — ${p.ownershipStakes.map((s) => s.unit.label).join(", ")}`,
    }));
  const csvQ = `?from=${sp.from ?? ""}&to=${sp.to ?? ""}`;
  const debtQ = `?asOf=${asOfStr}${ownerIds.map((id) => `&owner=${encodeURIComponent(id)}`).join("")}`;
  return (
    <div>
      <PageHeader
        title="Izvještaji"
        subtitle="Operativni finansijski pregledi — izvoz u CSV za eksternog računovođu ili u PDF za štampu/arhivu"
        actions={<BtnLink href={`/api/izvjestaji/pdf${csvQ}`} variant="primary">Izvoz svih izvještaja (PDF)</BtnLink>}
      />
      <form className="mb-4 flex flex-wrap items-end gap-3 rounded-lg border border-slate-200 bg-white p-3">
        <label className="text-sm">Od <input type="date" name="from" defaultValue={sp.from} className="ml-1 rounded border border-slate-300 px-2 py-1" /></label>
        <label className="text-sm">Do <input type="date" name="to" defaultValue={sp.to} className="ml-1 rounded border border-slate-300 px-2 py-1" /></label>
        <button className="rounded-md bg-blue-600 px-3 py-1.5 text-sm font-medium text-white">Primijeni period</button>
      </form>

      <Card
        title={`Dugovanja po vlasnicima — stanje na dan ${formatDate(new Date(asOfStr))} (ukupno: ${formatMoney(debt.totalBalance)})`}
      >
        <form className="mb-3 flex flex-wrap items-end gap-3">
          <label className="text-sm">
            Stanje na dan{" "}
            <input type="date" name="asOf" defaultValue={asOfStr} className="ml-1 rounded border border-slate-300 px-2 py-1" />
          </label>
          <OwnerMultiSelect
            name="owner"
            label="Vlasnici"
            options={owners}
            defaultSelected={ownerIds}
            helperText="Prazan izbor (ili dugme „Obriši izbor”) = svi vlasnici."
          />
          <button className="rounded-md bg-blue-600 px-3 py-1.5 text-sm font-medium text-white">Prikaži</button>
        </form>
        <p className="mb-2 text-xs text-slate-500">
          <strong>Prethodni saldo</strong> = ukupno stanje vlasnika prije izabranog dana. <strong>Zaduženo / Plaćeno /
          Korekcije</strong> = promjene knjižene na taj dan (ako ih nema, saldo ostaje jednak prethodnom).{" "}
          <strong>Pozitivan iznos</strong> znači da vlasnik duguje ZEV-u, <strong>negativan</strong> da ima preplatu
          (kredit/avans), a <strong>0,00</strong> da je stanje izmireno — isto važi i za prethodni saldo i za konačni
          saldo.
        </p>
        <Table
          headers={["Vlasnik", "Jedinica(e)", "Prethodni saldo", "Zaduženo (taj dan)", "Plaćeno (taj dan)", "Korekcije (taj dan)", "Saldo"]}
          empty={debt.rows.length === 0}
        >
          {debt.rows.map((r) => {
            const prevStatus = balanceStatus(r.previousBalance);
            const status = balanceStatus(r.balance);
            return (
              <tr key={r.partyId}>
                <Td>{r.name}</Td>
                <Td>{r.units}</Td>
                <Td right>
                  {formatMoney(r.previousBalance, "")}
                  <span className={`ml-1.5 text-xs ${prevStatus.cls}`}>({prevStatus.text})</span>
                </Td>
                <Td right>{formatMoney(r.chargedToday, "")}</Td>
                <Td right>{formatMoney(r.paidToday, "")}</Td>
                <Td right>{formatMoney(r.correctionsToday, "")}</Td>
                <Td right className="font-semibold">
                  {formatMoney(r.balance, "")}
                  <span className={`ml-1.5 text-xs font-normal ${status.cls}`}>({status.text})</span>
                </Td>
              </tr>
            );
          })}
        </Table>
        <div className="mt-2">
          <BtnLink href={`/api/izvjestaji/dugovanja${debtQ}`} variant="secondary">
            Izvoz PDF
          </BtnLink>
        </div>
      </Card>

      <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-2">
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
