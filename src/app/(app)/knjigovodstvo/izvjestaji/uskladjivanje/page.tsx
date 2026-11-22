import { requireActor } from "@/server/actor";
import { asOfDay, reconcileAt, type ReconRow } from "@/server/services/ledgerReconciliation";
import { formatDate, t, tf } from "@/lib/i18n";
import { Card, Flash, RowLink, StatusBadge, Table, Td, type ColumnSpec } from "@/components/ui";
import { AsOfFilter, km, qs, ReportHeader } from "../shared";

const headers: ColumnSpec[] = [
  { label: t("ledger.reports.recon.col.control"), priority: "primary" },
  { label: t("ledger.reports.recon.col.ledger"), align: "right" },
  { label: t("ledger.reports.recon.col.operational"), align: "right" },
  { label: t("ledger.reports.recon.col.difference"), align: "right" },
  { label: t("ledger.reports.recon.col.waiting"), align: "right" },
  { label: t("ledger.reports.recon.col.unexplained"), align: "right" },
  { label: t("ledger.reports.recon.col.status") },
];

const statusOf = (r: ReconRow) => (!r.ok ? "RECON_DIFF" : r.difference !== "0.00" ? "RECON_WAITING" : "RECON_OK");
const STATUS_LABEL = { RECON_OK: "ok", RECON_WAITING: "waiting", RECON_DIFF: "diff" } as const;

/** Usklađivanje knjige i evidencije na dan (B3b §4.1, B3-Q5): razlika raščlanjena na „čeka knjiženje” i neobjašnjeno. */
export default async function ReconciliationPage({ searchParams }: { searchParams: Promise<{ dan?: string }> }) {
  const actor = await requireActor("PRESIDENT", "ACCOUNTANT");
  const sp = await searchParams;
  const asOf = asOfDay(sp.dan);
  const r = await reconcileAt(actor, asOf);
  const csv = r.active ? `/api/knjigovodstvo/izvjestaji/csv${qs({ type: "uskladjivanje", dan: asOf })}` : undefined;

  return (
    <div>
      <ReportHeader title={t("ledger.reports.list.recon.title")} asOf={asOf} csvHref={csv} />
      {!r.active && <Flash warn={r.start ? tf("ledger.reports.recon.beforeStart", { datum: formatDate(r.start) }) : t("ledger.reports.recon.notActive")} />}
      {r.active && (r.ok ? <Flash msg={t("ledger.reports.recon.ok")} /> : <Flash err={t("ledger.reports.recon.diff")} />)}
      <AsOfFilter asOf={asOf} />
      {r.active && (
        <Card hint={t("ledger.reports.recon.hint")}>
          <Table id="reconciliation" caption={t("ledger.reports.list.recon.title")} headers={headers} empty={r.rows.length === 0} emptyTitle={t("ledger.reports.empty")}>
            {r.rows.map((x) => (
              <tr key={x.key}>
                <Td>
                  <span className="first-letter:uppercase block">{x.moneyAccount ? `${x.roleLabel}: ${x.moneyAccount}` : x.roleLabel}</span>
                  <span className="block text-hint text-slate-500">{tf("ledger.reports.recon.accounts", { konta: x.accounts.join(", ") })}</span>
                </Td>
                <Td>
                  <span className="whitespace-nowrap tabular-nums">{km(x.ledger)}</span>
                  {x.analytics !== x.ledger && (
                    <span className="block whitespace-nowrap text-hint font-semibold text-red-700">{tf("ledger.reports.recon.analyticsDiff", { iznos: km(x.analytics) })}</span>
                  )}
                </Td>
                <Td><span className="whitespace-nowrap tabular-nums">{km(x.operational)}</span></Td>
                <Td><span className="whitespace-nowrap tabular-nums">{km(x.difference)}</span></Td>
                <Td>
                  <span className="whitespace-nowrap tabular-nums">{km(x.waiting)}</span>
                  {x.waitingCount > 0 && (
                    <span className="block text-hint">
                      <RowLink href="/knjigovodstvo?tab=dogadjaji">{tf("ledger.reports.recon.events", { broj: x.waitingCount })}</RowLink>
                    </span>
                  )}
                </Td>
                <Td><span className={`whitespace-nowrap tabular-nums ${x.unexplained !== "0.00" ? "font-semibold text-red-700" : ""}`}>{km(x.unexplained)}</span></Td>
                <Td><StatusBadge status={statusOf(x)} label={t(`ledger.reports.recon.status.${STATUS_LABEL[statusOf(x)]}`)} /></Td>
              </tr>
            ))}
          </Table>
        </Card>
      )}
    </div>
  );
}
