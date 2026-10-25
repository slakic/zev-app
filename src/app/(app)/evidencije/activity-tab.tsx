import Link from "next/link";
import type { Actor } from "@/server/auth/guards";
import { listActivity, listActivityActors } from "@/server/services/activity";
import { ACTIVITY_CATEGORIES, DEFAULT_ACTIVITY_CATEGORIES, categoryForAction, categoryLabel, labelForAction, summarize, type ActivityCategory } from "@/lib/activity/catalog";
import { isIsoDate, recordsHref } from "@/lib/records";
import { endOfDay, formatDateTime, parseZonedDateTime, t } from "@/lib/i18n";
import { Card, Table, Td, Pagination, inputCls, FilterBar, type ColumnSpec } from "@/components/ui";

const headers: ColumnSpec[] = [
  // F8.1, opcija C: glavna kolona (šta je urađeno) je prva; kategorija se izvodi iz opisa pa se ispod `md` krije.
  { label: t("records.activity.activity"), priority: "primary" },
  { label: t("records.activity.when"), nowrap: true },
  { label: t("records.activity.who") },
  { label: t("records.activity.category"), priority: "secondary" },
];

function daysAgoIso(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString().slice(0, 10);
}

export type ActivitySearch = { from?: string; to?: string; kat?: string | string[]; akter?: string; str?: string };

/**
 * Curated, PRESIDENT-only activity feed (Plans/user-activity-log-plan.md §3, §5) — a plain
 * chronological feed with an `akter` filter, not a per-owner page: user decision P3 dropped
 * the originally-proposed per-owner card in favor of exactly this. Distinct from the audit-trail
 * tab (PRESIDENT+ACCOUNTANT, every action, before/after payload) — this answers "what's been
 * happening" for a president, not "show me the forensic trail". Moved here from /aktivnosti in F7.
 */
export async function ActivityTab({ actor, sp }: { actor: Actor; sp: ActivitySearch }) {
  const from = isIsoDate(sp.from) ? sp.from : daysAgoIso(30);
  const to = isIsoDate(sp.to) ? sp.to : new Date().toISOString().slice(0, 10);
  const requestedCategories = sp.kat
    ? (Array.isArray(sp.kat) ? sp.kat : [sp.kat]).filter((c): c is ActivityCategory =>
        (ACTIVITY_CATEGORIES as readonly string[]).includes(c)
      )
    : DEFAULT_ACTIVITY_CATEGORIES;
  const categories = requestedCategories.length > 0 ? requestedCategories : DEFAULT_ACTIVITY_CATEGORIES;
  const page = Math.max(1, Number(sp.str) || 1);

  const [actors, result] = await Promise.all([
    listActivityActors(actor),
    listActivity(actor, {
      from: parseZonedDateTime(`${from}T00:00`) ?? undefined,
      to: endOfDay(to),
      categories,
      actorUserId: sp.akter || undefined,
      page,
    }),
  ]);
  const actorLabelById = new Map(actors.map((a) => [a.id, a.label]));

  return (
    <>
      <FilterBar>
        <input type="hidden" name="tab" value="aktivnosti" />
        <label className="text-sm">
          {t("records.activity.from")}{" "}
          <input type="date" name="from" defaultValue={from} className={`${inputCls} ml-1 w-36`} />
        </label>
        <label className="text-sm">
          {t("records.activity.to")}{" "}
          <input type="date" name="to" defaultValue={to} className={`${inputCls} ml-1 w-36`} />
        </label>
        <fieldset>
          <legend className="mb-1 text-[13px] font-medium text-slate-500">{t("records.activity.category")}</legend>
          <div className="flex flex-wrap gap-3">
            {ACTIVITY_CATEGORIES.map((c) => (
              <label key={c} className="inline-flex items-center gap-1.5 text-sm">
                <input type="checkbox" name="kat" value={c} defaultChecked={categories.includes(c)} />
                {categoryLabel(c)}
              </label>
            ))}
          </div>
        </fieldset>
        <label className="text-sm">
          {t("records.activity.who")}{" "}
          <select name="akter" defaultValue={sp.akter ?? ""} className={`${inputCls} ml-1 w-48`}>
            <option value="">{t("records.activity.allActors")}</option>
            {actors.map((a) => (
              <option key={a.id} value={a.id}>
                {a.label}
              </option>
            ))}
          </select>
        </label>
      </FilterBar>

      <Card hint={t("records.activity.hint")}>
        <Table
          id="activity-table"
          caption={t("records.tabs.activity")}
          headers={headers}
          empty={result.rows.length === 0}
          emptyTitle={t("empty.filteredPeriod.title")}
          emptyHint={
            <>
              {t("empty.filteredPeriod.hint")}{" "}
              <Link href={recordsHref("aktivnosti")} className="font-medium text-primary-ink underline-offset-2 hover:underline">
                {t("records.activity.clearFilter")}
              </Link>
            </>
          }
        >
          {result.rows.map((e) => {
            const label = labelForAction(e.action);
            const summary = summarize(e);
            return (
              <tr key={e.id}>
                <Td className={label.translated ? "text-sm" : "font-mono text-[13px] text-slate-500"}>
                  {label.label}
                  {summary && <span className="ml-1.5 text-slate-500">— {summary}</span>}
                </Td>
                <Td className="text-sm">{formatDateTime(e.createdAt)}</Td>
                <Td className="text-sm">{e.actorId ? actorLabelById.get(e.actorId) ?? e.actorLabel ?? "—" : e.actorLabel ?? "—"}</Td>
                <Td className="text-sm">{categoryLabel(categoryForAction(e.action))}</Td>
              </tr>
            );
          })}
        </Table>
        <Pagination
          page={result.page}
          pageCount={result.pageCount}
          hrefFor={(p) => recordsHref("aktivnosti", { from, to, kat: categories, akter: sp.akter, str: String(p) })}
        />
      </Card>
    </>
  );
}
