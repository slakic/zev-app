// Tab „Nalozi” (B1a, Plans/kontni-plan-b1-nalozi-plan.md §5): lista naloga sa filterom perioda i statusa.
import { hasCapability } from "@/lib/accountingCapabilities";
import { listEntries } from "@/server/services/journal";
import { openingStatus } from "@/server/services/openingBalance";
import { listFiscalYears } from "@/server/services/chartOfAccounts";
import { formatMoney } from "@/lib/money";
import { formatDate, t, tEnum, tf } from "@/lib/i18n";
import { BtnLink, Card, Field, FilterBar, inputCls, RowLink, StatusBadge, Table, Td, type ColumnSpec } from "@/components/ui";
import type { requireActor } from "@/server/actor";

type Actor = Awaited<ReturnType<typeof requireActor>>;

const headers: ColumnSpec[] = [
  { label: t("ledger.journal.colNumber"), priority: "primary" },
  { label: t("ledger.journal.colDate") },
  { label: t("ledger.journal.colDescription"), priority: "secondary" },
  { label: t("ledger.journal.colKind"), priority: "detail" },
  { label: t("ledger.journal.colAmount"), align: "right" },
  { label: t("ledger.journal.colStatus") },
];

export async function JournalTab({ actor, periodId, status }: { actor: Actor; periodId: string; status: string }) {
  const canPrepare = hasCapability(actor.roles, "journal.prepare");
  const [entries, years, opening] = await Promise.all([listEntries(actor, { periodId, status }), listFiscalYears(actor), openingStatus(actor)]);
  const periods = years.flatMap((y) => y.periods);

  return (
    <div className="space-y-6">
      <p className="max-w-[68ch] text-sm text-slate-600">{t("ledger.journal.intro")}</p>
      {periods.length === 0 && <p className="max-w-[68ch] text-sm text-slate-600">{t("ledger.journal.needsYear")}</p>}
      <Card title={t("ledger.journal.listTitle")}>
        <div className="space-y-3">
          {canPrepare && periods.length > 0 && <BtnLink href="/knjigovodstvo/nalozi/novi" variant="primary">{t("ledger.journal.new")}</BtnLink>}
          <FilterBar>
            <input type="hidden" name="tab" value="nalozi" />
            <Field label={t("ledger.journal.period")}>
              <select name="period" defaultValue={periodId} className={inputCls}>
                <option value="">{t("ledger.journal.allPeriods")}</option>
                {periods.map((p) => <option key={p.id} value={p.id}>{p.label}</option>)}
              </select>
            </Field>
            <Field label={t("ledger.journal.status")}>
              <select name="status" defaultValue={status} className={inputCls}>
                <option value="">{t("ledger.journal.allStatuses")}</option>
                <option value="DRAFT">{tEnum("journalStatus", "DRAFT")}</option>
                <option value="POSTED">{tEnum("journalStatus", "POSTED")}</option>
              </select>
            </Field>
          </FilterBar>
          <Table
            id="journal-list" caption={t("ledger.journal.listTitle")} headers={headers} empty={entries.length === 0}
            emptyTitle={t("ledger.journal.empty")} emptyHint={canPrepare ? t("ledger.journal.emptyHint") : undefined}
          >
            {entries.map((e) => (
              <tr key={e.id}>
                <Td><RowLink href={`/knjigovodstvo/nalozi/${e.id}`}>{e.number ?? t("ledger.journal.draftNoNumber")}</RowLink></Td>
                <Td>{formatDate(e.postingDate)}</Td>
                <Td>{e.description}</Td>
                <Td>{tEnum("journalKind", e.kind)}</Td>
                <Td><span className="tabular-nums">{formatMoney(e.total)}</span></Td>
                <Td><StatusBadge status={e.status} label={tEnum("journalStatus", e.status)} /></Td>
              </tr>
            ))}
          </Table>
        </div>
      </Card>
      <Card title={t("ledger.journal.openingTitle")}>
        <div className="space-y-3">
          <p className="max-w-[68ch] text-sm text-slate-600">
            {opening.posted
              ? tf("ledger.journal.openingPosted", { broj: opening.posted.number ?? "" })
              : opening.draft
                ? tf("ledger.journal.openingDraft", { datum: formatDate(opening.draft.postingDate) })
                : t("ledger.journal.openingNone")}
          </p>
          {(periods.length > 0 || opening.posted) && <BtnLink href="/knjigovodstvo/pocetno-stanje" variant="tonal">{t("ledger.journal.openingOpen")}</BtnLink>}
        </div>
      </Card>
    </div>
  );
}
