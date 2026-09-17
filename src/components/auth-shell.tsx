// Shared chrome for the public/unauthenticated screens — /login, /zaboravljena-lozinka,
// /reset-lozinka/[token] and (via AuthBrandHeader alone) /glasanje/[token]. These are the
// screens with the least-practiced users and the highest legal stakes (Plans/
// ui-ux-redesign-plan.md §6): a link opened once, from an e-mail, with no prior context.
// Before this, all three auth pages hand-copied the same `max-w-sm rounded-lg border ...`
// markup with no logo — for a link arriving by e-mail, "is this even the real app?" is a
// legitimate first question, and bare text answers it worse than a logo does.
import Image from "next/image";
import type { ReactNode } from "react";
import { t } from "@/lib/i18n";

export function AuthBrandHeader() {
  return (
    <div className="flex flex-col items-center gap-1.5 text-center">
      <Image src="/logo-mark.png" alt="" width={40} height={53} className="h-11 w-auto" priority />
      <div>
        <div className="text-lg font-bold tracking-tight text-blue-700">{t("app.name")}</div>
        <p className="text-sm text-slate-500">{t("app.tagline")}</p>
      </div>
    </div>
  );
}

export function AuthShell({
  pageTitle, children, footnote,
}: { pageTitle: string; children: ReactNode; footnote?: ReactNode }) {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-6 p-4">
      <AuthBrandHeader />
      <div className="w-full max-w-sm rounded-xl border border-slate-200/80 bg-white p-6 shadow-sm">
        <h1 className="mb-4 text-base font-semibold text-slate-900">{pageTitle}</h1>
        {children}
      </div>
      {footnote && <p className="max-w-sm text-center text-xs text-slate-500">{footnote}</p>}
    </main>
  );
}
