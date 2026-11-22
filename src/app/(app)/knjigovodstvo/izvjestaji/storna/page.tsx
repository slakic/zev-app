import { requireActor } from "@/server/actor";
import { reportRange, reversalReview } from "@/server/services/ledgerReports";
import { formatDate, t, tEnum } from "@/lib/i18n";
import { Card, RowLink, Table, Td, type ColumnSpec } from "@/components/ui";
import { km, qs, RangeFilter, ReportHeader } from "../shared";

const PATH = "/knjigovodstvo/izvjestaji/storna";

const headers: ColumnSpec[] = [
  { label: t("ledger.reports.col.reversal"), priority: "primary", nowrap: true },
  { label: t("ledger.reports.col.date"), nowrap: true },
  { label: t("ledger.reports.col.original"), nowrap: true },
  { label: t("ledger.reports.col.reason"), priority: "secondary" },
  { label: t("ledger.reports.col.amount"), align: "right" },
  { label: t("ledger.reports.col.source") },
  { label: t("ledger.reports.col.postedBy"), priority: "detail" },
];

/** Pregled storna (B3a §3.5, R-14): ručni storno i automatski storno dokumenata, sa originalom i dokumentom. */
export default async function ReversalReviewPage({ searchParams }: { searchParams: Promise<{ from?: string; to?: string }> }) {
  const actor = await requireActor("PRESIDENT", "ACCOUNTANT");
  const sp = await searchParams;
  const range = await reportRange(actor, sp.from, sp.to);
  const rows = await reversalReview(actor, range);
  const csv = `/api/knjigovodstvo/izvjestaji/csv${qs({ type: "storna", from: range.from, to: range.to })}`;

  return (
    <div>
      <ReportHeader title={t("ledger.reports.list.reversals.title")} range={range} csvHref={csv} />
      <RangeFilter range={range} path={PATH} />
      <Card hint={t("ledger.reports.reversalsHint")}>
        <Table
          id="reversal-review" caption={t("ledger.reports.list.reversals.title")} headers={headers} empty={rows.length === 0}
          emptyTitle={t("ledger.reports.empty")} emptyHint={t("ledger.reports.emptyHint")}
        >
          {rows.map((r) => (
            <tr key={r.id}>
              <Td>
                <RowLink href={`/knjigovodstvo/nalozi/${r.id}`}>{r.number ?? "—"}</RowLink>
                <span className="block text-hint text-slate-500">{tEnum("journalKind", r.kind)}</span>
              </Td>
              <Td>{formatDate(r.postingDate)}</Td>
              <Td><RowLink href={`/knjigovodstvo/nalozi/${r.original.id}`}>{r.original.number ?? "—"}</RowLink></Td>
              <Td>{r.reason}</Td>
              <Td><span className="whitespace-nowrap tabular-nums">{km(r.amount)}</span></Td>
              <Td>{r.source ? <RowLink href={r.source.href}>{t(`ledger.journal.source.${r.source.type}`)}</RowLink> : "—"}</Td>
              <Td>{r.postedBy || "—"}</Td>
            </tr>
          ))}
        </Table>
      </Card>
    </div>
  );
}
