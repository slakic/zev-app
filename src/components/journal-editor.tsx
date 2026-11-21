"use client";
// Uređivač nacrta naloga za knjiženje (B1-Q1 (a), Plans/kontni-plan-b1-nalozi-plan.md §5): zaglavlje + promjenljiv
// broj stavki u postojećoj `Table` (na telefonu red = kartica), zbirovi i razlika uživo. Iznosi se računaju u
// cijelim feninzima (kao reviewSummary.ts) — money.ts/Decimal ne ide u klijentski bundle. Server (journal.ts) ponovo
// provjerava sve; ovo je samo pomoć pri unosu. Analitika (vlasnik, dio, dobavljač, projekat, namjena) je u
// otvorivom dijelu reda, da red ostane čitljiv.
import { useActionState, useMemo, useState } from "react";
import { Btn, Field, Flash, inputCls, RowAction, StatusBadge, SubmitBtn, Table, Td, type ColumnSpec } from "@/components/ui";

type Opt = { id: string; label: string };
export type JournalEditorOptions = {
  accounts: Opt[];
  parties: Opt[];
  units: Opt[];
  suppliers: Opt[];
  projects: Opt[];
  purposes: Opt[];
};
export type EditorLine = {
  accountId: string; debit: string; credit: string;
  partyId: string; unitId: string; supplierId: string; projectId: string; purposeId: string; description: string;
};
export type EditorLabels = {
  documentDate: string; postingDate: string; description: string;
  colAccount: string; colDebit: string; colCredit: string; colDetails: string; colActions: string;
  pickAccount: string; analytics: string; party: string; unit: string; supplier: string; project: string; purpose: string; none: string;
  lineDescription: string; addLine: string; removeLine: string; total: string; difference: string; balanced: string; save: string;
  caption: string; emptyTitle: string;
};

const emptyLine = (): EditorLine => ({ accountId: "", debit: "", credit: "", partyId: "", unitId: "", supplierId: "", projectId: "", purposeId: "", description: "" });

function cents(v: string): number {
  const n = Number(v.replace(/\s/g, "").replace(",", "."));
  return Number.isFinite(n) ? Math.round(n * 100) : 0;
}
const fmt = (c: number) => (c / 100).toLocaleString("sr-Latn", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export function JournalEditor({
  action, entryId, options, labels, initial, fixedDates, base,
}: {
  /** Server akcija za useActionState: greška se vraća (redovi ostaju), uspjeh preusmjerava. */
  action: (prev: { error: string } | null, fd: FormData) => Promise<{ error: string } | null>;
  entryId?: string;
  options: JournalEditorOptions;
  labels: EditorLabels;
  initial: { documentDate: string; postingDate: string; description: string; lines: EditorLine[] };
  /** Početno stanje: datumi su zadati (datum početka), pa se polja za datum ne prikazuju. */
  fixedDates?: boolean;
  /** Zbirovi stavki koje nisu u uređivaču (stavke iz evidencije), u feninzima — ulaze u zbir i razliku. */
  base?: { debit: number; credit: number };
}) {
  const [lines, setLines] = useState<EditorLine[]>(initial.lines.length ? initial.lines : [emptyLine(), emptyLine()]);
  const [state, formAction, pending] = useActionState(action, null);
  // Zaglavlje je kontrolisano kao i stavke: React 19 poslije akcije forme vraća nekontrolisana polja na početne
  // vrijednosti, pa bi poslije greške opis nestao i forma se tiho ne bi poslala (required).
  const [header, setHeader] = useState({ documentDate: initial.documentDate, postingDate: initial.postingDate, description: initial.description });
  const set = (i: number, patch: Partial<EditorLine>) => setLines((ls) => ls.map((l, k) => (k === i ? { ...l, ...patch } : l)));
  const { debit, credit } = useMemo(
    () => lines.reduce((t, l) => ({ debit: t.debit + cents(l.debit), credit: t.credit + cents(l.credit) }), { debit: base?.debit ?? 0, credit: base?.credit ?? 0 }),
    [lines, base?.debit, base?.credit]
  );
  const diff = debit - credit;
  const columns: ColumnSpec[] = [
    { label: labels.colAccount, priority: "primary" },
    { label: labels.colDebit, align: "right" },
    { label: labels.colCredit, align: "right" },
    { label: labels.colDetails },
    { label: labels.colActions, actions: true },
  ];
  const sel = (value: string, onChange: (v: string) => void, opts: Opt[], label: string) => (
    <Field label={label}>
      <select value={value} onChange={(e) => onChange(e.target.value)} className={inputCls}>
        <option value="">{labels.none}</option>
        {opts.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
      </select>
    </Field>
  );

  return (
    <form action={formAction} className="space-y-4">
      {state?.error && <Flash inset err={state.error} />}
      {entryId && <input type="hidden" name="id" value={entryId} />}
      <input type="hidden" name="payload" value={JSON.stringify(lines)} />
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {!fixedDates && <>
        <Field label={labels.documentDate}><input type="date" name="documentDate" required value={header.documentDate} onChange={(e) => setHeader((h) => ({ ...h, documentDate: e.target.value }))} className={inputCls} /></Field>
        <Field label={labels.postingDate}><input type="date" name="postingDate" required value={header.postingDate} onChange={(e) => setHeader((h) => ({ ...h, postingDate: e.target.value }))} className={inputCls} /></Field>
        </>}
        <Field label={labels.description}><input name="description" required value={header.description} onChange={(e) => setHeader((h) => ({ ...h, description: e.target.value }))} className={inputCls} /></Field>
      </div>
      <Table id="journal-editor" caption={labels.caption} headers={columns} empty={lines.length === 0} emptyTitle={labels.emptyTitle}>
        {lines.map((l, i) => {
          const hasDims = !!(l.partyId || l.unitId || l.supplierId || l.projectId || l.purposeId || l.description);
          return (
            <tr key={i}>
              <Td>
                <select value={l.accountId} onChange={(e) => set(i, { accountId: e.target.value })} aria-label={`${labels.colAccount} ${i + 1}`} className={inputCls}>
                  <option value="">{labels.pickAccount}</option>
                  {options.accounts.map((a) => <option key={a.id} value={a.id}>{a.label}</option>)}
                </select>
              </Td>
              <Td>
                <input
                  inputMode="decimal" value={l.debit} aria-label={`${labels.colDebit} ${i + 1}`}
                  onChange={(e) => set(i, { debit: e.target.value, credit: e.target.value ? "" : l.credit })}
                  className={`${inputCls} text-right tabular-nums`}
                />
              </Td>
              <Td>
                <input
                  inputMode="decimal" value={l.credit} aria-label={`${labels.colCredit} ${i + 1}`}
                  onChange={(e) => set(i, { credit: e.target.value, debit: e.target.value ? "" : l.debit })}
                  className={`${inputCls} text-right tabular-nums`}
                />
              </Td>
              <Td>
                <details className="group" open={hasDims || undefined}>
                  <summary className="cursor-pointer text-hint font-medium text-primary-ink">{labels.analytics}</summary>
                  <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2">
                    {sel(l.partyId, (v) => set(i, { partyId: v }), options.parties, labels.party)}
                    {sel(l.unitId, (v) => set(i, { unitId: v }), options.units, labels.unit)}
                    {sel(l.supplierId, (v) => set(i, { supplierId: v }), options.suppliers, labels.supplier)}
                    {sel(l.projectId, (v) => set(i, { projectId: v }), options.projects, labels.project)}
                    {sel(l.purposeId, (v) => set(i, { purposeId: v }), options.purposes, labels.purpose)}
                    <Field label={labels.lineDescription}>
                      <input value={l.description} onChange={(e) => set(i, { description: e.target.value })} className={inputCls} />
                    </Field>
                  </div>
                </details>
              </Td>
              <Td>
                <RowAction type="button" onClick={() => setLines((ls) => ls.filter((_, k) => k !== i))}>{labels.removeLine}</RowAction>
              </Td>
            </tr>
          );
        })}
      </Table>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Btn type="button" variant="tonal" onClick={() => setLines((ls) => [...ls, emptyLine()])}>{labels.addLine}</Btn>
        <div className="flex flex-wrap items-center gap-3 text-sm tabular-nums" aria-live="polite">
          <span>{labels.total}: {fmt(debit)} / {fmt(credit)}</span>
          {debit === 0 && credit === 0
            ? null
            : diff === 0
              ? <StatusBadge status="COVER_OK" label={labels.balanced} />
              : <StatusBadge status="COVER_MISSING" label={`${labels.difference}: ${fmt(Math.abs(diff))}`} />}
        </div>
      </div>
      <SubmitBtn variant="tonal" disabled={pending}>{labels.save}</SubmitBtn>
    </form>
  );
}
