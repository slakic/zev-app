import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireActor, isManagement } from "@/server/actor";
import { listIssues, reportIssue } from "@/server/services/maintenance";
import { listBuildings, listUnits } from "@/server/services/property";
import { partyDisplayName } from "@/server/services/ownership";
import { formatDate, tEnum, t } from "@/lib/i18n";
import { PageHeader, Card, Table, Td, StatusBadge, Field, inputCls, SubmitBtn, Flash, RowLink, FilterBar, BtnLink, type ColumnSpec } from "@/components/ui";

const issueHeaders: ColumnSpec[] = [
  { label: "Naslov", priority: "primary" },
  { label: "Prijavio", priority: "detail" },
  { label: "Kategorija", priority: "detail" },
  { label: "Hitnost", sortKey: "urgency" },
  { label: "Status" },
  { label: "Prijavljena", priority: "detail", sortKey: "date" },
];

const ISSUE_STATUSES = [
  "REPORTED", "TRIAGED", "AUTHORIZATION_REQUIRED", "APPROVED", "OFFERS_REQUESTED",
  "CONTRACTOR_SELECTED", "SCHEDULED", "IN_PROGRESS", "COMPLETED", "VERIFIED",
  "INVOICED", "PAID", "CLOSED", "REJECTED",
] as const;

const URGENCY_RANK: Record<string, number> = { LOW: 0, NORMAL: 1, HIGH: 2, EMERGENCY: 3 };

async function reportAction(formData: FormData) {
  "use server";
  const actor = await requireActor();
  try {
    await reportIssue(actor, {
      title: String(formData.get("title")),
      description: String(formData.get("description")),
      buildingId: (formData.get("buildingId") as string) || null,
      unitId: (formData.get("unitId") as string) || null,
      locationNote: (formData.get("locationNote") as string) || null,
      category: (formData.get("category") as string) || null,
      urgency: (formData.get("urgency") as never) || "NORMAL",
      safetyImpact: formData.get("safetyImpact") === "on",
    });
  } catch (e) {
    redirect(`/odrzavanje?err=${encodeURIComponent(e instanceof Error ? e.message : "Greška")}`);
  }
  revalidatePath("/odrzavanje");
}

export default async function MaintenancePage({
  searchParams,
}: {
  searchParams: Promise<{ err?: string; status?: string; mine?: string; sort?: string; dir?: string }>;
}) {
  const actor = await requireActor();
  const management = isManagement(actor);
  const sp = await searchParams;
  const { err } = sp;

  function odrzavanjeHref(overrides: Partial<{ status: string; mine: string; sort: string; dir: string }>) {
    const merged = { status: sp.status, mine: sp.mine, sort: sp.sort, dir: sp.dir, ...overrides };
    const params = new URLSearchParams();
    for (const [k, v] of Object.entries(merged)) if (v) params.set(k, v);
    return `/odrzavanje?${params.toString()}`;
  }

  const issueSort = sp.sort === "urgency" ? "urgency" : sp.sort === "date" ? "date" : undefined;
  const issueDir: "asc" | "desc" | undefined = sp.dir === "asc" ? "asc" : sp.dir === "desc" ? "desc" : undefined;
  const [rawIssues, buildings, units] = await Promise.all([
    listIssues(actor, { status: (sp.status as never) || undefined, mineOnly: sp.mine === "1" }),
    listBuildings(actor),
    listUnits(actor),
  ]);
  const sortMul = issueDir === "desc" ? -1 : 1;
  const issues = issueSort
    ? [...rawIssues].sort((a, b) =>
        issueSort === "urgency"
          ? (URGENCY_RANK[a.urgency] - URGENCY_RANK[b.urgency]) * sortMul
          : (a.createdAt.getTime() - b.createdAt.getTime()) * sortMul
      )
    : rawIssues;
  return (
    <div>
      <PageHeader title="Održavanje" subtitle={management ? "Prijave, trijaža, ponude, radni nalozi i realizacija" : "Vaše prijave kvarova"} />
      <Flash err={err} />
      <Card title="Prijavi kvar / problem">
        <form action={reportAction} className="grid grid-cols-1 sm:grid-cols-2 gap-3 lg:grid-cols-3">
          <Field label="Naslov"><input name="title" required className={inputCls} placeholder="Curenje u podrumu" /></Field>
          <Field label="Zgrada">
            <select name="buildingId" className={inputCls}>
              <option value="">—</option>
              {buildings.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
            </select>
          </Field>
          <Field label="Jedinica (ako se odnosi na jedinicu)">
            <select name="unitId" className={inputCls}>
              <option value="">—</option>
              {units.map((u) => <option key={u.id} value={u.id}>{u.building.name} / {u.label}</option>)}
            </select>
          </Field>
          <div className="sm:col-span-2">
            <Field label="Opis problema"><textarea name="description" required rows={2} className={inputCls} /></Field>
          </div>
          <Field label="Lokacija (napomena)"><input name="locationNote" className={inputCls} placeholder="podrum, kod liftovskog okna" /></Field>
          <Field label="Kategorija"><input name="category" className={inputCls} placeholder="vodovod / struja / lift..." /></Field>
          <Field label="Hitnost">
            <select name="urgency" className={inputCls}>
              <option value="NORMAL">Normalna</option>
              <option value="LOW">Niska</option>
              <option value="HIGH">Visoka</option>
              <option value="EMERGENCY">Hitno</option>
            </select>
          </Field>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="safetyImpact" /> utiče na bezbjednost</label>
          <div className="flex items-end"><SubmitBtn>Pošalji prijavu</SubmitBtn></div>
        </form>
      </Card>

      <div className="mt-4">
        {management && (
          <FilterBar>
            {issueSort && <input type="hidden" name="sort" value={issueSort} />}
            {issueDir && <input type="hidden" name="dir" value={issueDir} />}
            <Field label="Status">
              <select name="status" defaultValue={sp.status ?? ""} className={inputCls}>
                <option value="">Svi</option>
                {ISSUE_STATUSES.map((s) => <option key={s} value={s}>{tEnum("issueStatus", s)}</option>)}
              </select>
            </Field>
            <label className="flex items-center gap-2 pb-2 text-sm">
              <input type="checkbox" name="mine" value="1" defaultChecked={sp.mine === "1"} /> samo moje prijave
            </label>
            {(sp.status || sp.mine) && <BtnLink href="/odrzavanje" variant="secondary">Poništi filter</BtnLink>}
          </FilterBar>
        )}
        <Card title={management ? "Sve prijave" : "Moje prijave"}>
          <Table
            id="issues-table"
            caption={management ? "Sve prijave" : "Moje prijave"}
            headers={issueHeaders}
            sort={{ active: issueSort, dir: issueDir, hrefFor: (key, d) => odrzavanjeHref({ sort: key, dir: d }) }}
            empty={issues.length === 0}
            emptyTitle={t(
              issues.length === 0 && (sp.status || sp.mine)
                ? "empty.filteredQuery.title"
                : management
                  ? "empty.issuesManagement.title"
                  : "empty.issuesOwner.title"
            )}
            emptyHint={t(
              issues.length === 0 && (sp.status || sp.mine)
                ? "empty.filteredQuery.hint"
                : management
                  ? "empty.issuesManagement.hint"
                  : "empty.issuesOwner.hint"
            )}
          >
            {issues.map((i) => (
              <tr key={i.id}>
                <Td><RowLink href={`/odrzavanje/${i.id}`}>{i.title}</RowLink></Td>
                <Td>{partyDisplayName(i.reporter)}</Td>
                <Td>{i.category ?? "—"}</Td>
                <Td>{tEnum("urgency", i.urgency)}{i.isEmergency ? " ⚠" : ""}</Td>
                <Td><StatusBadge status={i.status} label={tEnum("issueStatus", i.status)} /></Td>
                <Td>{formatDate(i.createdAt)}</Td>
              </tr>
            ))}
          </Table>
        </Card>
      </div>
    </div>
  );
}
