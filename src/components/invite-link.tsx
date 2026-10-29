"use client";
// Jednokratni prikaz pozivnog linka (Plans/zev-onboarding-wizard-plan.md §3.1, mockup O-M01 ③):
// polje samo za čitanje + „Kopiraj link". Link postoji samo u ovom odgovoru servera — ne čuva se
// i ne ide u adresu stranice. `inset` za prikaz unutar reda tabele (bez sopstvene kartice).
import { useState } from "react";
import { Btn, Card, inputCls } from "@/components/ui";
import { t, tf } from "@/lib/i18n";

export function InviteLink({ link, email, inset }: { link: string; email: string; inset?: boolean }) {
  const [copied, setCopied] = useState(false);
  async function copy() {
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Bez Clipboard API-ja (nesiguran kontekst) link se i dalje može označiti i kopirati ručno.
    }
  }
  const body = (
    <>
      <p className="max-w-[68ch] text-sm text-slate-700">{t("onboarding.newPage.linkBody")}</p>
      <div className="mt-4 flex max-w-3xl flex-wrap items-center gap-2">
        <label className="min-w-0 flex-1">
          <span className="sr-only">{t("onboarding.newPage.linkTitle")}</span>
          <input readOnly value={link} onFocus={(e) => e.currentTarget.select()} className={`${inputCls} bg-slate-50 font-mono text-[13px]`} />
        </label>
        <Btn type="button" variant="tonal" onClick={copy}>{t("onboarding.newPage.copy")}</Btn>
        <span aria-live="polite" className="text-[13px] text-slate-600">{copied ? t("onboarding.newPage.copied") : ""}</span>
      </div>
      <p className="mt-3 text-[13px] text-slate-500">{tf("onboarding.newPage.linkWarning", { email })}</p>
    </>
  );
  if (inset) {
    return (
      <div>
        <p className="mb-1 text-sm font-semibold text-slate-700">{t("onboarding.newPage.linkTitle")}</p>
        {body}
      </div>
    );
  }
  return <Card title={t("onboarding.newPage.linkTitle")}>{body}</Card>;
}
