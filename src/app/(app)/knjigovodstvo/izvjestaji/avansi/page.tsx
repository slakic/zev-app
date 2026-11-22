import { requireActor } from "@/server/actor";
import { advancesAt, asOfDay } from "@/server/services/ledgerReconciliation";
import { formatDate, t } from "@/lib/i18n";
import { Card, RowLink, StatusBadge, Table, Td, type ColumnSpec } from "@/components/ui";
import { amt, AsOfFilter, km, qs, ReportHeader } from "../shared";

const advHeaders: ColumnSpec[] = [
  { label: t("ledger.reports.adv.col.owner"), priority: "primary" },
  { label: t("ledger.reports.adv.col.ledger"), align: "right" },
  { label: t("ledger.reports.adv.col.operational"), align: "right" },
  { label: t("ledger.reports.recon.col.waiting"), align: "right" },
  { label: t("ledger.reports.adv.col.status") },
];
const unidHeaders: ColumnSpec[] = [
  { label: t("ledger.reports.adv.col.payment"), priority: "primary" },
  { label: t("ledger.reports.adv.col.payer"), priority: "secondary" },
  { label: t("ledger.reports.adv.col.ledger"), align: "right" },
  { label: t("ledger.reports.adv.col.operational"), align: "right" },
  { label: t("ledger.reports.recon.col.waiting"), align: "right" },
  { label: t("ledger.reports.adv.col.status") },
];

/** Isto stanje kao u usklađivanju: slaže se / razlika čeka knjiženje / neobjašnjena razlika. */
function Status({ row }: { row: { ok: boolean; waiting: string } }) {
  const [status, key] = !row.ok ? ["RECON_DIFF", "diff"] : row.waiting !== "0.00" ? ["RECON_WAITING", "waiting"] : ["RECON_OK", "ok"];
  return <StatusBadge status={status} label={t(`ledger.reports.recon.status.${key}`)} />;
}

/** Avansi i neidentifikovane uplate (B3b §4.2): knjiga prema evidenciji, red po red. */
export default async function AdvancesPage({ searchParams }: { searchParams: Promise<{ dan?: string }> }) {
  const actor = await requireActor("PRESIDENT", "ACCOUNTANT");
  const sp = await searchParams;
  const asOf = asOfDay(sp.dan);
  const r = await advancesAt(actor, asOf);
  const csv = `/api/knjigovodstvo/izvjestaji/csv${qs({ type: "avansi", dan: asOf })}`;

  return (
    <div>
      <ReportHeader title={t("ledger.reports.list.advances.title")} asOf={asOf} csvHref={csv} />
      <AsOfFilter asOf={asOf} />
      <div className="space-y-6">
        <Card title={t("ledger.reports.adv.advancesTitle")} hint={t("ledger.reports.adv.hint")}>
          <Table id="advances" caption={t("ledger.reports.adv.advancesTitle")} headers={advHeaders} empty={r.advances.length === 0} emptyTitle={t("ledger.reports.adv.emptyAdvances")}>
            {r.advances.map((a) => (
              <tr key={a.partyId}>
                <Td><RowLink href={`/knjigovodstvo/izvjestaji/vlasnik${qs({ id: a.partyId })}`}>{a.name}</RowLink></Td>
                <Td><span className="whitespace-nowrap tabular-nums">{km(a.ledger)}</span></Td>
                <Td><span className="whitespace-nowrap tabular-nums">{km(a.operational)}</span></Td>
                <Td><span className="whitespace-nowrap tabular-nums">{amt(a.waiting)}</span></Td>
                <Td><Status row={a} /></Td>
              </tr>
            ))}
            {r.advances.length > 0 && (
              <tr>
                <Td><span className="font-semibold">{t("ledger.reports.total")}</span></Td>
                <Td><span className="whitespace-nowrap font-semibold tabular-nums">{km(r.advancesTotal.ledger)}</span></Td>
                <Td><span className="whitespace-nowrap font-semibold tabular-nums">{km(r.advancesTotal.operational)}</span></Td>
                <Td>{""}</Td>
                <Td>{""}</Td>
              </tr>
            )}
          </Table>
        </Card>
        <Card title={t("ledger.reports.adv.unidentifiedTitle")}>
          <Table id="unidentified" caption={t("ledger.reports.adv.unidentifiedTitle")} headers={unidHeaders} empty={r.unidentified.length === 0} emptyTitle={t("ledger.reports.adv.emptyUnidentified")}>
            {r.unidentified.map((u, i) => (
              <tr key={u.paymentId ?? `x${i}`}>
                <Td>{u.paymentId ? <RowLink href={`/fakture/uplate/${u.paymentId}`}>{formatDate(u.date)}</RowLink> : t("ledger.reports.adv.noPayment")}</Td>
                <Td>{u.payer || "—"}</Td>
                <Td><span className="whitespace-nowrap tabular-nums">{km(u.ledger)}</span></Td>
                <Td><span className="whitespace-nowrap tabular-nums">{km(u.operational)}</span></Td>
                <Td><span className="whitespace-nowrap tabular-nums">{amt(u.waiting)}</span></Td>
                <Td><Status row={u} /></Td>
              </tr>
            ))}
            {r.unidentified.length > 0 && (
              <tr>
                <Td><span className="font-semibold">{t("ledger.reports.total")}</span></Td>
                <Td>{""}</Td>
                <Td><span className="whitespace-nowrap font-semibold tabular-nums">{km(r.unidentifiedTotal.ledger)}</span></Td>
                <Td><span className="whitespace-nowrap font-semibold tabular-nums">{km(r.unidentifiedTotal.operational)}</span></Td>
                <Td>{""}</Td>
                <Td>{""}</Td>
              </tr>
            )}
          </Table>
        </Card>
      </div>
    </div>
  );
}
