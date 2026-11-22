import { requireActor } from "@/server/actor";
import { filterLabels, reportRange, trialBalance } from "@/server/services/ledgerReports";
import { t, tf } from "@/lib/i18n";
import { Card, Field, Flash, inputCls, RowLink, Table, Td, type ColumnSpec } from "@/components/ui";
import { amt, km, qs, RangeFilter, ReportHeader } from "../shared";

const PATH = "/knjigovodstvo/izvjestaji/bruto-bilans";

const headers: ColumnSpec[] = [
  { label: t("ledger.reports.col.account"), priority: "primary" },
  { label: t("ledger.reports.col.openingDebit"), align: "right" },
  { label: t("ledger.reports.col.openingCredit"), align: "right" },
  { label: t("ledger.reports.col.debit"), align: "right" },
  { label: t("ledger.reports.col.credit"), align: "right" },
  { label: t("ledger.reports.col.closingDebit"), align: "right" },
  { label: t("ledger.reports.col.closingCredit"), align: "right" },
];

/** Bruto bilans (B3a §3.3): početno stanje, promet i saldo po kontu; opciono sa zbirnim kontima i filterom namjene/projekta. */
export default async function TrialBalancePage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; to?: string; prikaz?: string; namjena?: string; projekat?: string }>;
}) {
  const actor = await requireActor("PRESIDENT", "ACCOUNTANT");
  const sp = await searchParams;
  const range = await reportRange(actor, sp.from, sp.to);
  const withSummary = sp.prikaz === "zbirno";
  const dims = { purposeId: sp.namjena || null, projectId: sp.projekat || null };
  const [tb, labels] = await Promise.all([
    trialBalance(actor, { from: range.from, to: range.to, withSummary, ...dims }),
    filterLabels(actor, dims),
  ]);
  const keep = { prikaz: withSummary ? "zbirno" : null, namjena: sp.namjena, projekat: sp.projekat };
  const cardHref = (accountId: string) =>
    `/knjigovodstvo/izvjestaji/kartica${qs({ konto: accountId, from: range.from, to: range.to, namjena: sp.namjena, projekat: sp.projekat })}`;
  const csv = `/api/knjigovodstvo/izvjestaji/csv${qs({ type: "bruto-bilans", from: range.from, to: range.to, ...keep })}`;

  return (
    <div>
      <ReportHeader title={t("ledger.reports.list.trial.title")} range={range} csvHref={csv} />
      {labels.purpose !== null && (
        <Flash msg={<>{tf("ledger.reports.filterPurpose", { naziv: labels.purpose || t("ledger.reports.noPurposeFilter") })} <RowLink href={`${PATH}${qs({ from: range.from, to: range.to, prikaz: keep.prikaz })}`}>{t("ledger.reports.clearFilter")}</RowLink></>} />
      )}
      {labels.project !== null && (
        <Flash msg={<>{tf("ledger.reports.filterProject", { naziv: labels.project || t("ledger.reports.noProjectFilter") })} <RowLink href={`${PATH}${qs({ from: range.from, to: range.to, prikaz: keep.prikaz })}`}>{t("ledger.reports.clearFilter")}</RowLink></>} />
      )}
      {!tb.balanced && <Flash warn={t("ledger.reports.unbalanced")} />}
      <RangeFilter range={range} path={PATH} keep={keep} hidden={{ namjena: sp.namjena, projekat: sp.projekat }}>
        <Field label={t("ledger.reports.view")}>
          <select name="prikaz" defaultValue={withSummary ? "zbirno" : ""} className={inputCls}>
            <option value="">{t("ledger.reports.onlyPostable")}</option>
            <option value="zbirno">{t("ledger.reports.withSummary")}</option>
          </select>
        </Field>
      </RangeFilter>
      <Card>
        <Table
          id="trial-balance" caption={t("ledger.reports.list.trial.title")} headers={headers} empty={tb.rows.length === 0}
          emptyTitle={t("ledger.reports.empty")} emptyHint={t("ledger.reports.emptyHint")}
        >
          {tb.rows.map((r) => (
            <tr key={r.accountId}>
              <Td>
                <span style={withSummary ? { paddingLeft: `${r.depth * 12}px` } : undefined} className={r.postable ? "" : "font-semibold"}>
                  <RowLink href={cardHref(r.accountId)}><span className="whitespace-nowrap tabular-nums">{r.code}</span></RowLink> {r.name}
                </span>
              </Td>
              <Td><span className="whitespace-nowrap tabular-nums">{amt(r.openingDebit)}</span></Td>
              <Td><span className="whitespace-nowrap tabular-nums">{amt(r.openingCredit)}</span></Td>
              <Td><span className="whitespace-nowrap tabular-nums">{amt(r.debit)}</span></Td>
              <Td><span className="whitespace-nowrap tabular-nums">{amt(r.credit)}</span></Td>
              <Td><span className="whitespace-nowrap tabular-nums">{amt(r.closingDebit)}</span></Td>
              <Td><span className="whitespace-nowrap tabular-nums">{amt(r.closingCredit)}</span></Td>
            </tr>
          ))}
          {tb.rows.length > 0 && (
            <tr>
              <Td><span className="font-semibold">{t("ledger.reports.total")}</span></Td>
              <Td><span className="whitespace-nowrap font-semibold tabular-nums">{km(tb.totals.openingDebit)}</span></Td>
              <Td><span className="whitespace-nowrap font-semibold tabular-nums">{km(tb.totals.openingCredit)}</span></Td>
              <Td><span className="whitespace-nowrap font-semibold tabular-nums">{km(tb.totals.debit)}</span></Td>
              <Td><span className="whitespace-nowrap font-semibold tabular-nums">{km(tb.totals.credit)}</span></Td>
              <Td><span className="whitespace-nowrap font-semibold tabular-nums">{km(tb.totals.closingDebit)}</span></Td>
              <Td><span className="whitespace-nowrap font-semibold tabular-nums">{km(tb.totals.closingCredit)}</span></Td>
            </tr>
          )}
        </Table>
      </Card>
    </div>
  );
}
