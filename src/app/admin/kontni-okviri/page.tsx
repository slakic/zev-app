import { requireSuperAdminActor } from "@/server/actor";
import { listTemplates } from "@/server/services/chartOfAccounts";
import { ledgerMessage } from "@/lib/ledgerMessages";
import { t, tEnum } from "@/lib/i18n";
import { PageHeader, Card, Flash, Table, Td, RowLink, StatusBadge, ToggleBtn, SubmitBtn, type ColumnSpec } from "@/components/ui";
import { TemplateMetaFields } from "@/components/template-meta-fields";
import { createTemplateAction } from "@/server/actions/chartOfAccounts";

const headers: ColumnSpec[] = [
  { label: t("ledger.templates.colName"), priority: "primary" },
  { label: t("ledger.templates.colVersion"), align: "right" },
  { label: t("ledger.templates.colJurisdiction"), priority: "detail" },
  { label: t("ledger.templates.colStatus") },
  { label: t("ledger.templates.colAccounts"), align: "right", priority: "detail" },
  { label: t("ledger.templates.colCharts"), align: "right", priority: "detail" },
];

/** „Kontni okviri” (A1, A-Q1 (a)): platformski predlošci kontnih planova; ZEV-ovi ih preuzimaju kao kopiju. */
export default async function ChartTemplatesPage({ searchParams }: { searchParams: Promise<{ msg?: string; err?: string }> }) {
  const actor = await requireSuperAdminActor();
  const sp = await searchParams;
  const templates = await listTemplates(actor);
  return (
    <div>
      <PageHeader title={t("ledger.templates.title")} subtitle={t("ledger.templates.subtitle")} />
      <Flash msg={ledgerMessage(sp.msg)} err={sp.err} />
      <div className="space-y-6">
        <Card title={t("ledger.templates.cardTitle")}>
          <Table
            id="chart-templates"
            caption={t("ledger.templates.cardTitle")}
            headers={headers}
            empty={templates.length === 0}
            emptyTitle={t("ledger.templates.emptyTitle")}
            emptyHint={t("ledger.templates.emptyHint")}
          >
            {templates.map((tpl) => (
              <tr key={tpl.id}>
                <Td><RowLink href={`/admin/kontni-okviri/${tpl.id}`}>{tpl.name}</RowLink></Td>
                <Td><span className="tabular-nums">{tpl.version}</span></Td>
                <Td>{tpl.jurisdiction}</Td>
                <Td><StatusBadge status={tpl.status} label={tEnum("chartTemplateStatus", tpl.status)} /></Td>
                <Td><span className="tabular-nums">{tpl._count.accounts}</span></Td>
                <Td><span className="tabular-nums">{tpl._count.zevCharts}</span></Td>
              </tr>
            ))}
          </Table>
          <details className="group mt-4">
            <ToggleBtn variant="tonal">{t("ledger.templates.new")}</ToggleBtn>
            <form action={createTemplateAction} className="mt-3 space-y-4">
              <TemplateMetaFields withKey />
              <SubmitBtn variant="tonal">{t("ledger.templates.create")}</SubmitBtn>
            </form>
          </details>
        </Card>
      </div>
    </div>
  );
}
