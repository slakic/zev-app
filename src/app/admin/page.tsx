import { redirect } from "next/navigation";
import { requireSuperAdminActor } from "@/server/actor";
import { listTenants } from "@/server/services/admin";
import { switchActiveZev } from "@/server/services/memberships";
import { listOnboardingInvites, INVITE_TTL_DAYS, type InviteListRow } from "@/server/services/onboarding";
import { PageHeader, Card, Table, Td, StatusBadge, Flash, RowAction, RowActionLink, RowLink, BtnLink, Tabs, type ColumnSpec } from "@/components/ui";
import { InviteRow, type InviteRowData } from "@/components/invite-row";
import { getEnv } from "@/lib/env";
import { ONBOARDING_STEPS } from "@/lib/onboarding/progress";
import { formatDate, formatDateTime, t, tf } from "@/lib/i18n";
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

const inviteHeaders: ColumnSpec[] = [
  { label: t("onboarding.list.client"), priority: "primary" },
  { label: t("onboarding.list.tier"), priority: "detail" },
  { label: t("onboarding.list.state") },
  { label: t("onboarding.list.progress") },
  { label: t("onboarding.list.updated"), priority: "detail" },
  { label: t("onboarding.list.actions"), actions: true },
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

/** Red liste poziva: tekst napretka i datuma za ekran (servis vraća činjenice, ne rečenice). */
function inviteRowData(r: InviteListRow, newValidUntil: string): InviteRowData {
  let progress: string;
  let progressMeta = "";
  if (r.currentStep) {
    progress = `${tf("onboarding.stepOf", { broj: r.currentStep.number, ukupno: ONBOARDING_STEPS.length })} · ${r.currentStep.label}`;
    progressMeta = r.acceptedAt ? tf("onboarding.list.acceptedOn", { datum: formatDateTime(r.acceptedAt) }) : "";
  } else if (r.state === "REVOKED" && r.revokedAt) {
    progress = tf("onboarding.list.revokedOn", { datum: formatDate(r.revokedAt) });
  } else {
    progress = r.openedAt ? tf("onboarding.list.linkOpened", { datum: formatDateTime(r.openedAt) }) : t("onboarding.list.linkNotOpened");
    progressMeta = r.state === "EXPIRED"
      ? tf("onboarding.list.expiredOn", { datum: formatDate(r.expiresAt) })
      : tf("onboarding.list.validUntil", { datum: formatDate(r.expiresAt) });
  }
  return {
    id: r.id, email: r.email, workingName: r.workingName, tierLabel: TIER_LABELS[r.tier] ?? r.tier, state: r.state,
    progress, progressMeta, updated: formatDateTime(r.updatedAt), newValidUntil,
  };
}

function countLabel(group: string, n: number): string {
  const form = isOneForm(n) ? "one" : isFewForm(n) ? "few" : "other";
  return tf(`${group}.${form}`, { broj: n });
}

export default async function AdminHomePage({ searchParams }: { searchParams: Promise<{ err?: string; msg?: string; tab?: string }> }) {
  const actor = await requireSuperAdminActor();
  const { err, msg, tab } = await searchParams;
  const [tenants, invites] = await Promise.all([listTenants(actor), listOnboardingInvites(actor)]);
  const activeCount = tenants.filter((z) => z.active).length;
  // Kartica poziva postoji čim je poziv uključen ili ijedan poziv već postoji (§3.2).
  const showInvites = getEnv().ONBOARDING_INVITES_ENABLED === "true" || invites.length > 0;
  const activeTab = showInvites && tab === "pozivi" ? "pozivi" : "nalozi";
  const newValidUntil = formatDate(new Date(Date.now() + INVITE_TTL_DAYS * 86400000));
  return (
    <div>
      <PageHeader
        title={t("admin.list.title")}
        subtitle={`${countLabel("admin.list.count", tenants.length)} · ${countLabel("admin.list.active", activeCount)}`}
        actions={<BtnLink href="/admin/novi" variant="primary">{t("admin.list.newTenant")}</BtnLink>}
      />
      <Flash err={err} msg={msg === "revoked" ? t("onboarding.list.revokedMsg") : undefined} />
      {showInvites && (
        <Tabs
          tabs={[
            { key: "nalozi", label: t("onboarding.list.tabTenants"), count: tenants.length },
            { key: "pozivi", label: t("onboarding.list.tabInvites"), count: invites.length },
          ]}
          active={activeTab}
          hrefFor={(k) => (k === "pozivi" ? "/admin?tab=pozivi" : "/admin")}
        />
      )}
      {activeTab === "pozivi" ? (
        <Card>
          <Table
            id="invites-table"
            caption={t("onboarding.list.tabInvites")}
            headers={inviteHeaders}
            empty={invites.length === 0}
            emptyTitle={t("onboarding.list.empty")}
            emptyHint={t("onboarding.list.emptyHint")}
          >
            {invites.map((r) => (
              <InviteRow key={r.id} row={inviteRowData(r, newValidUntil)} colSpan={inviteHeaders.length} />
            ))}
          </Table>
        </Card>
      ) : (
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
      )}
    </div>
  );
}
