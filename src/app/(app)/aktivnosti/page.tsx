import Link from "next/link";
import { requireActor } from "@/server/actor";
import { listActivity, listActivityActors } from "@/server/services/activity";
import { ACTIVITY_CATEGORIES, DEFAULT_ACTIVITY_CATEGORIES, categoryForAction, categoryLabel, labelForAction, summarize, type ActivityCategory } from "@/lib/activity/catalog";
import { formatDateTime, endOfDay, t } from "@/lib/i18n";
import { PageHeader, Card, Table, Td, Pagination, SubmitBtn, inputCls, type ColumnSpec } from "@/components/ui";

const activityHeaders: ColumnSpec[] = [
  { label: "Vrijeme", nowrap: true },
  { label: "Akter" },
  { label: "Kategorija" },
  { label: "Aktivnost" },
];

function daysAgoIso(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString().slice(0, 10);
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

function buildQuery(params: { from: string; to: string; categories: ActivityCategory[]; akter?: string }, page: number): string {
  const qs = new URLSearchParams();
  qs.set("from", params.from);
  qs.set("to", params.to);
  params.categories.forEach((c) => qs.append("kat", c));
  if (params.akter) qs.set("akter", params.akter);
  qs.set("str", String(page));
  return `?${qs.toString()}`;
}

/**
 * Curated, PRESIDENT-only activity feed (Plans/user-activity-log-plan.md §3, §5) — a plain
 * chronological feed with an `akter` filter, not a per-owner page: user decision P3 dropped
 * the originally-proposed per-owner card in favor of exactly this. Distinct from the existing
 * /podesavanja/audit (PRESIDENT+ACCOUNTANT, every action, raw payload) — this page answers
 * "what's been happening" for a president, not "show me the forensic trail".
 */
export default async function ActivityPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; to?: string; kat?: string | string[]; akter?: string; str?: string }>;
}) {
  const actor = await requireActor("PRESIDENT");
  const sp = await searchParams;
  const from = sp.from || daysAgoIso(30);
  const to = sp.to || todayIso();
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
      from: new Date(from),
      to: endOfDay(to),
      categories,
      actorUserId: sp.akter || undefined,
      page,
    }),
  ]);
  const actorLabelById = new Map(actors.map((a) => [a.id, a.label]));

  return (
    <div>
      <PageHeader
        title="Aktivnosti"
        subtitle="Kurirani pregled aktivnosti vlasnika i uprave — podrazumijevano zadnjih 30 dana"
      />
      <form className="mb-4 flex flex-wrap items-end gap-4 rounded-lg border border-slate-200 bg-white p-3">
        <label className="text-sm">
          Od{" "}
          <input type="date" name="from" defaultValue={from} className={`${inputCls} ml-1 w-36`} />
        </label>
        <label className="text-sm">
          Do{" "}
          <input type="date" name="to" defaultValue={to} className={`${inputCls} ml-1 w-36`} />
        </label>
        <fieldset>
          <legend className="mb-1 text-xs font-medium text-slate-500">Kategorija</legend>
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
          Akter{" "}
          <select name="akter" defaultValue={sp.akter ?? ""} className={`${inputCls} ml-1 w-48`}>
            <option value="">Svi</option>
            {actors.map((a) => (
              <option key={a.id} value={a.id}>
                {a.label}
              </option>
            ))}
          </select>
        </label>
        <SubmitBtn variant="tonal">Primijeni</SubmitBtn>
      </form>

      <Card>
        <Table
          id="activity-table"
          caption="Aktivnosti"
          headers={activityHeaders}
          empty={result.rows.length === 0}
          emptyTitle={t("empty.filteredPeriod.title")}
          emptyHint={
            <>
              {t("empty.filteredPeriod.hint")}{" "}
              <Link href="/aktivnosti" className="font-medium text-primary-ink underline-offset-2 hover:underline">
                Obriši filtere
              </Link>
            </>
          }
        >
          {result.rows.map((e) => {
            const label = labelForAction(e.action);
            const summary = summarize(e);
            return (
              <tr key={e.id}>
                <Td className="text-xs">{formatDateTime(e.createdAt)}</Td>
                <Td className="text-xs">{e.actorId ? actorLabelById.get(e.actorId) ?? e.actorLabel ?? "—" : e.actorLabel ?? "—"}</Td>
                <Td className="text-xs">{categoryLabel(categoryForAction(e.action))}</Td>
                <Td className={label.translated ? "text-sm" : "font-mono text-xs text-slate-500"}>
                  {label.label}
                  {summary && <span className="ml-1.5 text-slate-500">— {summary}</span>}
                </Td>
              </tr>
            );
          })}
        </Table>
        <Pagination
          page={result.page}
          pageCount={result.pageCount}
          hrefFor={(p) => buildQuery({ from, to, categories, akter: sp.akter }, p)}
        />
      </Card>
    </div>
  );
}
