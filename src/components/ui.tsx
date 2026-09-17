// Small shared UI primitives (server-component friendly, accessible).
// Styling follows Material Design cues — soft elevation, generous rounding,
// pill-shaped chips/buttons, outlined inputs — built entirely with Tailwind
// utilities so every page (which composes these primitives) picks up the
// look at once.
import Link from "next/link";
import type { ReactNode } from "react";

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

export function Card({ title, children, className }: { title?: string; children: ReactNode; className?: string }) {
  return (
    <section className={`rounded-xl border border-slate-200/80 bg-white p-5 shadow-sm ${className ?? ""}`}>
      {title && <h2 className="mb-3 text-sm font-semibold text-slate-700">{title}</h2>}
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

export function Table({ headers, children, empty }: { headers: string[]; children: ReactNode; empty?: boolean }) {
  return (
    // No own border/shadow: every caller already wraps this in a Card, which supplies that —
    // a border here too was a box-in-a-box (Plans/ui-ux-redesign-plan.md §3.5). tabIndex +
    // role + aria-label make horizontally-scrolled content reachable by keyboard, and the
    // inset shadow on the trailing edge is a static hint that there's more to scroll to
    // (§4.2, "A+" patch) — cheap now; Faza 3 replaces overflow-x-auto with a real responsive
    // table for the worst offenders.
    <div
      tabIndex={0}
      role="region"
      aria-label="Tabela — sadržaj se može horizontalno pomjerati na užim ekranima"
      className="overflow-x-auto rounded-lg [box-shadow:inset_-10px_0_8px_-10px_rgba(15,23,42,0.18)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-1"
    >
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-slate-200 bg-slate-50/80 text-left">
            {headers.map((h) => (
              <th key={h} className="px-4 py-2.5 text-xs font-semibold uppercase tracking-wider text-slate-500">{h}</th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {empty ? (
            <tr><td colSpan={headers.length} className="px-4 py-8 text-center text-slate-500">Nema podataka.</td></tr>
          ) : children}
        </tbody>
      </table>
    </div>
  );
}

export function Td({ children, right, className }: { children: ReactNode; right?: boolean; className?: string }) {
  return <td className={`px-4 py-2.5 ${right ? "text-right tabular-nums" : ""} ${className ?? ""}`}>{children}</td>;
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
