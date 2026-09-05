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
        {subtitle && <p className="mt-1 text-sm text-slate-500">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export function Card({ title, children, className }: { title?: string; children: ReactNode; className?: string }) {
  return (
    <section className={`rounded-xl border border-slate-200/80 bg-white p-5 shadow-sm ${className ?? ""}`}>
      {title && <h2 className="mb-3 text-xs font-semibold uppercase tracking-wider text-slate-500">{title}</h2>}
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
    <span className={`inline-block rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ring-inset ${tone}`}>
      {label}
    </span>
  );
}

export function Table({ headers, children, empty }: { headers: string[]; children: ReactNode; empty?: boolean }) {
  return (
    <div className="overflow-x-auto rounded-xl border border-slate-200/80 bg-white shadow-sm">
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
            <tr><td colSpan={headers.length} className="px-4 py-8 text-center text-slate-400">Nema podataka.</td></tr>
          ) : children}
        </tbody>
      </table>
    </div>
  );
}

export function Td({ children, right, className }: { children: ReactNode; right?: boolean; className?: string }) {
  return <td className={`px-4 py-2.5 ${right ? "text-right tabular-nums" : ""} ${className ?? ""}`}>{children}</td>;
}

const btnBase =
  "inline-flex items-center justify-center gap-1.5 rounded-full px-4 py-1.5 text-sm font-medium " +
  "transition-all active:scale-[0.97] focus-visible:outline-none focus-visible:ring-2 " +
  "focus-visible:ring-offset-1 disabled:cursor-not-allowed disabled:opacity-50";

const btnVariantCls: Record<string, string> = {
  primary: "bg-blue-600 text-white shadow-sm hover:bg-blue-700 hover:shadow focus-visible:ring-blue-500",
  secondary: "border border-slate-300 bg-white text-slate-700 hover:bg-slate-50 focus-visible:ring-slate-400",
  danger: "bg-red-600 text-white shadow-sm hover:bg-red-700 hover:shadow focus-visible:ring-red-500",
};

export function BtnLink({ href, children, variant }: { href: string; children: ReactNode; variant?: "primary" | "secondary" }) {
  return (
    <Link href={href} className={`${btnBase} ${btnVariantCls[variant ?? "secondary"]}`}>
      {children}
    </Link>
  );
}

export function SubmitBtn({ children, variant, name, value }: { children: ReactNode; variant?: "primary" | "danger" | "secondary"; name?: string; value?: string }) {
  return (
    <button type="submit" name={name} value={value} className={`${btnBase} ${btnVariantCls[variant ?? "primary"]}`}>
      {children}
    </button>
  );
}

export function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) {
  return (
    <label className="block text-sm">
      <span className="mb-1 block font-medium text-slate-700">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-xs text-slate-400">{hint}</span>}
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
      role="status"
      className={`mb-4 flex items-start gap-2 rounded-xl border-l-4 px-3 py-2.5 text-sm shadow-sm ${
        err ? "border-l-red-500 bg-red-50 text-red-800" : "border-l-emerald-500 bg-emerald-50 text-emerald-800"
      }`}
    >
      {flashIcon(Boolean(err))}
      <span>{err ?? msg}</span>
    </div>
  );
}
