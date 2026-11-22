import { requireActor } from "@/server/actor";
import { AGE_BUCKETS, asOfDay, openItemsAt, type OpenGroup } from "@/server/services/ledgerReconciliation";
import { formatDate, t, tf } from "@/lib/i18n";
import { Card, RowLink, Table, Td, type ColumnSpec } from "@/components/ui";
import { amt, AsOfFilter, km, qs, ReportHeader } from "../shared";

const PATH = "/knjigovodstvo/izvjestaji/otvorene-stavke";

const groupHeaders: ColumnSpec[] = [
  { label: t("ledger.reports.open.col.name"), priority: "primary" },
  ...AGE_BUCKETS.map((b): ColumnSpec => ({ label: t(`ledger.reports.open.col.${b}`), align: "right" })),
  { label: t("ledger.reports.open.col.total"), align: "right" },
];
const itemHeaders: ColumnSpec[] = [
  { label: t("ledger.reports.open.col.number"), priority: "primary" },
  { label: t("ledger.reports.open.col.due") },
  { label: t("ledger.reports.open.col.days"), align: "right" },
  { label: t("ledger.reports.open.col.amount"), align: "right" },
  { label: t("ledger.reports.open.col.entry") },
];

function Groups({
  id, title, groups, total, empty, selected, param, asOf, itemHref,
}: {
  id: string; title: string; groups: OpenGroup[]; total: { buckets: Record<string, string>; total: string };
  empty: string; selected?: string; param: "vlasnik" | "dobavljac"; asOf: string; itemHref: (id: string) => string;
}) {
  const sel = groups.find((g) => g.id === selected);
  return (
    <Card title={title}>
      <div className="space-y-6">
        <Table id={id} caption={title} headers={groupHeaders} empty={groups.length === 0} emptyTitle={empty}>
          {groups.map((g) => (
            <tr key={g.id}>
              <Td><RowLink href={`${PATH}${qs({ dan: asOf, [param]: g.id })}#${id}-items`}>{g.name}</RowLink></Td>
              {AGE_BUCKETS.map((b) => <Td key={b}><span className="whitespace-nowrap tabular-nums">{amt(g.buckets[b])}</span></Td>)}
              <Td><span className="whitespace-nowrap font-medium tabular-nums">{km(g.total)}</span></Td>
            </tr>
          ))}
          {groups.length > 0 && (
            <tr>
              <Td><span className="font-semibold">{t("ledger.reports.total")}</span></Td>
              {AGE_BUCKETS.map((b) => <Td key={b}><span className="whitespace-nowrap font-semibold tabular-nums">{amt(total.buckets[b])}</span></Td>)}
              <Td><span className="whitespace-nowrap font-semibold tabular-nums">{km(total.total)}</span></Td>
            </tr>
          )}
        </Table>
        {sel && (
          <div id={`${id}-items`}>
            <h3 className="mb-2 text-sm font-semibold text-slate-700">{tf("ledger.reports.open.itemsTitle", { naziv: sel.name })}</h3>
            <Table id={`${id}-detail`} caption={tf("ledger.reports.open.itemsTitle", { naziv: sel.name })} headers={itemHeaders}>
              {sel.items.map((i) => (
                <tr key={i.id}>
                  <Td><RowLink href={itemHref(i.id)}>{i.number}</RowLink></Td>
                  <Td>{i.dueDate ? formatDate(i.dueDate) : t("ledger.reports.open.noDue")}</Td>
                  <Td><span className="tabular-nums">{i.days}</span></Td>
                  <Td><span className="whitespace-nowrap tabular-nums">{km(i.amount)}</span></Td>
                  <Td>{i.entryId ? <RowLink href={`/knjigovodstvo/nalozi/${i.entryId}`}>{i.entryNumber}</RowLink> : <span className="text-slate-500">{t("ledger.reports.open.notPosted")}</span>}</Td>
                </tr>
              ))}
            </Table>
          </div>
        )}
      </div>
    </Card>
  );
}

/** Otvorene stavke po dospijeću (B3b §4.3, B3-Q3 (a)): iz evidencije, sa kontrolnim zbirom prema knjizi. */
export default async function OpenItemsPage({ searchParams }: { searchParams: Promise<{ dan?: string; vlasnik?: string; dobavljac?: string }> }) {
  const actor = await requireActor("PRESIDENT", "ACCOUNTANT");
  const sp = await searchParams;
  const asOf = asOfDay(sp.dan);
  const r = await openItemsAt(actor, asOf);
  const csv = `/api/knjigovodstvo/izvjestaji/csv${qs({ type: "otvorene-stavke", dan: asOf })}`;
  const reconHref = `/knjigovodstvo/izvjestaji/uskladjivanje${qs({ dan: asOf })}`;

  return (
    <div>
      <ReportHeader title={t("ledger.reports.list.openItems.title")} asOf={asOf} csvHref={csv} />
      <AsOfFilter asOf={asOf} />
      <p className="mb-4 max-w-[68ch] text-sm text-slate-600">{t("ledger.reports.open.hint")}</p>
      <div className="space-y-6">
        <Groups
          id="open-owners" title={t("ledger.reports.open.ownersTitle")} groups={r.owners} total={r.ownersTotal} empty={t("ledger.reports.open.emptyOwners")}
          selected={sp.vlasnik} param="vlasnik" asOf={asOf} itemHref={(id) => `/fakture/${id}`}
        />
        <Groups
          id="open-suppliers" title={t("ledger.reports.open.suppliersTitle")} groups={r.suppliers} total={r.suppliersTotal} empty={t("ledger.reports.open.emptySuppliers")}
          selected={sp.dobavljac} param="dobavljac" asOf={asOf} itemHref={() => "/troskovi?tab=troskovi"}
        />
        {r.control && (
          <Card>
            <div className="space-y-1 text-sm text-slate-600">
              {r.control.receivableLedger !== null && (
                <p>{tf("ledger.reports.open.controlReceivable", { evidencija: km(r.ownersTotal.total), korekcije: km(r.control.receivableCorrections), knjiga: km(r.control.receivableLedger) })}</p>
              )}
              {r.control.payableLedger !== null && (
                <p>{tf("ledger.reports.open.controlPayable", { evidencija: km(r.suppliersTotal.total), knjiga: km(r.control.payableLedger) })}</p>
              )}
              <p><RowLink href={reconHref}>{t("ledger.reports.open.controlLink")}</RowLink></p>
            </div>
          </Card>
        )}
      </div>
    </div>
  );
}
