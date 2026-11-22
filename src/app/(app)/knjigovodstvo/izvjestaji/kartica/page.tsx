import { requireActor } from "@/server/actor";
import { getZevChart } from "@/server/services/chartOfAccounts";
import { accountCard, filterLabels, reportRange } from "@/server/services/ledgerReports";
import { t, tf } from "@/lib/i18n";
import { Card, Field, Flash, inputCls, RowLink } from "@/components/ui";
import { CardTable, qs, RangeFilter, ReportHeader } from "../shared";

const PATH = "/knjigovodstvo/izvjestaji/kartica";

/** Kartica konta (B3a §3.2): promet jednog konta sa saldom poslije svake stavke; zbirno konto obuhvata podkonta. */
export default async function AccountCardPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; to?: string; konto?: string; namjena?: string; projekat?: string }>;
}) {
  const actor = await requireActor("PRESIDENT", "ACCOUNTANT");
  const sp = await searchParams;
  const range = await reportRange(actor, sp.from, sp.to);
  const dims = { purposeId: sp.namjena || null, projectId: sp.projekat || null };
  const [chart, card, labels] = await Promise.all([
    getZevChart(actor),
    sp.konto ? accountCard(actor, { from: range.from, to: range.to, accountId: sp.konto, ...dims }) : Promise.resolve(null),
    filterLabels(actor, dims),
  ]);
  const accounts = [...(chart?.accounts ?? [])].sort((a, b) => (a.code < b.code ? -1 : 1));
  const keep = { konto: sp.konto, namjena: sp.namjena, projekat: sp.projekat };
  const csv = card ? `/api/knjigovodstvo/izvjestaji/csv${qs({ type: "kartica", from: range.from, to: range.to, ...keep })}` : undefined;
  const clear = `${PATH}${qs({ konto: sp.konto, from: range.from, to: range.to })}`;

  return (
    <div>
      <ReportHeader title={t("ledger.reports.list.card.title")} range={range} csvHref={csv} />
      {labels.purpose !== null && (
        <Flash msg={<>{tf("ledger.reports.filterPurpose", { naziv: labels.purpose || t("ledger.reports.noPurposeFilter") })} <RowLink href={clear}>{t("ledger.reports.clearFilter")}</RowLink></>} />
      )}
      {labels.project !== null && (
        <Flash msg={<>{tf("ledger.reports.filterProject", { naziv: labels.project || t("ledger.reports.noProjectFilter") })} <RowLink href={clear}>{t("ledger.reports.clearFilter")}</RowLink></>} />
      )}
      <RangeFilter range={range} path={PATH} keep={keep} hidden={{ namjena: sp.namjena, projekat: sp.projekat }}>
        <Field label={t("ledger.reports.account")}>
          <select name="konto" defaultValue={sp.konto ?? ""} required className={inputCls}>
            <option value="">{t("ledger.reports.chooseAccount")}</option>
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>{a.code} {a.name}</option>
            ))}
          </select>
        </Field>
      </RangeFilter>
      {card ? (
        <Card title={`${card.account.code} ${card.account.name}`} hint={card.account.postable ? undefined : t("ledger.reports.summaryAccount")}>
          <CardTable id="account-card" card={card} />
        </Card>
      ) : (
        <p className="max-w-[68ch] text-sm text-slate-600">{t("ledger.reports.chooseAccountHint")}</p>
      )}
    </div>
  );
}
