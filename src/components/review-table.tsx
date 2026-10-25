"use client";
// ReviewTable (F5b.1, odluka D5 B) — tok „pregledaj → potvrdi”: tabela redova koje čovjek ispravlja prije nego što se
// išta upiše (PDF izvod, SMS obavještenja banke). Klijentski primitiv u svom fajlu: `ui.tsx` ostaje bez klijentskog koda.
//
//  - Desktop: izgled `Table`-a (ista zaglavlja, bez sopstvenog okvira i sjenke — živi u `Card`-u), polja su `inputCls`.
//  - < md: svaki red je kartica (isti card-transform kao `Table`, `buildTableCss`), polje po polje sa labelom iznad;
//    naslov kartice (iznos + platilac) stoji uz checkbox.
//  - Svako polje ima `aria-label` sa brojem reda (`fieldLabel`), smjer je `StatusBadge`, upozorenja su `Flash warn inset`.
//  - Ljepljivi sažetak na dnu: „Označeno 12 od 15 · Uplate … · Isplate …” + radnje (jedno `primary`: potvrda).
import type { ReactNode } from "react";
import { buildTableCss, inputCls, StatusBadge, type ColumnSpec } from "@/components/ui";
import { t, tf } from "@/lib/i18n";
import { formatKm, type ReviewSummary } from "@/lib/reviewSummary";

/** `aria-label` polja sa brojem reda: „Iznos, red 3”. */
export function fieldLabel(field: string, rowNumber: number): string {
  return tf("reviewTable.fieldAria", { polje: field, red: rowNumber });
}

/** Klase polja u ćeliji: `inputCls` (fokus prsten); minimalna širina važi samo od `md` (na telefonu polje je cijela širina kartice). */
export const reviewField = `${inputCls} min-w-0`;
export const reviewFieldW = {
  date: "md:min-w-[9.5rem]",
  amount: "md:min-w-24 text-right tabular-nums",
  text: "md:min-w-40",
  wide: "md:min-w-52",
  select: "md:min-w-56 md:max-w-[20rem]",
} as const;
/** Poziv na broj / IBAN (R-N22: mono samo na vrijednosti, nikad na labeli). */
export const reviewMono = "font-mono text-[13px] text-slate-600";

/** Smjer kao `StatusBadge` (uplata = zelena, isplata = amber, kao i do sada u SMS pregledu). */
export function DirectionBadge({ direction }: { direction: "IN" | "OUT" }) {
  return (
    <StatusBadge
      status={direction === "IN" ? "DIRECTION_IN" : "DIRECTION_OUT"}
      label={direction === "IN" ? t("reviewTable.directionIn") : t("reviewTable.directionOut")}
    />
  );
}

export type ReviewGroup<R> = {
  key: string;
  /** Zaglavlje grupe (npr. naziv izvoda sa upozorenjima) preko cijele širine; bez njega grupa nema zaglavlje. */
  header?: ReactNode;
  rows: R[];
};

export type ReviewRowContext = { rowNumber: number; groupIndex: number; rowIndex: number };

export type ReviewTableProps<R> = {
  /** Obavezan i jedinstven na stranici (CSS card-transforma je vezan za njega). */
  id: string;
  caption: string;
  /** Kolone BEZ kolone sa checkboxom — nju dodaje tabela kad je zadat `onToggle`. */
  columns: ColumnSpec[];
  groups: ReviewGroup<R>[];
  /** Ćelije jednog reda, redom kao `columns`. */
  renderCells: (row: R, ctx: ReviewRowContext) => ReactNode[];
  /** Checkbox „Uvezi” po redu; izostaviti kad red nije moguće označiti (npr. pregled bez ovlašćenja). */
  isSelected?: (row: R) => boolean;
  onToggle?: (groupIndex: number, rowIndex: number, checked: boolean) => void;
  selectLabel?: string;
  /** Naslov kartice na telefonu (iznos + platilac) uz checkbox; na desktopu se ne prikazuje. */
  cardTitle?: (row: R) => ReactNode;
  /** Ljepljivi sažetak: oznake i zbirovi. */
  summary?: ReviewSummary;
  /** Radnje u ljepljivoj traci (potvrda `primary` + „Odustani”). */
  actions?: ReactNode;
};

// Ispod md labela polja ide IZNAD polja (card-transform `Table`-a stavlja labelu lijevo u 40% širine — za polja za unos
// je to pretijesno), a zaglavlje grupe i red-kartica dobijaju prilagođen izgled.
function reviewCss(id: string): string {
  return `@media (max-width:767px){
  #${id} tbody tr { display:block; }
  #${id} tbody td { grid-template-columns:1fr !important; gap:0.25rem !important; }
  #${id} tbody td > * { grid-column:auto; justify-self:stretch; }
  #${id} tbody tr[data-group-head] { border:none; padding:0.25rem 0; background:transparent; margin-bottom:0.5rem; }
  #${id} tbody tr[data-group-head] td { display:block !important; padding:0 !important; }
  #${id} tbody tr[data-off="true"] { background:#f8fafc; }
  #${id} tbody td[data-title]::before { display:none !important; }
}`;
}

const TH_CLS = "px-3 py-2 text-xs font-semibold uppercase tracking-wider text-slate-500";

export function ReviewTable<R>({
  id, caption, columns, groups, renderCells, isSelected, onToggle, selectLabel, cardTitle, summary, actions,
}: ReviewTableProps<R>) {
  const selectable = Boolean(onToggle && isSelected);
  const allColumns: ColumnSpec[] = selectable ? [{ label: selectLabel ?? t("reviewTable.select") }, ...columns] : columns;
  const css = buildTableCss(id, allColumns, true) + "\n" + reviewCss(id);
  let counter = 0;

  return (
    <div>
      {/* Bez sopstvenog okvira i sjenke (pravilo elevacije); tabIndex + role = skrolanje tastaturom kao kod `Table`. */}
      <div
        id={id}
        tabIndex={0}
        role="region"
        aria-label={caption}
        className="overflow-x-auto rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-1"
      >
        <style dangerouslySetInnerHTML={{ __html: css }} />
        <table className="w-full text-sm">
          <caption className="sr-only">{caption}</caption>
          <thead>
            <tr className="border-b border-slate-200 bg-slate-50/80 text-left">
              {allColumns.map((c, i) => (
                <th key={c.label + i} scope="col" className={TH_CLS}>{c.label}</th>
              ))}
            </tr>
          </thead>
          {groups.map((g, gi) => (
            <tbody key={g.key} className="divide-y divide-slate-100 border-t-2 border-slate-200 first:border-t-0">
              {g.header && (
                <tr data-group-head className="bg-slate-50/70">
                  <td colSpan={allColumns.length} className="px-3 py-2">{g.header}</td>
                </tr>
              )}
              {g.rows.map((row, ri) => {
                counter += 1;
                const rowNumber = counter;
                const on = selectable ? isSelected!(row) : true;
                const cells = renderCells(row, { rowNumber, groupIndex: gi, rowIndex: ri });
                return (
                  <tr key={ri} data-off={selectable && !on ? "true" : undefined} className={selectable && !on ? "bg-slate-50/60" : ""}>
                    {selectable && (
                      <td className="px-3 py-1.5 align-top" data-title={cardTitle ? "" : undefined}>
                        <label className="inline-flex min-h-[28px] items-center gap-2 max-md:min-h-[44px]">
                          <input
                            type="checkbox"
                            className="h-4 w-4"
                            aria-label={fieldLabel(selectLabel ?? t("reviewTable.select"), rowNumber)}
                            checked={on}
                            onChange={(e) => onToggle!(gi, ri, e.target.checked)}
                          />
                          {cardTitle && <span className="text-[15px] font-semibold text-ink md:hidden">{cardTitle(row)}</span>}
                        </label>
                      </td>
                    )}
                    {cells.map((cell, ci) => (
                      <td key={ci} className="px-3 py-1.5 align-top">{cell}</td>
                    ))}
                  </tr>
                );
              })}
            </tbody>
          ))}
        </table>
      </div>
      {(summary || actions) && (
        <div className="sticky bottom-0 z-10 mt-3 flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-t border-border bg-surface py-3">
          {summary && (
            <p className="text-sm text-ink-body" aria-live="polite">
              <span className="font-semibold">
                {tf("reviewTable.summary", { oznaceno: summary.selected, ukupno: summary.total })}
              </span>
              <span className="tabular-nums">
                {" · "}{tf("reviewTable.inTotal", { iznos: formatKm(summary.inTotal) })}
                {" · "}{tf("reviewTable.outTotal", { iznos: formatKm(summary.outTotal) })}
              </span>
            </p>
          )}
          {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
        </div>
      )}
    </div>
  );
}
