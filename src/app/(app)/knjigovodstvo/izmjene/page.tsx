import { requireActor } from "@/server/actor";
import { hasCapability } from "@/lib/accountingCapabilities";
import { getChartUpdate } from "@/server/services/chartOfAccounts";
import { formatDate, t, tEnum, tf } from "@/lib/i18n";
import { PageHeader, Card, Flash, Table, Td, ConfirmAction, type ColumnSpec } from "@/components/ui";
import { applyChartUpdateAction } from "@/server/actions/chartOfAccounts";

const FORM_ID = "chart-sync";

const addedHeaders: ColumnSpec[] = [
  { label: t("ledger.sync.colTake") },
  { label: t("ledger.sync.colAccount"), priority: "primary" },
  { label: t("ledger.sync.colParent"), priority: "secondary" },
  { label: t("ledger.sync.colNature"), priority: "detail" },
  { label: t("ledger.sync.colKind"), priority: "detail" },
];
const renamedHeaders: ColumnSpec[] = [
  { label: t("ledger.sync.colTake") },
  { label: t("ledger.sync.colAccount"), priority: "primary" },
  { label: t("ledger.sync.colCurrent") },
  { label: t("ledger.sync.colNew") },
];
const meaningHeaders: ColumnSpec[] = [
  { label: t("ledger.sync.colAccount"), priority: "primary" },
  { label: t("ledger.sync.colCurrent") },
  { label: t("ledger.sync.colNew") },
];
const removedHeaders: ColumnSpec[] = [{ label: t("ledger.sync.colAccount"), priority: "primary" }];

const kind = (postable: boolean) => (postable ? t("ledger.list.postable") : t("ledger.list.summary"));
const checkboxCls = "h-5 w-5 accent-primary";

/**
 * „Izmjene iz nove verzije predloška” (§3.4): ništa se ne preuzima samo. Računovođa bira nova konta i nove nazive;
 * promjena značenja i uklonjena konta su samo informacija (rješavaju se ručno, zamjenom ili deaktivacijom konta).
 */
export default async function ChartUpdatePage({ searchParams }: { searchParams: Promise<{ err?: string }> }) {
  const actor = await requireActor("PRESIDENT", "ACCOUNTANT");
  const sp = await searchParams;
  const canEdit = hasCapability(actor.roles, "chart.edit");
  const diff = await getChartUpdate(actor);

  if (!diff) {
    return (
      <div>
        <PageHeader title={t("ledger.sync.title")} backHref="/knjigovodstvo" backLabel={t("ledger.sync.back")} />
        <Flash err={sp.err} />
        <Card><p className="text-sm text-slate-600">{t("ledger.sync.none")}</p></Card>
      </div>
    );
  }

  const { target } = diff;
  return (
    <div>
      <PageHeader
        title={t("ledger.sync.title")}
        subtitle={tf("ledger.sync.subtitle", { naziv: target.name, verzija: target.version })}
        backHref="/knjigovodstvo"
        backLabel={t("ledger.sync.back")}
      />
      <Flash err={sp.err} />
      <div className="space-y-6">
        <Card>
          <dl className="grid grid-cols-1 gap-x-6 gap-y-3 text-sm sm:grid-cols-2">
            <div><dt className="text-hint text-slate-500">{t("ledger.chart.legalSource")}</dt><dd>{target.source ?? "—"}</dd></div>
            <div>
              <dt className="text-hint text-slate-500">{t("ledger.sync.reviewedBy")}</dt>
              <dd>{target.reviewedBy ? `${target.reviewedBy}, ${formatDate(target.reviewedAt)}` : "—"}</dd>
            </div>
          </dl>
        </Card>

        <Card title={t("ledger.sync.addedTitle")} hint={diff.added.length ? t("ledger.sync.addedHint") : undefined}>
          <Table id="sync-added" caption={t("ledger.sync.addedTitle")} headers={addedHeaders} empty={diff.added.length === 0} emptyTitle={t("ledger.sync.addedEmpty")}>
            {diff.added.map((a) => (
              <tr key={a.code}>
                <Td>
                  <input
                    type="checkbox" name="add" value={a.code} form={FORM_ID} defaultChecked={!a.parentMissing}
                    disabled={!canEdit || a.parentMissing} aria-label={tf("ledger.sync.take", { sifra: a.code })} className={checkboxCls}
                  />
                </Td>
                <Td><span className={a.postable ? undefined : "font-semibold"}><span className="tabular-nums">{a.code}</span> {a.name}</span></Td>
                <Td>{a.parentMissing ? t("ledger.sync.parentMissing") : a.parentCode ?? "—"}</Td>
                <Td>{tEnum("accountNature", a.nature)}</Td>
                <Td>{kind(a.postable)}</Td>
              </tr>
            ))}
          </Table>
        </Card>

        <Card title={t("ledger.sync.renamedTitle")} hint={diff.renamed.length ? t("ledger.sync.renamedHint") : undefined}>
          <Table id="sync-renamed" caption={t("ledger.sync.renamedTitle")} headers={renamedHeaders} empty={diff.renamed.length === 0} emptyTitle={t("ledger.sync.renamedEmpty")}>
            {diff.renamed.map((r) => (
              <tr key={r.code}>
                <Td>
                  <input
                    type="checkbox" name="rename" value={r.code} form={FORM_ID} defaultChecked disabled={!canEdit}
                    aria-label={tf("ledger.sync.takeName", { sifra: r.code })} className={checkboxCls}
                  />
                </Td>
                <Td><span className="tabular-nums">{r.code}</span></Td>
                <Td>{r.zevName}</Td>
                <Td>{r.newName}</Td>
              </tr>
            ))}
          </Table>
        </Card>

        {diff.changedMeaning.length > 0 && (
          <Card title={t("ledger.sync.meaningTitle")} hint={t("ledger.sync.meaningHint")}>
            <Table id="sync-meaning" caption={t("ledger.sync.meaningTitle")} headers={meaningHeaders}>
              {diff.changedMeaning.map((c) => (
                <tr key={c.code}>
                  <Td><span className="tabular-nums">{c.code}</span> {c.name}</Td>
                  <Td>{tEnum("accountNature", c.zevNature)} · {kind(c.zevPostable)}</Td>
                  <Td>{tEnum("accountNature", c.newNature)} · {kind(c.newPostable)}</Td>
                </tr>
              ))}
            </Table>
          </Card>
        )}

        {diff.removed.length > 0 && (
          <Card title={t("ledger.sync.removedTitle")} hint={t("ledger.sync.removedHint")}>
            <Table id="sync-removed" caption={t("ledger.sync.removedTitle")} headers={removedHeaders}>
              {diff.removed.map((r) => (
                <tr key={r.code}><Td><span className="tabular-nums">{r.code}</span> {r.name}</Td></tr>
              ))}
            </Table>
          </Card>
        )}

        <Card>
          {canEdit ? (
            <ConfirmAction
              trigger={t("ledger.sync.submit")}
              title={t("ledger.sync.confirmTitle")}
              body={<p className="text-sm text-amber-900">{tf("ledger.sync.confirmBody", { verzija: target.version })}</p>}
              confirmLabel={t("ledger.sync.confirm")}
              confirmVariant="primary"
              action={applyChartUpdateAction}
              formId={FORM_ID}
              hiddenFields={{ targetId: target.id }}
            />
          ) : (
            <p className="text-sm text-slate-600">{t("ledger.sync.readOnly")}</p>
          )}
        </Card>
      </div>
    </div>
  );
}
