import { requireActor } from "@/server/actor";
import { projectOverview, reportRange } from "@/server/services/ledgerReports";
import { t } from "@/lib/i18n";
import { Card, RowLink, Table, Td, type ColumnSpec } from "@/components/ui";
import { km, qs, RangeFilter, ReportHeader } from "../shared";

const PATH = "/knjigovodstvo/izvjestaji/projekti";

const headers: ColumnSpec[] = [
  { label: t("ledger.reports.col.project"), priority: "primary" },
  { label: t("ledger.reports.col.income"), align: "right" },
  { label: t("ledger.reports.col.expense"), align: "right" },
  { label: t("ledger.reports.col.lines"), align: "right" },
];

/** Pregled po projektu (B3a §3.4): prihodi i rashodi stavki koje nose projekat. */
export default async function ProjectOverviewPage({ searchParams }: { searchParams: Promise<{ from?: string; to?: string }> }) {
  const actor = await requireActor("PRESIDENT", "ACCOUNTANT");
  const sp = await searchParams;
  const range = await reportRange(actor, sp.from, sp.to);
  const rows = await projectOverview(actor, range);
  const csv = `/api/knjigovodstvo/izvjestaji/csv${qs({ type: "projekti", from: range.from, to: range.to })}`;

  return (
    <div>
      <ReportHeader title={t("ledger.reports.list.projects.title")} range={range} csvHref={csv} />
      <RangeFilter range={range} path={PATH} />
      <Card hint={t("ledger.reports.projectsHint")}>
        <Table
          id="project-overview" caption={t("ledger.reports.list.projects.title")} headers={headers} empty={rows.length === 0}
          emptyTitle={t("ledger.reports.empty")} emptyHint={t("ledger.reports.emptyHint")}
        >
          {rows.map((r) => (
            <tr key={r.projectId}>
              <Td>
                <RowLink href={`/knjigovodstvo/izvjestaji/bruto-bilans${qs({ from: range.from, to: range.to, projekat: r.projectId })}`}>{r.name}</RowLink>
              </Td>
              <Td><span className="whitespace-nowrap tabular-nums">{km(r.income)}</span></Td>
              <Td><span className="whitespace-nowrap tabular-nums">{km(r.expense)}</span></Td>
              <Td><span className="whitespace-nowrap tabular-nums">{r.lines}</span></Td>
            </tr>
          ))}
        </Table>
      </Card>
    </div>
  );
}
