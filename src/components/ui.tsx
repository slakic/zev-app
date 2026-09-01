// Small shared UI primitives (server-component friendly, accessible).
import Link from "next/link";
import type { ReactNode } from "react";

export function PageHeader({
  title, subtitle, actions, backHref, backLabel,
}: { title: string; subtitle?: string; actions?: ReactNode; backHref?: string; backLabel?: string }) {
  return (
    <div className="mb-6 flex flex-wrap items-start justify-between gap-3">
      <div>
        {backHref && (
          <Link href={backHref} className="mb-1 inline-block text-sm text-blue-700 hover:underline">
            ‹ {backLabel ?? "Nazad"}
          </Link>
        )}
        <h1 className="text-2xl font-semibold text-slate-900">{title}</h1>
        {subtitle && <p className="mt-1 text-sm text-slate-500">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export function Card({ title, children, className }: { title?: string; children: ReactNode; className?: string }) {
  return (
    <section className={`rounded-lg border border-slate-200 bg-white p-4 shadow-sm ${className ?? ""}`}>
      {title && <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-500">{title}</h2>}
      {children}
    </section>
  );
}

export function Stat({ label, value, tone }: { label: string; value: string; tone?: "ok" | "warn" | "bad" | "neutral" }) {
  const toneCls =
    tone === "ok" ? "text-emerald-700" : tone === "warn" ? "text-amber-700" : tone === "bad" ? "text-red-700" : "text-slate-900";
  return (
    <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
      <div className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</div>
      <div className={`mt-1 text-xl font-semibold tabular-nums ${toneCls}`}>{value}</div>
    </div>
  );
}

const badgeTones: Record<string, string> = {
  green: "bg-emerald-50 text-emerald-800 border-emerald-200",
  red: "bg-red-50 text-red-800 border-red-200",
  amber: "bg-amber-50 text-amber-800 border-amber-200",
  blue: "bg-blue-50 text-blue-800 border-blue-200",
  slate: "bg-slate-100 text-slate-700 border-slate-200",
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
};

/** Text label + colour, never colour alone. */
export function StatusBadge({ status, label }: { status: string; label: string }) {
  const tone = badgeTones[statusTone[status] ?? "slate"];
  return (
    <span className={`inline-block rounded border px-2 py-0.5 text-xs font-medium ${tone}`}>
      {label}
    </span>
  );
}

export function Table({ headers, children, empty }: { headers: string[]; children: ReactNode; empty?: boolean }) {
  return (
    <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white shadow-sm">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-slate-200 bg-slate-50 text-left">
            {headers.map((h) => (
              <th key={h} className="px-3 py-2 font-medium text-slate-600">{h}</th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {empty ? (
            <tr><td colSpan={headers.length} className="px-3 py-6 text-center text-slate-400">Nema podataka.</td></tr>
          ) : children}
        </tbody>
      </table>
    </div>
  );
}

export function Td({ children, right, className }: { children: ReactNode; right?: boolean; className?: string }) {
  return <td className={`px-3 py-2 ${right ? "text-right tabular-nums" : ""} ${className ?? ""}`}>{children}</td>;
}

export function BtnLink({ href, children, variant }: { href: string; children: ReactNode; variant?: "primary" | "secondary" }) {
  const cls =
    variant === "primary"
      ? "bg-blue-600 text-white hover:bg-blue-700 border-transparent"
      : "bg-white text-slate-700 hover:bg-slate-50 border-slate-300";
  return (
    <Link href={href} className={`inline-block rounded-md border px-3 py-1.5 text-sm font-medium shadow-sm ${cls}`}>
      {children}
    </Link>
  );
}

export function SubmitBtn({ children, variant, name, value }: { children: ReactNode; variant?: "primary" | "danger" | "secondary"; name?: string; value?: string }) {
  const cls =
    variant === "danger"
      ? "bg-red-600 text-white hover:bg-red-700 border-transparent"
      : variant === "secondary"
        ? "bg-white text-slate-700 hover:bg-slate-50 border-slate-300"
        : "bg-blue-600 text-white hover:bg-blue-700 border-transparent";
  return (
    <button type="submit" name={name} value={value} className={`rounded-md border px-3 py-1.5 text-sm font-medium shadow-sm ${cls}`}>
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
  "w-full rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm shadow-sm focus:border-blue-500 focus:outline-none";

export function Flash({ msg, err }: { msg?: string; err?: string }) {
  if (!msg && !err) return null;
  return (
    <div
      role="status"
      className={`mb-4 rounded-md border px-3 py-2 text-sm ${
        err ? "border-red-200 bg-red-50 text-red-800" : "border-emerald-200 bg-emerald-50 text-emerald-800"
      }`}
    >
      {err ?? msg}
    </div>
  );
}
