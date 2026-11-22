// Zajednički dijelovi izvještaja iz knjige (B3a, Plans/kontni-plan-b3-izvjestaji-plan.md §2.2): filter perioda,
// brzi izbor poslovne godine, iznos i tabela kartice konta.
import Link from "next/link";
import type { ReactNode } from "react";
import { formatMoney } from "@/lib/money";
import { formatDate, t, tEnum, tf } from "@/lib/i18n";
import { BtnLink, Field, FilterBar, inputCls, PageHeader, RowLink, Table, Td, type ColumnSpec } from "@/components/ui";
import type { Card as LedgerCard } from "@/server/services/ledgerReports";

export const REPORTS_HREF = "/knjigovodstvo?tab=izvjestaji";

/** Upitni niz bez praznih vrijednosti. */
export function qs(params: Record<string, string | null | undefined>): string {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v) p.set(k, v);
  const s = p.toString();
  return s ? `?${s}` : "";
}

/** Iznos u tabeli izvještaja, bez oznake valute (valuta je u podnaslovu), da kolone ostanu uske. */
export function km(v: string): string {
  return formatMoney(v, "").trim();
}

/** Iznos u ćeliji: nula se ne ispisuje, da se u tabeli vidi samo ono što ima promet. */
export function amt(v: string): string {
  return v === "0.00" || v === "-0.00" ? "" : km(v);
}

export function ReportHeader({ title, range, csvHref }: { title: string; range: { from: string; to: string }; csvHref?: string }) {
  return (
    <PageHeader
      title={title}
      subtitle={tf("ledger.reports.period", { od: formatDate(range.from), do: formatDate(range.to) })}
      backHref={REPORTS_HREF}
      backLabel={t("ledger.reports.back")}
      actions={csvHref ? <BtnLink href={csvHref} variant="secondary">{t("ledger.reports.csv")}</BtnLink> : undefined}
    />
  );
}

/** GET filter sa periodom; `children` su dodatna polja, `hidden` parametri koji moraju preživjeti „Primijeni”. */
export function RangeFilter({
  range, children, hidden = {}, path, keep = {},
}: {
  range: { from: string; to: string; years: { label: string; from: string; to: string }[] };
  children?: ReactNode;
  hidden?: Record<string, string | null | undefined>;
  /** Putanja i parametri za veze „cijela poslovna godina”. */
  path: string;
  keep?: Record<string, string | null | undefined>;
}) {
  return (
    <div>
      <FilterBar>
        {Object.entries(hidden).map(([k, v]) => (v ? <input key={k} type="hidden" name={k} value={v} /> : null))}
        {children}
        <Field label={t("ledger.reports.from")}>
          <input type="date" name="from" defaultValue={range.from} required className={inputCls} />
        </Field>
        <Field label={t("ledger.reports.to")}>
          <input type="date" name="to" defaultValue={range.to} required className={inputCls} />
        </Field>
      </FilterBar>
      {range.years.length > 0 && (
        <p className="-mt-2 mb-4 flex flex-wrap gap-x-3 text-hint text-slate-500">
          <span>{t("ledger.reports.years")}</span>
          {range.years.map((y) => (
            <Link key={y.label} href={`${path}${qs({ ...keep, from: y.from, to: y.to })}`} className="font-medium text-blue-700 hover:underline">
              {y.label}
            </Link>
          ))}
        </p>
      )}
    </div>
  );
}

const cardHeaders: ColumnSpec[] = [
  { label: t("ledger.reports.col.date"), nowrap: true },
  { label: t("ledger.reports.col.entry"), priority: "primary", nowrap: true },
  { label: t("ledger.reports.col.description"), priority: "secondary" },
  { label: t("ledger.reports.col.d"), align: "right" },
  { label: t("ledger.reports.col.p"), align: "right" },
  { label: t("ledger.reports.col.balance"), align: "right" },
];

/** Kartica konta: početno stanje, red po stavci sa saldom u prirodnoj strani konta, zbir i završno stanje. */
export function CardTable({ id, card }: { id: string; card: LedgerCard }) {
  return (
    <Table id={id} caption={`${card.account.code} ${card.account.name}`} headers={cardHeaders}>
      <tr>
        <Td>{""}</Td>
        <Td>{""}</Td>
        <Td><span className="font-medium">{t("ledger.reports.opening")}</span></Td>
        <Td><span className="whitespace-nowrap tabular-nums">{amt(card.openingDebit)}</span></Td>
        <Td><span className="whitespace-nowrap tabular-nums">{amt(card.openingCredit)}</span></Td>
        <Td><span className="whitespace-nowrap tabular-nums">{km(card.opening)}</span></Td>
      </tr>
      {card.rows.map((r) => (
        <tr key={r.lineId}>
          <Td>{formatDate(r.postingDate)}</Td>
          <Td><RowLink href={`/knjigovodstvo/nalozi/${r.entryId}`}>{r.number ?? "—"}</RowLink></Td>
          <Td>
            <span>{r.description}</span>
            {(r.analytics || !card.account.postable) && (
              <span className="block text-hint text-slate-500">
                {[!card.account.postable ? r.accountCode : null, r.analytics, tEnum("journalKind", r.kind)].filter(Boolean).join(", ")}
              </span>
            )}
          </Td>
          <Td><span className="whitespace-nowrap tabular-nums">{amt(r.debit)}</span></Td>
          <Td><span className="whitespace-nowrap tabular-nums">{amt(r.credit)}</span></Td>
          <Td><span className="whitespace-nowrap tabular-nums">{km(r.balance)}</span></Td>
        </tr>
      ))}
      <tr>
        <Td>{""}</Td>
        <Td>{""}</Td>
        <Td><span className="font-semibold">{t("ledger.reports.closing")}</span></Td>
        <Td><span className="whitespace-nowrap font-semibold tabular-nums">{km(card.debit)}</span></Td>
        <Td><span className="whitespace-nowrap font-semibold tabular-nums">{km(card.credit)}</span></Td>
        <Td><span className="whitespace-nowrap font-semibold tabular-nums">{km(card.closing)}</span></Td>
      </tr>
    </Table>
  );
}
