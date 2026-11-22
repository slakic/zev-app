import { requireActor } from "@/server/actor";
import { annualOverview, type AnnualAccount } from "@/server/services/ledgerReconciliation";
import { t } from "@/lib/i18n";
import { Card, Field, FilterBar, Flash, inputCls, RowLink, Table, Td, type ColumnSpec } from "@/components/ui";
import { km, qs, ReportHeader } from "../shared";

const headers: ColumnSpec[] = [
  { label: t("ledger.reports.annual.col.account"), priority: "primary" },
  { label: t("ledger.reports.annual.col.group"), priority: "detail" },
  { label: t("ledger.reports.annual.col.amount"), align: "right" },
];
const purposeHeaders: ColumnSpec[] = [
  { label: t("ledger.reports.col.purpose"), priority: "primary" },
  { label: t("ledger.reports.col.income"), align: "right" },
  { label: t("ledger.reports.col.expense"), align: "right" },
  { label: t("ledger.reports.col.charged"), align: "right" },
  { label: t("ledger.reports.col.collected"), align: "right" },
  { label: t("ledger.reports.col.receivableClosing"), align: "right" },
];

function Accounts({ id, title, rows, total, totalLabel, empty, range }: {
  id: string; title: string; rows: AnnualAccount[]; total: string; totalLabel: string; empty: string; range: { from: string; to: string };
}) {
  return (
    <Card title={title}>
      <Table id={id} caption={title} headers={headers} empty={rows.length === 0} emptyTitle={empty}>
        {rows.map((r) => (
          <tr key={r.accountId}>
            <Td>
              <RowLink href={`/knjigovodstvo/izvjestaji/kartica${qs({ konto: r.accountId, from: range.from, to: range.to })}`}><span className="tabular-nums">{r.code}</span></RowLink> {r.name}
            </Td>
            <Td>{r.group}</Td>
            <Td><span className="whitespace-nowrap tabular-nums">{km(r.amount)}</span></Td>
          </tr>
        ))}
        {rows.length > 0 && (
          <tr>
            <Td><span className="font-semibold">{totalLabel}</span></Td>
            <Td>{""}</Td>
            <Td><span className="whitespace-nowrap font-semibold tabular-nums">{km(total)}</span></Td>
          </tr>
        )}
      </Table>
    </Card>
  );
}

/** Godišnji pregled iz knjige (B3b §4.5, B3-Q7 (a)): prihodi, rashodi, rezultat i namjene za poslovnu godinu. */
export default async function AnnualOverviewPage({ searchParams }: { searchParams: Promise<{ godina?: string }> }) {
  const actor = await requireActor("PRESIDENT", "ACCOUNTANT");
  const sp = await searchParams;
  const y = await annualOverview(actor, sp.godina);
  const csv = y.year ? `/api/knjigovodstvo/izvjestaji/csv${qs({ type: "godisnji", godina: y.year.label })}` : undefined;

  return (
    <div>
      <ReportHeader title={t("ledger.reports.list.annual.title")} range={y.year ?? undefined} csvHref={csv} />
      {!y.year ? (
        <Flash warn={t("ledger.reports.annual.noYear")} />
      ) : (
        <>
          <FilterBar>
            <Field label={t("ledger.reports.annual.year")}>
              <select name="godina" defaultValue={y.year.label} className={inputCls}>
                {y.years.map((l) => <option key={l} value={l}>{l}</option>)}
              </select>
            </Field>
          </FilterBar>
          <p className="mb-4 max-w-[68ch] text-sm text-slate-600">{t("ledger.reports.annual.note")}</p>
          <div className="space-y-6">
            <Accounts id="annual-income" title={t("ledger.reports.annual.incomeTitle")} rows={y.income} total={y.incomeTotal} totalLabel={t("ledger.reports.annual.incomeTotal")} empty={t("ledger.reports.annual.emptyIncome")} range={y.year} />
            <Accounts id="annual-expense" title={t("ledger.reports.annual.expenseTitle")} rows={y.expense} total={y.expenseTotal} totalLabel={t("ledger.reports.annual.expenseTotal")} empty={t("ledger.reports.annual.emptyExpense")} range={y.year} />
            <Card>
              <p className="flex flex-wrap items-baseline justify-between gap-3 text-sm">
                <span className="font-semibold text-slate-700">{t("ledger.reports.annual.result")}</span>
                <span className="whitespace-nowrap text-lead font-semibold tabular-nums text-slate-900">{km(y.result)}</span>
              </p>
            </Card>
            <Card title={t("ledger.reports.annual.purposesTitle")} hint={t("ledger.reports.purposesHint")}>
              <Table id="annual-purposes" caption={t("ledger.reports.annual.purposesTitle")} headers={purposeHeaders} empty={y.purposes.length === 0} emptyTitle={t("ledger.reports.empty")}>
                {y.purposes.map((p) => (
                  <tr key={p.purposeId}>
                    <Td>
                      <RowLink href={`/knjigovodstvo/izvjestaji/bruto-bilans${qs({ from: y.year.from, to: y.year.to, namjena: p.purposeId })}`}>
                        {p.purposeId === "none" ? t("ledger.reports.noPurpose") : `${p.code} ${p.name}`}
                      </RowLink>
                      {p.isCommonReserve && <span className="block text-hint text-slate-500">{t("ledger.reports.reserve")}</span>}
                    </Td>
                    <Td><span className="whitespace-nowrap tabular-nums">{km(p.income)}</span></Td>
                    <Td><span className="whitespace-nowrap tabular-nums">{km(p.expense)}</span></Td>
                    <Td><span className="whitespace-nowrap tabular-nums">{km(p.charged)}</span></Td>
                    <Td><span className="whitespace-nowrap tabular-nums">{km(p.collected)}</span></Td>
                    <Td><span className="whitespace-nowrap tabular-nums">{km(p.receivableClosing)}</span></Td>
                  </tr>
                ))}
              </Table>
            </Card>
          </div>
        </>
      )}
    </div>
  );
}
