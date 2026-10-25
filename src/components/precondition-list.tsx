// ✓/⚠ list of preconditions for the next step ("Sljedeći korak", design-review D2, option A: a
// composition of existing pieces, not a new primitive) — used by the unit register (establish), the
// "Vlasništvo" tab (register for review) and the voting-open panels. Status is never colour alone:
// every row carries a screen-reader label next to the icon. Plans/fr-registar-i-glasanje-po-etaznim-
// vlasnicima-plan.md §4.1, mockup X-M04.
import type { ReactNode } from "react";
import { t } from "@/lib/i18n";

export function PreconditionList({ items }: { items: { ok: boolean; text: ReactNode }[] }) {
  return (
    <ul className="space-y-2">
      {items.map((it, i) => (
        <li key={i} className="flex items-start gap-2 text-sm text-slate-700">
          {it.ok ? (
            <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-emerald-50 text-emerald-800 ring-1 ring-inset ring-emerald-600/20">
              <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className="h-3.5 w-3.5" aria-hidden="true">
                <path d="M5 10.5 8.5 14 15 7" />
              </svg>
            </span>
          ) : (
            <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-amber-50 text-[13px] font-semibold text-amber-800 ring-1 ring-inset ring-amber-600/20" aria-hidden="true">!</span>
          )}
          <span className="sr-only">{it.ok ? t("register.ui.okLabel") : t("register.ui.warnLabel")}</span>
          <span>{it.text}</span>
        </li>
      ))}
    </ul>
  );
}
