import { redirect } from "next/navigation";
import { requireSuperAdminActor } from "@/server/actor";
import { listTenants } from "@/server/services/admin";
import { switchActiveZev } from "@/server/services/memberships";
import { PageHeader, Card, Table, Td, StatusBadge, Flash, RowAction, RowActionLink, RowLink, BtnLink, type ColumnSpec } from "@/components/ui";
import { t, tf } from "@/lib/i18n";
import { isFewForm, isOneForm } from "@/lib/plural";

const tenantHeaders: ColumnSpec[] = [
  { label: "Naziv", priority: "primary" },
  { label: "Paket", priority: "detail" },
  { label: "Predsjednik" },
  { label: "Zgrade", align: "right", priority: "detail" },
  { label: "Vlasnici", align: "right", priority: "detail" },
  { label: "Status" },
  { label: "Radnje", actions: true },
];

const TIER_LABELS: Record<string, string> = {
  BASIC: "Basic",
  BASIC_FINANCE: "Basic + finansije",
  FULL: "Full (+ e-glasanje)",
};

async function enterZevAction(formData: FormData) {
  "use server";
  const actor = await requireSuperAdminActor();
  const zevId = String(formData.get("zevId") ?? "");
  try {
    await switchActiveZev(actor, zevId);
  } catch (e) {
    redirect(`/admin?err=${encodeURIComponent(e instanceof Error ? e.message : "Greška")}`);
  }
  redirect("/");
}

function countLabel(group: string, n: number): string {
  const form = isOneForm(n) ? "one" : isFewForm(n) ? "few" : "other";
  return tf(`${group}.${form}`, { broj: n });
}

export default async function AdminHomePage({ searchParams }: { searchParams: Promise<{ err?: string }> }) {
  const actor = await requireSuperAdminActor();
  const { err } = await searchParams;
  const tenants = await listTenants(actor);
  const activeCount = tenants.filter((z) => z.active).length;
  return (
    <div>
      <PageHeader
        title={t("admin.list.title")}
        subtitle={`${countLabel("admin.list.count", tenants.length)} · ${countLabel("admin.list.active", activeCount)}`}
        actions={<BtnLink href="/admin/novi" variant="primary">{t("admin.list.newTenant")}</BtnLink>}
      />
      <Flash err={err} />
      <Card>
        <Table
          id="tenants-table"
          caption={t("admin.list.title")}
          headers={tenantHeaders}
          empty={tenants.length === 0}
          emptyTitle={t("empty.tenants.title")}
          emptyHint={t("empty.tenants.hint")}
        >
          {tenants.map((z) => {
            const president = z.memberships[0]?.user;
            return (
              <tr key={z.id}>
                <Td>
                  <RowLink href={`/admin/${z.id}`}>{z.legalName}</RowLink>
                  {z.shortName && <div className="text-xs text-slate-500">{z.shortName}</div>}
                </Td>
                <Td>{TIER_LABELS[z.tier] ?? z.tier}</Td>
                <Td>{president?.email ?? "—"}</Td>
                <Td>{z._count.buildings}</Td>
                <Td>{z._count.parties}</Td>
                <Td>
                  <StatusBadge status={z.active ? "ACTIVE" : "SUSPENDED"} label={z.active ? "Aktivan" : "Suspendovan"} />
                </Td>
                <Td>
                  <div className="flex flex-wrap items-center gap-1.5">
                    <RowActionLink href={`/admin/${z.id}`}>Detalji</RowActionLink>
                    {z.hasMyMembership && (
                      <form action={enterZevAction}>
                        <input type="hidden" name="zevId" value={z.id} />
                        <RowAction type="submit">{t("tenant.enter")}</RowAction>
                      </form>
                    )}
                  </div>
                </Td>
              </tr>
            );
          })}
        </Table>
      </Card>
    </div>
  );
}
