import { requireActor } from "@/server/actor";
import { purposeOverview, reportRange } from "@/server/services/ledgerReports";
import { t } from "@/lib/i18n";
import { Card, RowLink, Table, Td, type ColumnSpec } from "@/components/ui";
import { km, qs, RangeFilter, ReportHeader } from "../shared";

const PATH = "/knjigovodstvo/izvjestaji/namjene";

const headers: ColumnSpec[] = [
  { label: t("ledger.reports.col.purpose"), priority: "primary" },
  { label: t("ledger.reports.col.receivableOpening"), align: "right" },
  { label: t("ledger.reports.col.charged"), align: "right" },
  { label: t("ledger.reports.col.collected"), align: "right" },
  { label: t("ledger.reports.col.receivableClosing"), align: "right" },
  { label: t("ledger.reports.col.income"), align: "right" },
  { label: t("ledger.reports.col.expense"), align: "right" },
];

/** Pregled po namjeni sredstava (B3a §3.4, R-14 „stanje po namjeni (rezerva)”). */
export default async function PurposeOverviewPage({ searchParams }: { searchParams: Promise<{ from?: string; to?: string }> }) {
  const actor = await requireActor("PRESIDENT", "ACCOUNTANT");
  const sp = await searchParams;
  const range = await reportRange(actor, sp.from, sp.to);
  const rows = await purposeOverview(actor, range);
  const csv = `/api/knjigovodstvo/izvjestaji/csv${qs({ type: "namjene", from: range.from, to: range.to })}`;

  return (
    <div>
      <ReportHeader title={t("ledger.reports.list.purposes.title")} range={range} csvHref={csv} />
      <RangeFilter range={range} path={PATH} />
      <Card hint={t("ledger.reports.purposesHint")}>
        <Table
          id="purpose-overview" caption={t("ledger.reports.list.purposes.title")} headers={headers} empty={rows.length === 0}
          emptyTitle={t("ledger.reports.empty")} emptyHint={t("ledger.reports.emptyHint")}
        >
          {rows.map((r) => (
            <tr key={r.purposeId}>
              <Td>
                <RowLink href={`/knjigovodstvo/izvjestaji/bruto-bilans${qs({ from: range.from, to: range.to, namjena: r.purposeId })}`}>
                  {r.purposeId === "none" ? t("ledger.reports.noPurpose") : `${r.code} ${r.name}`}
                </RowLink>
                {r.isCommonReserve && <span className="block text-hint text-slate-500">{t("ledger.reports.reserve")}</span>}
              </Td>
              <Td><span className="whitespace-nowrap tabular-nums">{km(r.receivableOpening)}</span></Td>
              <Td><span className="whitespace-nowrap tabular-nums">{km(r.charged)}</span></Td>
              <Td><span className="whitespace-nowrap tabular-nums">{km(r.collected)}</span></Td>
              <Td><span className="whitespace-nowrap tabular-nums">{km(r.receivableClosing)}</span></Td>
              <Td><span className="whitespace-nowrap tabular-nums">{km(r.income)}</span></Td>
              <Td><span className="whitespace-nowrap tabular-nums">{km(r.expense)}</span></Td>
            </tr>
          ))}
        </Table>
      </Card>
    </div>
  );
}
