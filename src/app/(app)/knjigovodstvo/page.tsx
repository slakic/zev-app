import { requireActor } from "@/server/actor";
import { hasCapability } from "@/lib/accountingCapabilities";
import { countRetiredCharts, getZevChart, listAssignableTemplates, listFiscalYears } from "@/server/services/chartOfAccounts";
import { formatDate, t, tEnum, tf } from "@/lib/i18n";
import {
  PageHeader, Card, Flash, Tabs, FilterBar, Field, inputCls, SubmitBtn, ToggleBtn, ConfirmAction, StatusBadge, Table, Td,
  type ColumnSpec,
} from "@/components/ui";
import { AccountTreeTable } from "@/components/account-tree-table";
import { AddAccountForm } from "@/components/add-account-form";
import { ledgerMessage } from "@/lib/ledgerMessages";
import { activateChartAction, assignChartAction, openFiscalYearAction, retireChartAction } from "@/server/actions/chartOfAccounts";

const TABS = ["plan", "godine", "pravila", "nalozi", "izvjestaji"] as const;
type TabKey = (typeof TABS)[number];
const TAB_LABEL: Record<TabKey, string> = {
  plan: "ledger.tabs.plan",
  godine: "ledger.tabs.periods",
  pravila: "ledger.tabs.rules",
  nalozi: "ledger.tabs.journal",
  izvjestaji: "ledger.tabs.reports",
};

const periodHeaders: ColumnSpec[] = [
  { label: t("ledger.periods.colPeriod"), priority: "primary" },
  { label: t("ledger.periods.colFrom") },
  { label: t("ledger.periods.colTo") },
  { label: t("ledger.periods.colStatus") },
];

/**
 * „Knjigovodstvo” (Plans/kontni-plan-i-knjizenje-plan.md §3.8, Faza A1): kontni plan ZEV-a i poslovne godine.
 * Pravila, nalozi i izvještaji su vidljivi kao tabovi sa „Nije još dostupno” (A-Q7). Prava: predsjednik vidi,
 * računovođa uređuje — provjerava ih servis (`requireCapability`), stranica samo bira šta prikazuje.
 */
export default async function LedgerPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string; q?: string; show?: string; msg?: string; err?: string }>;
}) {
  const actor = await requireActor("PRESIDENT", "ACCOUNTANT");
  const sp = await searchParams;
  const tab: TabKey = (TABS as readonly string[]).includes(sp.tab ?? "") ? (sp.tab as TabKey) : "plan";
  const canEdit = hasCapability(actor.roles, "chart.edit");
  const canOpenPeriod = hasCapability(actor.roles, "period.open");
  const msg = ledgerMessage(sp.msg);

  return (
    <div>
      <PageHeader title={t("ledger.title")} subtitle={t("ledger.subtitle")} />
      <Flash msg={msg} err={sp.err} />
      <Flash warn={t("ledger.notLegal")} />
      <Tabs
        tabs={TABS.map((key) => ({ key, label: t(TAB_LABEL[key]) }))}
        active={tab}
        hrefFor={(key) => (key === "plan" ? "/knjigovodstvo" : `/knjigovodstvo?tab=${key}`)}
      />
      {tab === "plan" && <PlanTab actor={actor} canEdit={canEdit} q={sp.q ?? ""} show={sp.show === "all" ? "all" : "active"} />}
      {tab === "godine" && <PeriodsTab actor={actor} canOpen={canOpenPeriod} />}
      {tab === "pravila" && <NotYet text={t("ledger.upcoming.rules")} title={t("ledger.tabs.rules")} />}
      {tab === "nalozi" && <NotYet text={t("ledger.upcoming.journal")} title={t("ledger.tabs.journal")} />}
      {tab === "izvjestaji" && <NotYet text={t("ledger.upcoming.reports")} title={t("ledger.tabs.reports")} />}
    </div>
  );
}

function NotYet({ title, text }: { title: string; text: string }) {
  return (
    <Card title={title}>
      <div className="space-y-3">
        <StatusBadge status="NOT_YET_AVAILABLE" label={t("ledger.notYet")} />
        <p className="max-w-[68ch] text-sm text-slate-600">{text}</p>
      </div>
    </Card>
  );
}

type Actor = Awaited<ReturnType<typeof requireActor>>;

async function PlanTab({ actor, canEdit, q, show }: { actor: Actor; canEdit: boolean; q: string; show: "active" | "all" }) {
  const chart = await getZevChart(actor);
  if (!chart) {
    const [templates, retired] = await Promise.all([canEdit ? listAssignableTemplates(actor) : Promise.resolve([]), countRetiredCharts(actor)]);
    return (
      <Card title={t("ledger.assign.cardTitle")} hint={canEdit ? t("ledger.assign.hint") : undefined}>
        {!canEdit ? (
          <p className="text-sm text-slate-600">{t("ledger.assign.readOnly")}</p>
        ) : templates.length === 0 ? (
          <p className="max-w-[68ch] text-sm text-slate-600">{t("ledger.assign.none")}</p>
        ) : (
          <form action={assignChartAction} className="flex flex-wrap items-end gap-3">
            <Field label={t("ledger.assign.template")}>
              <select name="templateId" required className={inputCls}>
                {templates.map((tpl) => (
                  <option key={tpl.id} value={tpl.id}>
                    {tpl.name} · v{tpl.version} · {tEnum("chartTemplateStatus", tpl.status)} · {tf("ledger.assign.accountsCount", { broj: tpl._count.accounts })}
                  </option>
                ))}
              </select>
            </Field>
            <SubmitBtn>{t("ledger.assign.submit")}</SubmitBtn>
          </form>
        )}
        {retired > 0 && <p className="mt-3 text-hint text-slate-500">{tf("ledger.chart.retiredCount", { broj: retired })}</p>}
      </Card>
    );
  }

  const needle = q.trim().toLocaleLowerCase("sr-Latn");
  const rows = chart.accounts.filter(
    (a) =>
      (show === "all" || a.active) &&
      (!needle || a.code.toLocaleLowerCase("sr-Latn").includes(needle) || a.name.toLocaleLowerCase("sr-Latn").includes(needle))
  );
  const summaryParents = chart.accounts.filter((a) => !a.postable && a.active);
  const tpl = chart.sourceTemplate;
  const isDraft = chart.status === "DRAFT";

  return (
    <div className="space-y-6">
      <Card title={t("ledger.chart.cardTitle")}>
        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-2">
            <StatusBadge status={chart.status} label={tEnum("zevChartStatus", chart.status)} />
            {tpl.status === "DEMO" && <StatusBadge status="DEMO" label={tEnum("chartTemplateStatus", "DEMO")} />}
          </div>
          <dl className="grid grid-cols-1 gap-x-6 gap-y-3 text-sm sm:grid-cols-2">
            <div><dt className="text-hint text-slate-500">{t("ledger.chart.source")}</dt><dd>{tpl.name} · v{tpl.version}</dd></div>
            <div><dt className="text-hint text-slate-500">{t("ledger.chart.legalSource")}</dt><dd>{tpl.source ?? "—"}</dd></div>
            <div>
              <dt className="text-hint text-slate-500">{t("ledger.chart.review")}</dt>
              <dd>{tpl.reviewedBy ? `${tpl.reviewedBy}, ${formatDate(tpl.reviewedAt)}` : "—"}</dd>
            </div>
            <div><dt className="text-hint text-slate-500">{t("ledger.chart.accounts")}</dt><dd className="tabular-nums">{chart.accounts.length}</dd></div>
            {chart.activatedAt && (
              <div><dt className="text-hint text-slate-500">{t("ledger.chart.activatedAt")}</dt><dd>{formatDate(chart.activatedAt)}</dd></div>
            )}
          </dl>
          {tpl.status === "DEMO" && <Flash inset warn={t("ledger.chart.demo")} />}
          {isDraft && <p className="max-w-[68ch] text-sm text-slate-600">{t("ledger.chart.draftHint")}</p>}
          {canEdit && (
            <div className="flex flex-wrap items-start gap-3">
              {isDraft && (
                <ConfirmAction
                  trigger={t("ledger.chart.activate")}
                  title={t("ledger.chart.activateTitle")}
                  body={<p className="text-sm text-amber-900">{t("ledger.chart.activateBody")}</p>}
                  confirmLabel={t("ledger.chart.activateConfirm")}
                  confirmVariant="primary"
                  action={activateChartAction}
                />
              )}
              <ConfirmAction
                trigger={t("ledger.chart.retire")}
                title={t("ledger.chart.retireTitle")}
                body={<p className="text-sm text-amber-900">{t("ledger.chart.retireBody")}</p>}
                confirmLabel={t("ledger.chart.retireConfirm")}
                action={retireChartAction}
              >
                <Field label={t("ledger.account.reason")}>
                  <input name="reason" required className={inputCls} />
                </Field>
              </ConfirmAction>
            </div>
          )}
        </div>
      </Card>

      <Card title={t("ledger.list.cardTitle")}>
        <FilterBar>
          <Field label={t("ledger.list.search")}>
            <input name="q" defaultValue={q} className={inputCls} />
          </Field>
          <Field label={t("ledger.list.show")}>
            <select name="show" defaultValue={show} className={inputCls}>
              <option value="active">{t("ledger.list.showActive")}</option>
              <option value="all">{t("ledger.list.showAll")}</option>
            </select>
          </Field>
        </FilterBar>
        <AccountTreeTable
          id="zev-accounts"
          caption={t("ledger.list.cardTitle")}
          rows={rows}
          hrefFor={(r) => `/knjigovodstvo/konto/${r.id}`}
          emptyTitle={t("ledger.list.emptyTitle")}
          emptyHint={t("ledger.list.emptyHint")}
        />
        {canEdit && (
          <details className="group mt-4">
            <ToggleBtn variant="tonal">{t("ledger.add.toggle")}</ToggleBtn>
            <AddAccountForm parents={summaryParents} allowRoot={isDraft} />
          </details>
        )}
      </Card>
    </div>
  );
}

async function PeriodsTab({ actor, canOpen }: { actor: Actor; canOpen: boolean }) {
  const years = await listFiscalYears(actor);
  const nextYear = years.length > 0 ? years[0].endDate.getUTCFullYear() + 1 : new Date().getFullYear();
  return (
    <div className="space-y-6">
      {years.length === 0 && (
        <Card title={t("ledger.periods.cardTitle")}>
          <p className="text-sm text-slate-600">{t("ledger.periods.empty")} {canOpen ? t("ledger.periods.emptyHint") : ""}</p>
        </Card>
      )}
      {years.map((y) => (
        <Card key={y.id} title={y.label} hint={`${formatDate(y.startDate)} – ${formatDate(y.endDate)} · ${t("ledger.periods.closeLater")}`}>
          <Table id={`fy-${y.id}`} caption={y.label} headers={periodHeaders} empty={y.periods.length === 0} emptyTitle={t("ledger.periods.empty")}>
            {y.periods.map((p) => (
              <tr key={p.id}>
                <Td>{p.label}</Td>
                <Td>{formatDate(p.startDate)}</Td>
                <Td>{formatDate(p.endDate)}</Td>
                <Td><StatusBadge status={p.status} label={tEnum("fiscalStatus", p.status)} /></Td>
              </tr>
            ))}
          </Table>
        </Card>
      ))}
      {canOpen && (
        <Card title={t("ledger.periods.open")}>
          <form action={openFiscalYearAction} className="flex flex-wrap items-end gap-3">
            <Field label={t("ledger.periods.label")}>
              <input name="label" required defaultValue={String(nextYear)} className={inputCls} />
            </Field>
            <Field label={t("ledger.periods.start")}>
              <input name="startDate" type="date" required defaultValue={`${nextYear}-01-01`} className={inputCls} />
            </Field>
            <Field label={t("ledger.periods.end")}>
              <input name="endDate" type="date" required defaultValue={`${nextYear}-12-31`} className={inputCls} />
            </Field>
            <Field label={t("ledger.periods.periodicity")}>
              <select name="periodicity" className={inputCls}>
                <option value="MONTHLY">{t("ledger.periods.monthly")}</option>
                <option value="YEARLY">{t("ledger.periods.yearly")}</option>
              </select>
            </Field>
            <SubmitBtn variant="tonal">{t("ledger.periods.submit")}</SubmitBtn>
          </form>
        </Card>
      )}
    </div>
  );
}
