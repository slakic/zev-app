import { requireSuperAdminActor } from "@/server/actor";
import { listAllActivity, listActivityActorsForZev } from "@/server/services/activity";
import { listTenants } from "@/server/services/admin";
import { ACTIVITY_CATEGORIES, categoryForAction, categoryLabel, labelForAction, summarize, type ActivityCategory } from "@/lib/activity/catalog";
import { formatDateTime, endOfDay } from "@/lib/i18n";
import { PageHeader, Card, Table, Td, Pagination } from "@/components/ui";

function daysAgoIso(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.toISOString().slice(0, 10);
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

function buildQuery(params: { from: string; to: string; categories: ActivityCategory[]; zev?: string; akter?: string }, page: number): string {
  const qs = new URLSearchParams();
  qs.set("from", params.from);
  qs.set("to", params.to);
  params.categories.forEach((c) => qs.append("kat", c));
  if (params.zev) qs.set("zev", params.zev);
  if (params.akter) qs.set("akter", params.akter);
  qs.set("str", String(page));
  return `?${qs.toString()}`;
}

/**
 * Super-admin, cross-tenant activity view (Plans/user-activity-log-plan.md §9, §8 Faza 3) —
 * deliberately outside the (app) layer, no NavShell, same pattern as the rest of /admin
 * (src/app/admin/page.tsx, layout.tsx). Shares the catalog/i18n/renderer layer with
 * /aktivnosti entirely; differs only in guard (requireSuperAdmin, not requireZev) and query
 * shape (zevId optional, all four categories by default incl. SYSTEM, akter select scoped
 * to whichever zev is chosen rather than the actor's own tenant).
 */
export default async function AdminActivityPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; to?: string; kat?: string | string[]; zev?: string; akter?: string; str?: string }>;
}) {
  const actor = await requireSuperAdminActor();
  const sp = await searchParams;
  const from = sp.from || daysAgoIso(30);
  const to = sp.to || todayIso();
  const requestedCategories = sp.kat
    ? (Array.isArray(sp.kat) ? sp.kat : [sp.kat]).filter((c): c is ActivityCategory =>
        (ACTIVITY_CATEGORIES as readonly string[]).includes(c)
      )
    : [...ACTIVITY_CATEGORIES];
  const categories = requestedCategories.length > 0 ? requestedCategories : [...ACTIVITY_CATEGORIES];
  const page = Math.max(1, Number(sp.str) || 1);
  const zevId = sp.zev || undefined;

  const [tenants, actors, result] = await Promise.all([
    listTenants(actor),
    zevId ? listActivityActorsForZev(actor, zevId) : Promise.resolve([]),
    listAllActivity(actor, {
      from: new Date(from),
      to: endOfDay(to),
      categories,
      zevId,
      actorUserId: sp.akter || undefined,
      page,
    }),
  ]);
  const actorLabelById = new Map(actors.map((a) => [a.id, a.label]));

  return (
    <div>
      <PageHeader
        title="Aktivnosti — svi ZEV nalozi"
        subtitle="Platformski pregled aktivnosti preko svih tenanata — podrazumijevano zadnjih 30 dana"
      />
      <form className="mb-4 flex flex-wrap items-end gap-4 rounded-lg border border-slate-200 bg-white p-3">
        <label className="text-sm">
          Od{" "}
          <input type="date" name="from" defaultValue={from} className="ml-1 rounded border border-slate-300 px-2 py-1" />
        </label>
        <label className="text-sm">
          Do{" "}
          <input type="date" name="to" defaultValue={to} className="ml-1 rounded border border-slate-300 px-2 py-1" />
        </label>
        <label className="text-sm">
          ZEV{" "}
          <select name="zev" defaultValue={zevId ?? ""} className="ml-1 rounded border border-slate-300 px-2 py-1">
            <option value="">Svi ZEV nalozi</option>
            {tenants.map((z) => (
              <option key={z.id} value={z.id}>
                {z.shortName || z.legalName}
              </option>
            ))}
          </select>
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
          <select
            name="akter"
            defaultValue={sp.akter ?? ""}
            disabled={!zevId}
            title={zevId ? undefined : "Prvo izaberite konkretan ZEV"}
            className="ml-1 rounded border border-slate-300 px-2 py-1 disabled:bg-slate-50 disabled:text-slate-400"
          >
            <option value="">Svi</option>
            {actors.map((a) => (
              <option key={a.id} value={a.id}>
                {a.label}
              </option>
            ))}
          </select>
        </label>
        <button className="rounded-md bg-blue-600 px-3 py-1.5 text-sm font-medium text-white">Primijeni</button>
      </form>

      <Card>
        <Table headers={["Vrijeme", "ZEV", "Akter", "Kategorija", "Aktivnost"]} empty={result.rows.length === 0}>
          {result.rows.map((e) => {
            const label = labelForAction(e.action);
            const summary = summarize(e);
            return (
              <tr key={e.id}>
                <Td className="whitespace-nowrap text-xs">{formatDateTime(e.createdAt)}</Td>
                <Td className="text-xs">{e.zev ? e.zev.shortName || e.zev.legalName : "—"}</Td>
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
          hrefFor={(p) => buildQuery({ from, to, categories, zev: zevId, akter: sp.akter }, p)}
        />
      </Card>
    </div>
  );
}
