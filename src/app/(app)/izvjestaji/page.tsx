import Link from "next/link";
import { requireActor } from "@/server/actor";
import { cashFlowReport, incomeExpenseReport, receivablesReport, supplierReport, unpaidSupplierInvoices, allocationSummary, ownerDebtReport } from "@/server/services/reports";
import { reserveFundBalance } from "@/server/services/finance";
import { listParties, partyDisplayName } from "@/server/services/ownership";
import { formatMoney } from "@/lib/money";
import { formatDate, endOfDay, t } from "@/lib/i18n";
import { PageHeader, Card, Table, Td, BtnLink, SubmitBtn, inputCls, Tabs, FilterBar, type ColumnSpec } from "@/components/ui";
import { OwnerMultiSelect } from "@/components/owner-multiselect";

const incExpHeaders: ColumnSpec[] = [
  { label: "Kategorija" },
  { label: "Vrsta" },
  { label: "Iznos", align: "right" },
];

const supplierSummaryHeaders: ColumnSpec[] = [
  { label: "Dobavljač" },
  { label: "Faktura", align: "right" },
  { label: "Ukupno", align: "right" },
  { label: "Neplaćeno", align: "right" },
];

const supplierUnpaidHeaders: ColumnSpec[] = [
  { label: "Dobavljač" },
  { label: "Br. fakture" },
  { label: "Rok" },
  { label: "Otvoreno", align: "right" },
];

const byBuildingHeaders: ColumnSpec[] = [
  { label: "Zgrada" },
  { label: "Prilivi", align: "right" },
  { label: "Odlivi", align: "right" },
  { label: "Neto", align: "right" },
];

const byProjectHeaders: ColumnSpec[] = [
  { label: "Projekat" },
  { label: "Prilivi", align: "right" },
  { label: "Odlivi", align: "right" },
  { label: "Neto", align: "right" },
];

const cashFlowHeaders: ColumnSpec[] = [
  { label: "Račun", priority: "primary" },
  { label: "Početno", align: "right", priority: "detail" },
  { label: "Prilivi", align: "right" },
  { label: "Odlivi", align: "right" },
  { label: "Neto", align: "right", priority: "detail" },
  { label: "Trenutno stanje", align: "right" },
];

const receivablesHeaders: ColumnSpec[] = [
  { label: "Faktura", priority: "primary" },
  { label: "Dužnik" },
  { label: "Jedinica", priority: "detail" },
  { label: "Dospijeće" },
  { label: "Otvoreno", align: "right" },
  { label: "Starost", priority: "detail" },
];

const debtHeaders: ColumnSpec[] = [
  { label: "Vlasnik", priority: "primary" },
  { label: "Jedinica(e)", priority: "detail" },
  { label: "Prethodni saldo", align: "right", priority: "detail" },
  { label: "Zaduženo (taj dan)", align: "right" },
  { label: "Plaćeno (taj dan)", align: "right" },
  { label: "Korekcije (taj dan)", align: "right", priority: "detail" },
  { label: "Saldo", align: "right" },
];

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
  return { text: "izmireno", cls: "text-slate-500" };
}

/** Empty-state hint shared by every report table (H10, filter class) — the period/owner
 *  filters are page-level, so clearing them means dropping back to the tab's bare URL. */
function FilteredEmptyHint({ clearHref }: { clearHref: string }) {
  return (
    <>
      {t("empty.filteredPeriod.hint")}{" "}
      <Link href={clearHref} className="font-medium text-primary-ink underline-offset-2 hover:underline">
        Obriši filtere
      </Link>
    </>
  );
}

export default async function ReportsPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string; from?: string; to?: string; asOf?: string; owner?: string | string[] }>;
}) {
  const actor = await requireActor("PRESIDENT", "ACCOUNTANT");
  const sp = await searchParams;
  const activeTab = ["novac", "fakture", "pregledi"].includes(sp.tab ?? "") ? (sp.tab as string) : "dugovanja";
  const range = {
    from: sp.from ? new Date(sp.from) : undefined,
    to: sp.to ? new Date(sp.to) : undefined,
  };
  const asOfStr = sp.asOf || todayIso();
  const ownerIds = sp.owner ? (Array.isArray(sp.owner) ? sp.owner : [sp.owner]) : [];

  const [cashFlow, incExp, fund] =
    activeTab === "novac"
      ? await Promise.all([cashFlowReport(actor, range), incomeExpenseReport(actor, range), reserveFundBalance(actor)])
      : [[], [], null];
  const [receivables, suppliers, supplierUnpaid] =
    activeTab === "fakture"
      ? await Promise.all([receivablesReport(actor, range.to ?? new Date()), supplierReport(actor, range), unpaidSupplierInvoices(actor)])
      : [null, [], []];
  const [byBuilding, byProject] =
    activeTab === "pregledi"
      ? await Promise.all([allocationSummary(actor, "building", range), allocationSummary(actor, "project", range)])
      : [[], []];
  const [parties, debt] =
    activeTab === "dugovanja"
      ? await Promise.all([
          listParties(actor),
          ownerDebtReport(actor, { asOf: endOfDay(asOfStr), partyIds: ownerIds.length > 0 ? ownerIds : undefined }),
        ])
      : [[], null];
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
        title={t("nav.reports")}
        subtitle="Operativni finansijski pregledi — izvoz u CSV za eksternog računovođu ili u PDF za štampu/arhivu"
        actions={<BtnLink href={`/api/izvjestaji/pdf${csvQ}`} variant="primary">Izvoz svih izvještaja (PDF)</BtnLink>}
      />
      <FilterBar submitLabel="Primijeni period">
        <input type="hidden" name="tab" value={activeTab} />
        <label className="text-sm">Od <input type="date" name="from" defaultValue={sp.from} className={`${inputCls} ml-1 w-36`} /></label>
        <label className="text-sm">Do <input type="date" name="to" defaultValue={sp.to} className={`${inputCls} ml-1 w-36`} /></label>
      </FilterBar>

      <Tabs
        tabs={[
          { key: "dugovanja", label: "Dugovanja" },
          { key: "novac", label: "Novac" },
          { key: "fakture", label: "Fakture" },
          { key: "pregledi", label: "Pregledi" },
        ]}
        active={activeTab}
        hrefFor={(key) => `/izvjestaji?tab=${key}`}
      />

      {activeTab === "dugovanja" && debt && (
      <Card
        title={`Dugovanja po vlasnicima — stanje na dan ${formatDate(new Date(asOfStr))} (ukupno: ${formatMoney(debt.totalBalance)})`}
      >
        <form className="mb-3 flex flex-wrap items-end gap-3">
          <input type="hidden" name="tab" value="dugovanja" />
          <label className="text-sm">
            Stanje na dan{" "}
            <input type="date" name="asOf" defaultValue={asOfStr} className={`${inputCls} ml-1 w-36`} />
          </label>
          <OwnerMultiSelect
            name="owner"
            label="Vlasnici"
            options={owners}
            defaultSelected={ownerIds}
            helperText="Prazan izbor (ili dugme „Obriši izbor”) = svi vlasnici."
          />
          <SubmitBtn variant="tonal">Prikaži</SubmitBtn>
        </form>
        <p className="mb-2 text-xs text-slate-500">
          <strong>Prethodni saldo</strong> = ukupno stanje vlasnika prije izabranog dana. <strong>Zaduženo / Plaćeno /
          Korekcije</strong> = promjene knjižene na taj dan (ako ih nema, saldo ostaje jednak prethodnom).{" "}
          <strong>Pozitivan iznos</strong> znači da vlasnik duguje ZEV-u, <strong>negativan</strong> da ima preplatu
          (kredit/avans), a <strong>0,00</strong> da je stanje izmireno — isto važi i za prethodni saldo i za konačni
          saldo.
        </p>
        <Table
          id="owner-debt-table"
          caption="Dugovanja po vlasnicima"
          headers={debtHeaders}
          empty={debt.rows.length === 0}
          emptyTitle={t("empty.filteredPeriod.title")}
          emptyHint={<FilteredEmptyHint clearHref="/izvjestaji?tab=dugovanja" />}
        >
          {debt.rows.map((r) => {
            const prevStatus = balanceStatus(r.previousBalance);
            const status = balanceStatus(r.balance);
            return (
              <tr key={r.partyId}>
                <Td>{r.name}</Td>
                <Td>{r.units}</Td>
                <Td>
                  {formatMoney(r.previousBalance, "")}
                  <span className={`ml-1.5 text-xs ${prevStatus.cls}`}>({prevStatus.text})</span>
                </Td>
                <Td>{formatMoney(r.chargedToday, "")}</Td>
                <Td>{formatMoney(r.paidToday, "")}</Td>
                <Td>{formatMoney(r.correctionsToday, "")}</Td>
                <Td className="font-semibold">
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
      )}

      {activeTab === "novac" && fund && (
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card title="Stanje računa i tok novca" className="lg:col-span-2">
          <Table
            id="cashflow-table"
            caption="Stanje računa i tok novca"
            headers={cashFlowHeaders}
            empty={cashFlow.length === 0}
            emptyTitle={t("empty.filteredPeriod.title")}
            emptyHint={<FilteredEmptyHint clearHref="/izvjestaji?tab=novac" />}
          >
            {cashFlow.map((r) => (
              <tr key={r.accountId}>
                <Td>{r.accountName}</Td>
                <Td>{formatMoney(r.opening, "")}</Td>
                <Td>{formatMoney(r.income, "")}</Td>
                <Td>{formatMoney(r.expense, "")}</Td>
                <Td>{formatMoney(r.net, "")}</Td>
                <Td className="font-semibold">{formatMoney(r.currentBalance, "")}</Td>
              </tr>
            ))}
          </Table>
          <div className="mt-2"><BtnLink href={`/api/izvjestaji/csv${csvQ}&type=cashflow`} variant="secondary">Izvoz CSV</BtnLink></div>
        </Card>

        <Card title="Prihodi i rashodi po kategorijama">
          <Table
            id="incexp-table"
            caption="Prihodi i rashodi po kategorijama"
            headers={incExpHeaders}
            empty={incExp.length === 0}
            emptyTitle={t("empty.filteredPeriod.title")}
            emptyHint={<FilteredEmptyHint clearHref="/izvjestaji?tab=novac" />}
          >
            {incExp.map((r, i) => (
              <tr key={i}>
                <Td>{r.category}</Td>
                <Td>{r.kind === "INCOME" ? "Prihod" : "Rashod"}</Td>
                <Td>{formatMoney(r.total, "")}</Td>
              </tr>
            ))}
          </Table>
          <div className="mt-2"><BtnLink href={`/api/izvjestaji/csv${csvQ}&type=incexp`} variant="secondary">Izvoz CSV</BtnLink></div>
        </Card>

        <Card title={`Fond održavanja (uplaćeno ${formatMoney(fund.income)}, utrošeno ${formatMoney(fund.spent)})`}>
          <p className="text-2xl font-semibold tabular-nums">{formatMoney(fund.balance)}</p>
          <p className="mt-1 text-xs text-slate-500">Prati se preko oznake „fond održavanja” na stavkama naknada i transakcijama.</p>
        </Card>
      </div>
      )}

      {activeTab === "fakture" && receivables && (
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card title={`Neplaćene fakture vlasnika (otvoreno: ${formatMoney(receivables.totalOpen)} · dospjelo: ${formatMoney(receivables.totalOverdue)})`} className="lg:col-span-2">
          <Table
            id="receivables-table"
            caption="Neplaćene fakture vlasnika"
            headers={receivablesHeaders}
            empty={receivables.rows.length === 0}
            emptyTitle={t("empty.filteredPeriod.title")}
            emptyHint={<FilteredEmptyHint clearHref="/izvjestaji?tab=fakture" />}
          >
            {receivables.rows.map((r) => (
              <tr key={r.invoiceId}>
                <Td>{r.number}</Td>
                <Td>{r.debtor}</Td>
                <Td>{r.unit}</Td>
                <Td>{formatDate(r.dueDate)}</Td>
                <Td>{formatMoney(r.open, "")}</Td>
                <Td>{r.bucket}</Td>
              </tr>
            ))}
          </Table>
          <div className="mt-2"><BtnLink href={`/api/izvjestaji/csv${csvQ}&type=receivables`} variant="secondary">Izvoz CSV (starosna struktura)</BtnLink></div>
        </Card>

        <Card title="Dobavljači">
          <Table
            id="supplier-summary-table"
            caption="Dobavljači"
            headers={supplierSummaryHeaders}
            empty={suppliers.length === 0}
            emptyTitle={t("empty.filteredPeriod.title")}
            emptyHint={<FilteredEmptyHint clearHref="/izvjestaji?tab=fakture" />}
          >
            {suppliers.map((s, i) => (
              <tr key={i}>
                <Td>{s.supplier}</Td>
                <Td>{s.count}</Td>
                <Td>{formatMoney(s.total, "")}</Td>
                <Td>{formatMoney(s.unpaid, "")}</Td>
              </tr>
            ))}
          </Table>
          <div className="mt-2"><BtnLink href={`/api/izvjestaji/csv${csvQ}&type=suppliers`} variant="secondary">Izvoz CSV</BtnLink></div>
        </Card>

        <Card title="Neplaćene fakture dobavljača">
          <Table
            id="supplier-unpaid-table"
            caption="Neplaćene fakture dobavljača"
            headers={supplierUnpaidHeaders}
            empty={supplierUnpaid.length === 0}
            emptyTitle={t("empty.supplierUnpaid.title")}
          >
            {supplierUnpaid.map((e) => (
              <tr key={e.id}>
                <Td>{e.supplier?.name ?? "—"}</Td>
                <Td>{e.invoiceNumber ?? "—"}</Td>
                <Td>{formatDate(e.dueDate)}</Td>
                <Td>{formatMoney((Number(e.amount) - Number(e.paidAmount)).toFixed(2), "")}</Td>
              </tr>
            ))}
          </Table>
        </Card>
      </div>
      )}

      {activeTab === "pregledi" && (
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card title="Pregled po zgradama">
          <Table
            id="by-building-table"
            caption="Pregled po zgradama"
            headers={byBuildingHeaders}
            empty={byBuilding.length === 0}
            emptyTitle={t("empty.filteredPeriod.title")}
            emptyHint={<FilteredEmptyHint clearHref="/izvjestaji?tab=pregledi" />}
          >
            {byBuilding.map((r) => (
              <tr key={r.key}>
                <Td>{r.name}</Td>
                <Td>{formatMoney(r.income, "")}</Td>
                <Td>{formatMoney(r.expense, "")}</Td>
                <Td>{formatMoney(r.net, "")}</Td>
              </tr>
            ))}
          </Table>
        </Card>

        <Card title="Pregled po projektima">
          <Table
            id="by-project-table"
            caption="Pregled po projektima"
            headers={byProjectHeaders}
            empty={byProject.length === 0}
            emptyTitle={t("empty.filteredPeriod.title")}
            emptyHint={<FilteredEmptyHint clearHref="/izvjestaji?tab=pregledi" />}
          >
            {byProject.map((r) => (
              <tr key={r.key}>
                <Td>{r.name}</Td>
                <Td>{formatMoney(r.income, "")}</Td>
                <Td>{formatMoney(r.expense, "")}</Td>
                <Td>{formatMoney(r.net, "")}</Td>
              </tr>
            ))}
          </Table>
        </Card>
      </div>
      )}
    </div>
  );
}
