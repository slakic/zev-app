// Čista logika card-transforma `Table`-a (CSS generisan po tabeli) — u .ts fajlu da je testabilna bez JSX-a.
// `ui.tsx` re-izvozi sve odavde, pa se i dalje uvozi iz "@/components/ui".

/** A table column's behavior across breakpoints (Plans/ui-ux-redesign-plan.md §3.B).
 *  `priority` controls desktop/tablet progressive disclosure: "primary" is always a real table
 *  column; "secondary" only becomes one from `md`; "detail" only from `lg`. Below `md`, none of
 *  that matters — if the table has more than 5 columns or an `actions` column (`useCardTransform` below, per P5 + F8.1) the
 *  whole table becomes a stack of row-cards instead, and *every* column reappears there as a
 *  label:value line (nothing "disappears", it just moves — see `buildTableCss`). `sortKey` is
 *  inert until Faza 3g wires up sortable headers; it's here now so 3g doesn't need to touch
 *  every call site's `headers` array again. */
export type ColumnSpec = {
  label: string;
  priority?: "primary" | "secondary" | "detail";
  align?: "left" | "right";
  sortKey?: string;
  nowrap?: boolean;
  /** Kolona sa radnjama (dugmad/linkovi u redu). Tabela koja je ima uvijek postaje kartice ispod `md`
   *  (F8.1, odluka D3 A — radnja ne smije završiti van ekrana), a u kartici ova kolona ide na dno,
   *  bez labele, radnje jedna do druge. */
  actions?: true;
};

/** Escapes a string for safe use inside a generated CSS `content: "…"` value — the only
 *  untrusted-ish input here is a column label, and only quotes/backslashes can break out of it. */
function cssStringEscape(s: string): string {
  return s.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

/** Labela u card-transformu uvijek ide u osnovnom fontu: ćelija sa `font-mono` (poziv na broj, IBAN) inače nasljeđuje
 *  monospace i na `::before` (R-N22). Isti stack kao `body` u `globals.css`. */
const CARD_LABEL_FONT = 'Roboto,system-ui,-apple-system,"Segoe UI","Helvetica Neue",Arial,sans-serif';

/** Pravilo card-transforma (P5 + F8.1/D3): tabela ispod `md` postaje kartice kad ima više od 5 kolona ILI kolonu radnji
 *  (radnja van ekrana nije prihvatljiva ni u tabeli sa 3 kolone). */
export function usesCardTransform(columns: ColumnSpec[]): boolean {
  return columns.length > 5 || columns.some((c) => c.actions);
}

/** One `<style>` block per table instance, keyed by `id`, replacing what would otherwise be a
 *  `label` prop on every one of the ~260 `<Td>` call sites in the app (rejected in §3.B — it can
 *  silently drift from `headers`, which is the exact "offset" bug this whole mechanism exists to
 *  prevent). `nth-child` reads the column's position, so alignment/priority/card-labels all come
 *  from one source of truth (`columns`) that `<thead>` and `<tbody>` both render from.
 *  Breakpoint reasoning, since it's easy to get backwards:
 *  - `align`/`nowrap` apply at every width — they're about the *content*, not the layout mode.
 *  - `priority` "secondary"/"detail" hide a column *as a table column* between `md` and `lg` (or
 *    below `lg` entirely for "detail") — but only when the table ISN'T using the card transform.
 *    Once `useCardTransform` is on, those same columns reappear as card rows below `md`, so the
 *    "hide below md" half of the rule would fight the card CSS for the same cells — it's omitted
 *    in that case, and only the md-to-lg "detail" hide (still real table layout there) applies. */
export function buildTableCss(id: string, columns: ColumnSpec[], useCardTransform: boolean): string {
  const rules: string[] = [];

  columns.forEach((col, i) => {
    const n = i + 1;
    const sel = `#${id} thead th:nth-child(${n}), #${id} tbody td:nth-child(${n})`;
    if (col.align === "right") rules.push(`${sel}{text-align:right}`);
    if (col.nowrap) rules.push(`${sel}{white-space:nowrap}`);
    if (col.priority === "secondary" && !useCardTransform) {
      rules.push(`@media (max-width:767px){${sel}{display:none}}`);
    }
    if (col.priority === "detail") {
      const lowerBound = useCardTransform ? " and (min-width:768px)" : "";
      rules.push(`@media (max-width:1023px)${lowerBound}{${sel}{display:none}}`);
    }
  });

  if (useCardTransform) {
    // Red-kartica je flex kolona da bi `order` radio: `primary` ćelija ide na vrh (-1), kolona radnji na dno (99).
    // Sadržaj ćelije (`td > *`) ide u drugu grid kolonu (X-N19): drugo dijete više ne pada pod labelu, a chip se
    // ne rasteže preko cijele širine (`justify-self:start`).
    rules.push(`@media (max-width:767px) {
  #${id} thead { display:none; }
  #${id} tbody tr { display:flex; flex-direction:column; border:1px solid #e2e8f0; border-radius:0.75rem; padding:0.75rem 1rem; margin-bottom:0.75rem; background:#fff; }
  #${id} tbody tr:last-child { margin-bottom:0; }
  #${id} tbody td { display:grid; grid-template-columns:40% minmax(0,1fr); gap:0.5rem; overflow-wrap:anywhere; align-items:baseline; padding:0.375rem 0; border:none !important; text-align:left !important; white-space:normal !important; }
  #${id} tbody td > * { grid-column:2; justify-self:start; min-width:0; max-width:100%; }
  #${id} tbody td[colspan] { display:block; grid-template-columns:none; }
}`);
    columns.forEach((col, i) => {
      const n = i + 1;
      if (col.actions) {
        rules.push(
          `@media (max-width:767px){#${id} tbody td:nth-child(${n}){order:99;display:flex;flex-wrap:wrap;align-items:center;gap:0.5rem;padding-top:0.75rem;}#${id} tbody td:nth-child(${n}) > *{grid-column:auto;justify-self:auto;}#${id} tbody td:nth-child(${n}):empty{display:none;}}`,
        );
      } else if (col.priority === "primary") {
        rules.push(`@media (max-width:767px){#${id} tbody td:nth-child(${n}){order:-1;display:block;font-weight:600;font-size:0.9375rem;color:#0f172a;}}`);
      } else {
        rules.push(
          `@media (max-width:767px){#${id} tbody td:nth-child(${n}):not([colspan])::before{content:"${cssStringEscape(col.label)}";font-family:${CARD_LABEL_FONT};font-weight:500;font-size:0.8125rem;color:#64748b;}}`,
        );
      }
    });
  }

  return rules.join("\n");
}

