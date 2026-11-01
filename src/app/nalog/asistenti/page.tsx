// Povezani asistenti (Plans/mcp-platforma-plan.md, mockup X-M05): veze asistenta (Claude, ChatGPT...) sa nalogom
// korisnika. Stranica je na nivou NALOGA (/nalog), ne ZEV-a, pa radi i za klijenta u onboardingu koji još nema
// ZEV. Iza MCP_ENABLED: dok nije uključen, stranica ne postoji (404).
import { notFound } from "next/navigation";
import { requireActor } from "@/server/actor";
import { getEnv } from "@/lib/env";
import { t, tf, formatDate, formatDateTime } from "@/lib/i18n";
import { listMyMcpConnections, listOfferedScopes } from "@/server/services/mcpConnections";
import { listAdminAccessToMyDrafts } from "@/server/services/mcpDraftAccess";
import { revokeMcpConnectionAction } from "@/server/actions/mcpConnections";
import { revokeDraftAdminAccessAction } from "@/server/actions/mcpDraftAccess";
import { PageHeader, Card, Table, Td, Flash, ConfirmAction, type ColumnSpec } from "@/components/ui";
import { McpConnectionForm } from "@/components/mcp-connection-form";
import { CopyField } from "@/components/mcp-connection-secret";

const accessHeaders: ColumnSpec[] = [
  { label: t("assistants.adminAccess.admin"), priority: "primary" },
  { label: t("assistants.adminAccess.draft"), priority: "secondary" },
  { label: t("assistants.adminAccess.since"), priority: "secondary", nowrap: true },
  { label: t("assistants.adminAccess.lastUsed"), priority: "detail", nowrap: true },
  { label: t("assistants.adminAccess.actions"), actions: true },
];

const headers: ColumnSpec[] = [
  { label: t("assistants.list.name"), priority: "primary" },
  { label: t("assistants.list.scope"), priority: "secondary" },
  { label: t("assistants.list.validUntil"), priority: "secondary", nowrap: true },
  { label: t("assistants.list.lastUsed"), priority: "detail", nowrap: true },
  { label: t("assistants.list.actions"), actions: true },
];

export default async function AssistantsPage({ searchParams }: { searchParams: Promise<{ err?: string; msg?: string; naziv?: string; opseg?: string }> }) {
  if (getEnv().MCP_ENABLED !== "true") notFound();
  const actor = await requireActor();
  const oauthEnabled = getEnv().MCP_OAUTH_ENABLED === "true";
  const { err, msg, naziv, opseg } = await searchParams;
  const [offered, connections, adminAccess] = await Promise.all([listOfferedScopes(actor), listMyMcpConnections(actor), listAdminAccessToMyDrafts(actor)]);
  // Klijent bez ZEV-a koji nije super admin dolazi iz čarobnjaka i vraća se u njega.
  const fromWizard = !actor.zevId && !actor.isSuperAdmin;
  // Unaprijed izabran opseg iz adrese važi samo ako je među ponuđenima (server ga ionako ponovo izvodi pri pravljenju veze).
  const preselected = offered.find((o) => o.key === opseg);
  // Super admin koji dolazi sa stranice tuđeg nacrta vraća se na nju (id izveden iz ponuđenog opsega, ne iz adrese).
  const adminDraftId = preselected?.via === "ADMIN" && preselected.scope.kind === "ONBOARDING_DRAFT" ? preselected.scope.draftId : null;
  const backHref = fromWizard ? "/onboarding" : adminDraftId ? `/admin/nacrti/${adminDraftId}` : undefined;
  return (
    <div>
      <PageHeader
        title={t("assistants.title")}
        subtitle={t("assistants.subtitle")}
        backHref={backHref}
      />
      <Flash
        err={err}
        msg={
          msg === "revoked" ? tf("assistants.revoke.done", { naziv: naziv ?? "" })
          : msg === "access_revoked" ? t("assistants.adminAccess.revoke.done")
          : undefined
        }
      />
      <div className="space-y-6">
      {oauthEnabled && (
        <Card title={t("assistants.oauthCard.title")}>
          <div className="space-y-4">
            <p className="max-w-[68ch] text-sm text-slate-700">{t("assistants.oauthCard.intro")}</p>
            <div>
              <p className="text-sm font-medium text-slate-700">{t("assistants.oauthCard.stepsTitle")}</p>
              <ol className="mt-1 list-decimal space-y-0.5 pl-5 text-sm text-slate-700">
                {(["one", "two", "three", "four", "five"] as const).map((k) => (
                  <li key={k}>{t(`assistants.oauthCard.steps.${k}`)}</li>
                ))}
              </ol>
            </div>
            <CopyField label={t("assistants.oauthCard.urlLabel")} value={`${getEnv().APP_URL.replace(/\/+$/, "")}/api/mcp`} />
          </div>
        </Card>
      )}

      {adminAccess.length > 0 && (
        <Card title={t("assistants.adminAccess.title")}>
          <div className="space-y-4">
            <p className="max-w-[68ch] text-sm text-slate-700">{t("assistants.adminAccess.intro")}</p>
            <Table id="mcp-admin-access-table" caption={t("assistants.adminAccess.title")} headers={accessHeaders}>
              {adminAccess.map((a) => (
                <tr key={a.id}>
                  <Td><span className="font-medium text-slate-900">{a.adminName}</span></Td>
                  <Td>{a.draftLabel}</Td>
                  <Td className="tabular-nums">{formatDate(a.grantedAt)}</Td>
                  <Td className={a.lastUsedAt ? "tabular-nums" : "text-slate-500"}>
                    {a.lastUsedAt ? formatDateTime(a.lastUsedAt) : t("assistants.adminAccess.neverUsed")}
                  </Td>
                  <Td>
                    <ConfirmAction
                      trigger={t("assistants.adminAccess.revoke.trigger")}
                      title={tf("assistants.adminAccess.revoke.title", { ime: a.adminName })}
                      body={<p className="text-sm text-amber-950">{t("assistants.adminAccess.revoke.body")}</p>}
                      confirmLabel={t("assistants.adminAccess.revoke.confirm")}
                      action={revokeDraftAdminAccessAction}
                      hiddenFields={{ id: a.id, back: "assistants", draftId: a.draftId }}
                    />
                  </Td>
                </tr>
              ))}
            </Table>
          </div>
        </Card>
      )}

      <Card title={t("assistants.form.title")} hint={preselected ? t("assistants.adminAccess.preselected") : undefined}>
        <McpConnectionForm
          offered={offered.map((o) => ({ key: o.key, label: o.label, via: o.via }))}
          preselect={preselected?.key}
          oauthEnabled={oauthEnabled}
        />
      </Card>

      <Card title={tf("assistants.list.title", { n: connections.length })}>
        <Table
          id="mcp-connections-table"
          caption={t("assistants.title")}
          headers={headers}
          empty={connections.length === 0}
          emptyTitle={t("assistants.list.empty")}
          emptyHint={t("assistants.list.emptyHint")}
        >
          {connections.map((c) => (
            <tr key={c.id}>
              <Td>
                <span className="font-medium text-slate-900">{c.name}</span>
                <div className="text-[13px] text-slate-500">
                  {t(`assistants.clientShort.${c.client}`)} · {t(`assistants.kind.${c.kind}`)}
                  {c.kind === "OAUTH" && c.oauthClientName ? ` · ${c.oauthClientName}` : ""}
                </div>
              </Td>
              <Td>
                {c.scopes.length === 0 ? (
                  t("assistants.scope.none.title")
                ) : (
                  c.scopes.map((s) => (
                    <div key={s.scope.draftId}>
                      {tf("assistants.scope.draft.short", { naziv: s.label })}
                      {!s.active && <span className="text-slate-500"> {t("assistants.scope.inactive")}</span>}
                    </div>
                  ))
                )}
              </Td>
              <Td className="tabular-nums">{formatDate(c.expiresAt)}</Td>
              <Td className={c.lastUsedAt ? "tabular-nums" : "text-slate-500"}>
                {c.lastUsedAt ? formatDateTime(c.lastUsedAt) : t("assistants.list.neverUsed")}
              </Td>
              <Td>
                <ConfirmAction
                  trigger={t("assistants.revoke.trigger")}
                  title={tf("assistants.revoke.title", { naziv: c.name })}
                  body={<p className="text-sm text-amber-950">{t("assistants.revoke.body")}</p>}
                  confirmLabel={t("assistants.revoke.confirm")}
                  action={revokeMcpConnectionAction}
                  hiddenFields={{ id: c.id }}
                />
              </Td>
            </tr>
          ))}
        </Table>
      </Card>
      </div>
    </div>
  );
}
