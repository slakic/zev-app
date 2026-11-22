// Kartica vlasnika / dobavljača (B3a §3.4): kartice konta samo sa stavkama izabranog vlasnika odnosno dobavljača.
import { dimensionCard, dimensionOptions, reportRange } from "@/server/services/ledgerReports";
import { t } from "@/lib/i18n";
import { Card, Field, inputCls } from "@/components/ui";
import type { Actor } from "@/server/auth/guards";
import { CardTable, qs, RangeFilter, ReportHeader } from "./shared";

export async function DimensionReport({
  actor, dim, sp,
}: {
  actor: Actor;
  dim: "party" | "supplier";
  sp: { from?: string; to?: string; id?: string };
}) {
  const range = await reportRange(actor, sp.from, sp.to);
  const [options, cards] = await Promise.all([
    dimensionOptions(actor, dim),
    sp.id ? dimensionCard(actor, { from: range.from, to: range.to, dim, id: sp.id }) : Promise.resolve([]),
  ]);
  const isParty = dim === "party";
  const path = isParty ? "/knjigovodstvo/izvjestaji/vlasnik" : "/knjigovodstvo/izvjestaji/dobavljac";
  const csv = sp.id ? `/api/knjigovodstvo/izvjestaji/csv${qs({ type: isParty ? "vlasnik" : "dobavljac", id: sp.id, from: range.from, to: range.to })}` : undefined;

  return (
    <div>
      <ReportHeader title={t(isParty ? "ledger.reports.list.owners.title" : "ledger.reports.list.suppliers.title")} range={range} csvHref={csv} />
      <RangeFilter range={range} path={path} keep={{ id: sp.id }}>
        <Field label={t(isParty ? "ledger.reports.owner" : "ledger.reports.supplier")}>
          <select name="id" defaultValue={sp.id ?? ""} required className={inputCls}>
            <option value="">{t(isParty ? "ledger.reports.chooseOwner" : "ledger.reports.chooseSupplier")}</option>
            {options.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
          </select>
        </Field>
      </RangeFilter>
      {!sp.id ? (
        <p className="max-w-[68ch] text-sm text-slate-600">{t(isParty ? "ledger.reports.chooseOwnerHint" : "ledger.reports.chooseSupplierHint")}</p>
      ) : cards.length === 0 ? (
        <p className="max-w-[68ch] text-sm text-slate-600">{t("ledger.reports.noneForDimension")}</p>
      ) : (
        <div className="space-y-6">
          {cards.map((c) => (
            <Card key={c.account.id} title={`${c.account.code} ${c.account.name}`}>
              <CardTable id={`card-${c.account.code}`} card={c} />
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
