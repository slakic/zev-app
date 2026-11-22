import { requireActor } from "@/server/actor";
import { journalBook, reportRange } from "@/server/services/ledgerReports";
import { formatDate, t, tEnum } from "@/lib/i18n";
import { Card, Field, inputCls, RowLink, Table, Td, type ColumnSpec } from "@/components/ui";
import { amt, km, qs, RangeFilter, ReportHeader } from "../shared";

const PATH = "/knjigovodstvo/izvjestaji/dnevnik";
const KINDS = ["MANUAL", "OPENING", "REVERSAL", "AUTO"] as const;

const headers: ColumnSpec[] = [
  { label: t("ledger.reports.col.entry"), priority: "primary", nowrap: true },
  { label: t("ledger.reports.col.date"), nowrap: true },
  { label: t("ledger.reports.col.description"), priority: "secondary" },
  { label: t("ledger.reports.col.account") },
  { label: t("ledger.reports.col.d"), align: "right" },
  { label: t("ledger.reports.col.p"), align: "right" },
];

/** Dnevnik knjiženja (B3a §3.1): proknjiženi nalozi u periodu, hronološki, sa stavkama; zbir duguje = potražuje. */
export default async function JournalBookPage({ searchParams }: { searchParams: Promise<{ from?: string; to?: string; vrsta?: string }> }) {
  const actor = await requireActor("PRESIDENT", "ACCOUNTANT");
  const sp = await searchParams;
  const range = await reportRange(actor, sp.from, sp.to);
  const book = await journalBook(actor, { from: range.from, to: range.to, kind: sp.vrsta });
  const csv = `/api/knjigovodstvo/izvjestaji/csv${qs({ type: "dnevnik", from: range.from, to: range.to, kind: sp.vrsta })}`;

  return (
    <div>
      <ReportHeader title={t("ledger.reports.list.journal.title")} range={range} csvHref={csv} />
      <RangeFilter range={range} path={PATH} keep={{ vrsta: sp.vrsta }}>
        <Field label={t("ledger.reports.kind")}>
          <select name="vrsta" defaultValue={sp.vrsta ?? ""} className={inputCls}>
            <option value="">{t("ledger.reports.kindAll")}</option>
            {KINDS.map((k) => <option key={k} value={k}>{tEnum("journalKind", k)}</option>)}
          </select>
        </Field>
      </RangeFilter>
      <Card>
        <Table
          id="journal-book" caption={t("ledger.reports.list.journal.title")} headers={headers} empty={book.entries.length === 0}
          emptyTitle={t("ledger.reports.empty")} emptyHint={t("ledger.reports.emptyHint")}
        >
          {book.entries.flatMap((e) =>
            e.lines.map((l, i) => (
              <tr key={l.id} className={i === 0 ? "border-t-2 border-slate-200" : undefined}>
                <Td>{i === 0 ? <RowLink href={`/knjigovodstvo/nalozi/${e.id}`}>{e.number ?? "—"}</RowLink> : ""}</Td>
                <Td>{i === 0 ? formatDate(e.postingDate) : ""}</Td>
                <Td>
                  {i === 0 && (
                    <span className="block">
                      {e.description} <span className="text-hint text-slate-500">({tEnum("journalKind", e.kind)})</span>
                    </span>
                  )}
                  {(l.description || l.analytics) && <span className="block text-hint text-slate-500">{[l.analytics, l.description].filter(Boolean).join(", ")}</span>}
                </Td>
                <Td><span className="whitespace-nowrap tabular-nums">{l.accountCode}</span> {l.accountName}</Td>
                <Td><span className="whitespace-nowrap tabular-nums">{amt(l.debit)}</span></Td>
                <Td><span className="whitespace-nowrap tabular-nums">{amt(l.credit)}</span></Td>
              </tr>
            )),
          )}
          {book.entries.length > 0 && (
            <tr>
              <Td><span className="font-semibold">{t("ledger.reports.total")}</span></Td>
              <Td>{""}</Td>
              <Td>{""}</Td>
              <Td>{""}</Td>
              <Td><span className="whitespace-nowrap font-semibold tabular-nums">{km(book.debit)}</span></Td>
              <Td><span className="whitespace-nowrap font-semibold tabular-nums">{km(book.credit)}</span></Td>
            </tr>
          )}
        </Table>
      </Card>
    </div>
  );
}
