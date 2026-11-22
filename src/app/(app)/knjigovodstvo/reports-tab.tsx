// Tab „Izvještaji” (B3a, Plans/kontni-plan-b3-izvjestaji-plan.md §2.2, B3-Q2 (a)): spisak izvještaja iz knjige;
// svaki izvještaj je podstranica /knjigovodstvo/izvjestaji/<izvještaj>.
import { t } from "@/lib/i18n";
import { BtnLink, Card, RowLink } from "@/components/ui";

const REPORTS = [
  { href: "/knjigovodstvo/izvjestaji/dnevnik", key: "journal" },
  { href: "/knjigovodstvo/izvjestaji/bruto-bilans", key: "trial" },
  { href: "/knjigovodstvo/izvjestaji/kartica", key: "card" },
  { href: "/knjigovodstvo/izvjestaji/vlasnik", key: "owners" },
  { href: "/knjigovodstvo/izvjestaji/dobavljac", key: "suppliers" },
  { href: "/knjigovodstvo/izvjestaji/namjene", key: "purposes" },
  { href: "/knjigovodstvo/izvjestaji/projekti", key: "projects" },
  { href: "/knjigovodstvo/izvjestaji/storna", key: "reversals" },
] as const;

export function ReportsTab() {
  return (
    <div className="space-y-6">
      <p className="max-w-[68ch] text-sm text-slate-600">{t("ledger.reports.intro")}</p>
      <Card title={t("ledger.reports.list.title")}>
        <ul className="divide-y divide-slate-100">
          {REPORTS.map((r) => (
            <li key={r.key} className="py-3 first:pt-0">
              <RowLink href={r.href}>{t(`ledger.reports.list.${r.key}.title`)}</RowLink>
              <p className="mt-0.5 max-w-[68ch] text-sm text-slate-600">{t(`ledger.reports.list.${r.key}.text`)}</p>
            </li>
          ))}
        </ul>
        <div className="mt-4 flex flex-wrap items-center gap-3 border-t border-slate-100 pt-4">
          <p className="text-sm text-slate-600">{t("ledger.reports.list.ledgerCsv")}</p>
          <BtnLink href="/api/knjigovodstvo/izvjestaji/csv?type=glavna-knjiga" variant="secondary">{t("ledger.reports.list.ledgerCsvLink")}</BtnLink>
        </div>
      </Card>
    </div>
  );
}
