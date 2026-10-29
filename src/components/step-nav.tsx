// StepNav — navigacija kroz čarobnjak (Plans/design-system.md §4.3, odobreno 2026-10-29, mockupi
// O-M02–O-M04). Za razliku od StatusTimeline-a, završeni koraci SU veze (povratak na korak); tekući
// nosi aria-current="step"; koraci iza trenutnog nisu veze, jer ih server ionako odbija. Bez client
// JS-a: na telefonu je <details> sa jednim redom „Korak N od M · naziv”.
import Link from "next/link";
import { t, tf } from "@/lib/i18n";

export type StepNavItem = {
  number: number;
  label: string;
  /** null = korak se još ne može otvoriti. */
  href: string | null;
  complete: boolean;
  viewing: boolean;
  optional?: boolean;
  readOnly?: boolean;
};

function CheckIcon() {
  return (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" className="h-3.5 w-3.5" aria-hidden="true">
      <path d="M5 10.5 8.5 14 15 7" />
    </svg>
  );
}

function LockIcon() {
  return (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4" aria-hidden="true">
      <rect x="5" y="9" width="10" height="7.5" rx="1.2" />
      <path d="M7.5 9V7a2.5 2.5 0 0 1 5 0v2" />
    </svg>
  );
}

function ChevronIcon() {
  return (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4 transition-transform group-open:rotate-180" aria-hidden="true">
      <path d="m6 8 4 4 4-4" />
    </svg>
  );
}

function StepList({ items }: { items: StepNavItem[] }) {
  return (
    <ol className="space-y-0.5">
      {items.map((s) => {
        const extras = (
          <>
            {s.optional && <span className="ml-auto text-[13px] font-normal text-slate-500">{t("onboarding.optional")}</span>}
            {s.readOnly && (
              <span className="ml-auto text-slate-500" title={t("onboarding.readOnly")}>
                <LockIcon />
                <span className="sr-only">{t("onboarding.readOnly")}</span>
              </span>
            )}
          </>
        );
        if (s.viewing) {
          return (
            <li key={s.number}>
              <span aria-current="step" className="flex items-center gap-3 rounded-full bg-primary-soft px-3 py-2 text-sm font-semibold text-primary-ink">
                <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full border-2 border-primary text-[13px] font-semibold">{s.number}</span>
                {s.label}
                {extras}
              </span>
            </li>
          );
        }
        if (s.href) {
          return (
            <li key={s.number}>
              <Link href={s.href} className="flex min-h-[44px] items-center gap-3 rounded-full px-3 py-2 text-sm text-slate-700 hover:bg-slate-100 md:min-h-0">
                {s.complete ? (
                  <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary text-white"><CheckIcon /></span>
                ) : (
                  <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full border-2 border-primary text-[13px] font-semibold text-primary-ink">{s.number}</span>
                )}
                {s.complete && <span className="sr-only">{t("onboarding.doneSr")}</span>}
                {s.label}
                {extras}
              </Link>
            </li>
          );
        }
        return (
          <li key={s.number}>
            <span className="flex items-center gap-3 px-3 py-2 text-sm text-slate-500">
              <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-slate-300 text-[13px]">{s.number}</span>
              <span className="sr-only">{t("onboarding.lockedSr")}</span>
              {s.label}
              {extras}
            </span>
          </li>
        );
      })}
    </ol>
  );
}

export function StepNav({ title, items }: { title: string; items: StepNavItem[] }) {
  const viewing = items.find((s) => s.viewing) ?? items[0];
  const stepOf = tf("onboarding.stepOf", { broj: viewing.number, ukupno: items.length });
  return (
    <nav aria-label={t("onboarding.stepNavLabel")}>
      <div className="hidden md:block">
        <div className="px-3 pb-3">
          <p className="text-sm font-semibold text-slate-800">{title}</p>
          <p className="text-[13px] text-slate-500">{stepOf}</p>
        </div>
        <StepList items={items} />
      </div>
      <details className="group rounded-xl border border-slate-200 bg-white md:hidden">
        <summary className="flex min-h-[44px] cursor-pointer list-none items-center gap-2 px-4 py-2 text-sm text-slate-700 [&::-webkit-details-marker]:hidden">
          <span>
            {stepOf} · <b className="font-semibold text-slate-900">{viewing.label}</b>
          </span>
          <span className="ml-auto inline-flex items-center gap-1 text-[13px] font-medium text-primary-ink">
            {t("onboarding.allSteps")}
            <ChevronIcon />
          </span>
        </summary>
        <div className="border-t border-slate-200 p-2">
          <StepList items={items} />
        </div>
      </details>
    </nav>
  );
}
