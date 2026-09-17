// Small shared UI primitives (server-component friendly, accessible).
// Styling follows Material Design cues — soft elevation, generous rounding,
// pill-shaped chips/buttons, outlined inputs — built entirely with Tailwind
// utilities so every page (which composes these primitives) picks up the
// look at once.
import Link from "next/link";
import type { ReactNode, ButtonHTMLAttributes } from "react";

export function PageHeader({
  title, subtitle, actions, backHref, backLabel,
}: { title: string; subtitle?: string; actions?: ReactNode; backHref?: string; backLabel?: string }) {
  return (
    <div className="mb-6 flex flex-wrap items-start justify-between gap-3">
      <div>
        {backHref && (
          <Link
            href={backHref}
            className="mb-2 inline-flex items-center gap-1 rounded-full px-2 py-1 -ml-2 text-sm font-medium text-blue-700 transition-colors hover:bg-blue-50"
          >
            ‹ {backLabel ?? "Nazad"}
          </Link>
        )}
        <h1 className="text-2xl font-semibold tracking-tight text-slate-900">{title}</h1>
        {subtitle && <p className="mt-1 text-[15px] text-slate-500">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export function Card({
  title, hint, children, className,
}: { title?: string; hint?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={`rounded-xl border border-slate-200/80 bg-white p-5 shadow-sm ${className ?? ""}`}>
      {title && <h2 className={`text-sm font-semibold text-slate-700 ${hint ? "" : "mb-3"}`}>{title}</h2>}
      {hint && <p className="mb-3 mt-0.5 text-[13px] text-slate-500">{hint}</p>}
      {children}
    </section>
  );
}

export function Stat({ label, value, tone }: { label: string; value: string; tone?: "ok" | "warn" | "bad" | "neutral" }) {
  const toneCls =
    tone === "ok" ? "text-emerald-700" : tone === "warn" ? "text-amber-700" : tone === "bad" ? "text-red-700" : "text-slate-900";
  const barCls =
    tone === "ok" ? "bg-emerald-500" : tone === "warn" ? "bg-amber-500" : tone === "bad" ? "bg-red-500" : "bg-blue-500";
  return (
    <div className="overflow-hidden rounded-xl border border-slate-200/80 bg-white shadow-sm">
      <div className={`h-1 ${barCls}`} />
      <div className="p-4">
        <div className="text-xs font-medium uppercase tracking-wider text-slate-500">{label}</div>
        <div className={`mt-1.5 text-2xl font-semibold tabular-nums ${toneCls}`}>{value}</div>
      </div>
    </div>
  );
}

const badgeTones: Record<string, string> = {
  green: "bg-emerald-50 text-emerald-800 ring-emerald-600/20",
  red: "bg-red-50 text-red-800 ring-red-600/20",
  amber: "bg-amber-50 text-amber-800 ring-amber-600/20",
  blue: "bg-blue-50 text-blue-800 ring-blue-600/20",
  slate: "bg-slate-100 text-slate-700 ring-slate-500/20",
};

const statusTone: Record<string, string> = {
  // generic
  DRAFT: "slate", ISSUED: "blue", PAID: "green", CANCELLED: "red", CORRECTED: "amber",
  ACTIVE: "green", EXPIRED: "slate", REVOKED: "red", USED: "blue", SUPERSEDED: "slate",
  ACCEPTED: "green", REJECTED: "red", WITHDRAWN: "slate", VOTING_OPEN: "blue", VOTING_CLOSED: "amber",
  UNAPPLIED: "amber", PARTIALLY_APPLIED: "blue", APPLIED: "green", REVERSED: "red",
  UNPAID: "amber", PARTIALLY_PAID: "blue",
  APPROVED: "green", PROPOSED: "blue", ARCHIVED: "slate",
  REPORTED: "amber", TRIAGED: "blue", AUTHORIZATION_REQUIRED: "amber",
  OFFERS_REQUESTED: "blue", CONTRACTOR_SELECTED: "blue", SCHEDULED: "blue",
  IN_PROGRESS: "blue", COMPLETED: "green", VERIFIED: "green", INVOICED: "amber", CLOSED: "slate",
  SCHEDULED_M: "blue", FINAL: "green",
  QUEUED: "amber", SENT: "blue", DELIVERED: "green", SEEN: "green", FAILED: "red",
  PENDING: "amber", SIGNED: "green", NONE: "slate",
};

/** Text label + colour, never colour alone. Rendered as a Material-style tonal chip. */
export function StatusBadge({ status, label }: { status: string; label: string }) {
  const tone = badgeTones[statusTone[status] ?? "slate"];
  return (
    <span className={`inline-block rounded-full px-2.5 py-0.5 text-[13px] font-medium ring-1 ring-inset ${tone}`}>
      {label}
    </span>
  );
}

/** A table column's behavior across breakpoints (Plans/ui-ux-redesign-plan.md §3.B).
 *  `priority` controls desktop/tablet progressive disclosure: "primary" is always a real table
 *  column; "secondary" only becomes one from `md`; "detail" only from `lg`. Below `md`, none of
 *  that matters — if the table has more than 5 columns (`useCardTransform` below, per P5) the
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
};

function isColumnSpecArray(headers: string[] | ColumnSpec[]): headers is ColumnSpec[] {
  return headers.length > 0 && typeof headers[0] === "object";
}

/** Escapes a string for safe use inside a generated CSS `content: "…"` value — the only
 *  untrusted-ish input here is a column label, and only quotes/backslashes can break out of it. */
function cssStringEscape(s: string): string {
  return s.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
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
function buildTableCss(id: string, columns: ColumnSpec[], useCardTransform: boolean): string {
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
    rules.push(`@media (max-width:767px) {
  #${id} thead { display:none; }
  #${id} tbody tr { display:block; border:1px solid #e2e8f0; border-radius:0.75rem; padding:0.75rem 1rem; margin-bottom:0.75rem; background:#fff; }
  #${id} tbody tr:last-child { margin-bottom:0; }
  #${id} tbody td { display:grid; grid-template-columns:40% 1fr; gap:0.5rem; align-items:baseline; padding:0.375rem 0; border:none !important; text-align:left !important; white-space:normal !important; }
  #${id} tbody td[colspan] { display:block; grid-template-columns:none; }
}`);
    columns.forEach((col, i) => {
      const n = i + 1;
      if (col.priority === "primary") {
        rules.push(`@media (max-width:767px){#${id} tbody td:nth-child(${n}){display:block;font-weight:600;font-size:0.9375rem;color:#0f172a;}}`);
      } else {
        rules.push(
          `@media (max-width:767px){#${id} tbody td:nth-child(${n}):not([colspan])::before{content:"${cssStringEscape(col.label)}";font-weight:500;font-size:0.8125rem;color:#64748b;}}`,
        );
      }
    });
  }

  return rules.join("\n");
}

export function Table({
  id, caption, headers, children, empty, emptyHint,
}: {
  /** Required when `headers` is `ColumnSpec[]` — it's the hook the generated `<style>` (above)
   *  is keyed to. A plain `string[]` table doesn't need one (no per-column behavior to generate). */
  id?: string;
  /** Screen-reader-only `<caption>` (WCAG A8) — falls back to the scroll-region's `aria-label`. */
  caption?: string;
  headers: string[] | ColumnSpec[];
  children: ReactNode;
  empty?: boolean;
  /** Shown under "Nema podataka." when `empty` — a concrete next step, not just the empty fact
   *  (P7). Left out on purpose is fine; every table works without it, this rolls out table by
   *  table (Faza 3f). */
  emptyHint?: ReactNode;
}) {
  const columns: ColumnSpec[] = isColumnSpecArray(headers) ? headers : headers.map((label) => ({ label }));
  const useCardTransform = columns.length > 5; // P5: only tables with >5 columns get the card fallback
  const css = id ? buildTableCss(id, columns, useCardTransform) : null;
  if (process.env.NODE_ENV !== "production" && isColumnSpecArray(headers) && !id) {
    // eslint-disable-next-line no-console
    console.warn("Table: `id` is required when `headers` is ColumnSpec[] (Plans/ui-ux-redesign-plan.md §3.B) — column alignment/priority/card-layout will not apply without it.");
  }
  return (
    // No own border/shadow: every caller already wraps this in a Card, which supplies that —
    // a border here too was a box-in-a-box (Plans/ui-ux-redesign-plan.md §3.5). tabIndex +
    // role + aria-label make horizontally-scrolled content reachable by keyboard, and the
    // inset shadow on the trailing edge is a static hint that there's more to scroll to (§4.2,
    // "A+" patch) — for tables still on `string[]` headers; ColumnSpec tables with >5 columns
    // don't need it below `md` since they stop scrolling and stack instead (§3.B).
    <div
      id={id}
      tabIndex={0}
      role="region"
      aria-label={caption ?? "Tabela — sadržaj se može horizontalno pomjerati na užim ekranima"}
      className="overflow-x-auto rounded-lg [box-shadow:inset_-10px_0_8px_-10px_rgba(15,23,42,0.18)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-1"
    >
      {css && <style dangerouslySetInnerHTML={{ __html: css }} />}
      <table className="w-full text-sm [&_tbody_tr:hover]:bg-slate-50/70">
        {caption && <caption className="sr-only">{caption}</caption>}
        <thead>
          <tr className="border-b border-slate-200 bg-slate-50/80 text-left">
            {columns.map((c, i) => (
              <th key={c.label + i} scope="col" className="px-3 py-2 text-xs font-semibold uppercase tracking-wider text-slate-500">
                {c.label}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {empty ? (
            <tr>
              <td colSpan={columns.length} className="px-3 py-8 text-center text-slate-500">
                <div>Nema podataka.</div>
                {emptyHint && <div className="mt-1 text-[13px]">{emptyHint}</div>}
              </td>
            </tr>
          ) : children}
        </tbody>
      </table>
    </div>
  );
}

export function Td({
  children, right, className,
}: { children: ReactNode; /** @deprecated pass `align: "right"` in the column's ColumnSpec instead — kept only until every table has migrated (Plans/ui-ux-redesign-plan.md §3.E) */ right?: boolean; className?: string }) {
  return <td className={`px-3 py-1.5 ${right ? "text-right tabular-nums" : ""} ${className ?? ""}`}>{children}</td>;
}

// Compact geometry for a "Radnje" column cell, distinct from btnBase (Plans/ui-ux-redesign-plan.md
// §3.C): 28px tall on desktop — still clears WCAG 2.2 AA's 24px minimum target size, trading the
// 44px AAA target Faza 0 aimed for in exchange for the row density a real user asked for — but
// max-md:min-h-[44px] keeps the full touch target below `md`, where the card transform (above)
// also gives the action a whole card-width row to sit in rather than a cramped cell.
const rowActionBase =
  "inline-flex items-center justify-center gap-1 rounded-full px-2.5 py-1 text-[13px] font-medium " +
  "min-h-[28px] max-md:min-h-[44px] transition-all active:scale-[0.97] focus-visible:outline-none " +
  "focus-visible:ring-2 focus-visible:ring-offset-1 disabled:cursor-not-allowed disabled:opacity-50";

/** A "Radnje" (actions) column cell — a verb, not an identity (see `RowLink` below). Defaults to
 *  `ghost` since most row actions are secondary to the row's own identity link. Forwards standard
 *  button props, so it works as a form submit (`type="submit"`) or a client-side toggle
 *  (`type="button" onClick={...}`) — both patterns exist across the app's row components. */
export function RowAction({
  children, variant, className, ...rest
}: { children: ReactNode; variant?: BtnVariant; className?: string } & ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button className={`${rowActionBase} ${btnVariantCls[variant ?? "ghost"]} ${className ?? ""}`} {...rest}>
      {children}
    </button>
  );
}

/** `RowAction`'s `<Link>` counterpart, for a row action that navigates instead of submitting
 *  (e.g. "preuzmi" linking to a document download). */
export function RowActionLink({
  href, children, variant, className,
}: { href: string; children: ReactNode; variant?: BtnVariant; className?: string }) {
  return (
    <Link href={href} className={`${rowActionBase} ${btnVariantCls[variant ?? "ghost"]} ${className ?? ""}`}>
      {children}
    </Link>
  );
}

/** A row's *identity* link (first column, usually — the invoice number, the person's name —
 *  whatever the row is "about"), as distinct from a `RowAction` verb in the "Radnje" column.
 *  Plain underlined text, not a pill: it needs to read as part of the row's data, not as a
 *  separate control competing with the real actions (Plans/ui-ux-redesign-plan.md §3.F). */
export function RowLink({ href, children, className }: { href: string; children: ReactNode; className?: string }) {
  return (
    <Link
      href={href}
      className={`rounded font-medium text-primary-ink underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-1 ${className ?? ""}`}
    >
      {children}
    </Link>
  );
}

// py-2.5 + a 44px floor below md keeps every button a real touch target (WCAG 2.5.5) —
// the old py-1.5 measured ~30px tall (Plans/ui-ux-redesign-plan.md §3.7, A2).
export const btnBase =
  "inline-flex items-center justify-center gap-1.5 rounded-full px-4 py-2.5 text-sm font-medium " +
  "max-md:min-h-[44px] transition-all active:scale-[0.97] focus-visible:outline-none focus-visible:ring-2 " +
  "focus-visible:ring-offset-1 disabled:cursor-not-allowed disabled:opacity-50";

// Five weights of loudness, not three (Plans/ui-ux-redesign-plan.md §3.6): a page author who
// wants "this is serious" no longer has only `danger` — full red bg-red-600 — to reach for.
// `caution` takes over most of what used to be `danger`; the plain-red `danger` weight is now
// reserved for irreversible destruction or undoing money/rights, and always behind a confirm
// step (Faza 2). `tonal` is the new default for supporting actions inside a card ("Sačuvaj",
// "Dodaj stavku") — the single biggest source of calming the page down. `ghost` is for
// row-level text actions in tables, replacing bare `<button className="text-xs ...">` calls
// that had no real tap target.
export const btnVariantCls: Record<string, string> = {
  primary: "bg-blue-600 text-white shadow-sm hover:bg-blue-700 hover:shadow focus-visible:ring-blue-500",
  tonal: "bg-blue-50 text-blue-700 hover:bg-blue-100 focus-visible:ring-blue-500",
  secondary: "border border-slate-300 bg-white text-slate-700 hover:bg-slate-50 focus-visible:ring-slate-400",
  ghost: "text-slate-600 hover:bg-slate-100 focus-visible:ring-slate-400",
  caution: "border border-amber-600/40 bg-amber-50 text-amber-900 hover:bg-amber-100 focus-visible:ring-amber-500",
  danger: "bg-red-600 text-white shadow-sm hover:bg-red-700 hover:shadow focus-visible:ring-red-500",
};

type BtnVariant = "primary" | "tonal" | "secondary" | "ghost" | "caution" | "danger";

export function BtnLink({ href, children, variant }: { href: string; children: ReactNode; variant?: BtnVariant }) {
  return (
    <Link href={href} className={`${btnBase} ${btnVariantCls[variant ?? "secondary"]}`}>
      {children}
    </Link>
  );
}

export function SubmitBtn({ children, variant, name, value }: { children: ReactNode; variant?: BtnVariant; name?: string; value?: string }) {
  return (
    <button type="submit" name={name} value={value} className={`${btnBase} ${btnVariantCls[variant ?? "primary"]}`}>
      {children}
    </button>
  );
}

/** Full-size, client-safe generic button — same chrome as `SubmitBtn`/`BtnLink` but usable with
 *  `onClick`/`type="button"` from inside a `"use client"` row component (e.g. a "Zatvori"/"Otkaži"
 *  toggle that closes an inline edit panel without a page reload). Exists so those components stop
 *  hand-copying `btnBase`'s classes — three of them did, and drifted out of sync with Faza 0's
 *  touch-target fix in the process (Plans/ui-ux-redesign-plan.md §3.F). For a *row-level* action use
 *  `RowAction` instead — this one keeps the full 40px/44px geometry `btnBase` already has. */
export function Btn({
  children, variant, className, ...rest
}: { children: ReactNode; variant?: BtnVariant; className?: string } & ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button className={`${btnBase} ${btnVariantCls[variant ?? "secondary"]} ${className ?? ""}`} {...rest}>
      {children}
    </button>
  );
}

/** `<summary>` for a `<details>`-based inline "reveal a form" section (add a row, upload a
 *  document, etc.) — same pill chrome as SubmitBtn/BtnLink so it reads as a real button,
 *  with a chevron that rotates 90° open (same rotating-chevron idiom already used for the
 *  sidebar collapse toggle in nav-shell.tsx) instead of the browser's own disclosure
 *  triangle — clearer "this expands" affordance than a plain link ever gave it. No JS:
 *  `<details>/<summary>` still does the actual show/hide. Wrap the section as
 *  `<details className="group">...<ToggleBtn>Label</ToggleBtn>...form...</details>` — the
 *  `group` class is what lets the chevron rotate via `group-open:` when the parent opens. */
export function ToggleBtn({ children, variant }: { children: ReactNode; variant?: BtnVariant }) {
  return (
    <summary
      className={`${btnBase} ${btnVariantCls[variant ?? "secondary"]} cursor-pointer select-none list-none [&::-webkit-details-marker]:hidden`}
    >
      <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" className="h-3.5 w-3.5 shrink-0 transition-transform duration-150 group-open:rotate-90">
        <path d="M7 5l6 5-6 5" />
      </svg>
      {children}
    </summary>
  );
}

/** Confirmation step for an irreversible or high-consequence server action, without a single
 *  line of client JS (Plans/ui-ux-redesign-plan.md §3.8) — same `<details>`/`ToggleBtn` reveal
 *  idiom as the rest of the app, but with confirmation semantics: a `title` + `body` the user
 *  must read (e.g. a quorum/tally summary, right where the decision is made — not in another
 *  card the user has to scroll to find), then a separately-styled `confirmLabel` button that
 *  actually submits `action`. `hiddenFields` covers the common case (just an id to pass
 *  through); `children` renders extra visible fields (a reason, a type-to-confirm input) between
 *  the body and the confirm button. */
export function ConfirmAction({
  trigger,
  triggerVariant,
  title,
  body,
  confirmLabel,
  confirmVariant,
  action,
  hiddenFields,
  children,
}: {
  trigger: ReactNode;
  triggerVariant?: BtnVariant;
  title: string;
  body?: ReactNode;
  confirmLabel: string;
  confirmVariant?: BtnVariant;
  action: (formData: FormData) => void | Promise<void>;
  hiddenFields?: Record<string, string>;
  children?: ReactNode;
}) {
  return (
    <details className="group">
      <ToggleBtn variant={triggerVariant ?? "caution"}>{trigger}</ToggleBtn>
      <form action={action} className="mt-2 space-y-3 rounded-lg border border-amber-600/40 bg-amber-50/70 p-3">
        <p className="text-sm font-semibold text-amber-900">{title}</p>
        {body}
        {hiddenFields &&
          Object.entries(hiddenFields).map(([name, value]) => <input key={name} type="hidden" name={name} value={value} />)}
        {children}
        <SubmitBtn variant={confirmVariant ?? "caution"}>{confirmLabel}</SubmitBtn>
      </form>
    </details>
  );
}

/** Prev/next + "page N of M" for a server-rendered, offset-paginated list (Plans/
 *  user-activity-log-plan.md §5) — `hrefFor(page)` builds the full URL for that page,
 *  including whatever filters the caller already has selected. Renders nothing for a
 *  single-page result, so callers don't need their own `pageCount > 1` check. */
export function Pagination({ page, pageCount, hrefFor }: { page: number; pageCount: number; hrefFor: (page: number) => string }) {
  if (pageCount <= 1) return null;
  const atStart = page <= 1;
  const atEnd = page >= pageCount;
  return (
    <nav aria-label="Stranice" className="mt-3 flex items-center justify-center gap-3 text-sm">
      <Link
        href={hrefFor(Math.max(1, page - 1))}
        aria-disabled={atStart}
        tabIndex={atStart ? -1 : undefined}
        className={`${btnBase} ${btnVariantCls.secondary} ${atStart ? "pointer-events-none opacity-50" : ""}`}
      >
        ‹ Prethodna
      </Link>
      <span className="text-slate-500">
        Stranica {page} od {pageCount}
      </span>
      <Link
        href={hrefFor(Math.min(pageCount, page + 1))}
        aria-disabled={atEnd}
        tabIndex={atEnd ? -1 : undefined}
        className={`${btnBase} ${btnVariantCls.secondary} ${atEnd ? "pointer-events-none opacity-50" : ""}`}
      >
        Sljedeća ›
      </Link>
    </nav>
  );
}

/** Server-rendered switcher between several equal-weight, independent page sections — never for
 *  a single linear process or one object's detail (the definitive per-page list is Plans/
 *  ui-ux-redesign-plan.md §3.D). Plain `<Link>`s to `hrefFor(key)`, not ARIA tabs: a real
 *  `role="tab"` promises left/right arrow-key navigation between tabs, which these don't have, so
 *  faking that role would be a worse a11y story than not having one. `hrefFor` (not an internal
 *  URL builder) mirrors `Pagination` below — the caller knows what other query params (`?err=`,
 *  a future `?sort=`) need to survive the tab switch, `Tabs` doesn't. `scroll={false}` keeps the
 *  page where it is instead of jumping to the top on every click. */
export function Tabs({
  tabs, active, hrefFor,
}: { tabs: { key: string; label: string; count?: number }[]; active: string; hrefFor: (key: string) => string }) {
  return (
    <nav aria-label="Sekcije" className="mb-4 flex gap-1 overflow-x-auto border-b border-slate-200">
      {tabs.map((tab) => {
        const isActive = tab.key === active;
        return (
          <Link
            key={tab.key}
            href={hrefFor(tab.key)}
            scroll={false}
            aria-current={isActive ? "page" : undefined}
            className={`flex min-h-[44px] shrink-0 items-center whitespace-nowrap border-b-2 px-3 py-2.5 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-1 ${
              isActive
                ? "border-primary text-primary-ink"
                : "border-transparent text-slate-500 hover:border-slate-300 hover:text-slate-700"
            }`}
          >
            {tab.label}
            {tab.count !== undefined && <span className="ml-1.5 text-xs text-slate-400">· {tab.count}</span>}
          </Link>
        );
      })}
    </nav>
  );
}

export function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) {
  return (
    <label className="block text-sm">
      <span className="mb-1 block font-medium text-slate-700">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-[13px] text-slate-500">{hint}</span>}
    </label>
  );
}

export const inputCls =
  "w-full rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm shadow-sm transition-shadow " +
  "focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20";

const flashIcon = (err?: boolean) => (
  <svg viewBox="0 0 20 20" fill="currentColor" className="mt-0.5 h-4 w-4 shrink-0">
    {err ? (
      <path
        fillRule="evenodd"
        d="M8.485 2.495c.673-1.167 2.357-1.167 3.03 0l6.28 10.875c.673 1.167-.169 2.63-1.516 2.63H3.72c-1.347 0-2.189-1.463-1.515-2.63L8.485 2.495ZM10 6a.75.75 0 0 1 .75.75v3.5a.75.75 0 0 1-1.5 0v-3.5A.75.75 0 0 1 10 6Zm0 8a1 1 0 1 0 0-2 1 1 0 0 0 0 2Z"
        clipRule="evenodd"
      />
    ) : (
      <path
        fillRule="evenodd"
        d="M10 18a8 8 0 1 0 0-16 8 8 0 0 0 0 16Zm3.857-9.809a.75.75 0 0 0-1.214-.882l-3.483 4.79-1.88-1.88a.75.75 0 1 0-1.06 1.061l2.5 2.5a.75.75 0 0 0 1.137-.089l4-5.5Z"
        clipRule="evenodd"
      />
    )}
  </svg>
);

export function Flash({ msg, err }: { msg?: string; err?: string }) {
  if (!msg && !err) return null;
  return (
    <div
      role={err ? "alert" : "status"}
      className={`mb-4 flex items-start gap-2 rounded-xl border-l-4 px-3 py-2.5 text-sm shadow-sm ${
        err ? "border-l-red-500 bg-red-50 text-red-800" : "border-l-emerald-500 bg-emerald-50 text-emerald-800"
      }`}
    >
      {flashIcon(Boolean(err))}
      <span>{err ?? msg}</span>
    </div>
  );
}
