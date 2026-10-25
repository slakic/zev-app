import { requireActor } from "@/server/actor";
import { availableRecordTabs, recordsHref, resolveRecordTab } from "@/lib/records";
import { t } from "@/lib/i18n";
import { PageHeader, Tabs } from "@/components/ui";
import { ActivityTab, type ActivitySearch } from "./activity-tab";
import { MessagesTab, type MessagesSearch } from "./messages-tab";
import { AuditTab, type AuditSearch } from "./audit-tab";

const TAB_LABEL = {
  aktivnosti: "records.tabs.activity",
  poruke: "records.tabs.messages",
  audit: "records.tabs.audit",
} as const;

/**
 * „Evidencije” (F7, X-Q5): Aktivnosti · Poslate poruke · Revizorski trag na jednom mjestu, kao stavka menija za upravu.
 * Stari URL-ovi (/aktivnosti, /podesavanja/audit, /podesavanja/poruke) se preusmjeravaju ovamo (next.config.ts).
 * Prava: PRESIDENT + ACCOUNTANT; tab „Aktivnosti” samo predsjednik, a svaki tab provjerava prava i u svom servisu.
 */
export default async function RecordsPage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string } & ActivitySearch & MessagesSearch & AuditSearch>;
}) {
  const actor = await requireActor("PRESIDENT", "ACCOUNTANT");
  const sp = await searchParams;
  const isPresident = actor.roles.includes("PRESIDENT");
  const active = resolveRecordTab(sp.tab, isPresident);

  return (
    <div>
      <PageHeader title={t("records.title")} subtitle={t("records.subtitle")} />
      <Tabs
        tabs={availableRecordTabs(isPresident).map((key) => ({ key, label: t(TAB_LABEL[key]) }))}
        active={active}
        hrefFor={(key) => recordsHref(resolveRecordTab(key, isPresident))}
      />
      {active === "aktivnosti" && <ActivityTab actor={actor} sp={sp} />}
      {active === "poruke" && <MessagesTab actor={actor} sp={sp} />}
      {active === "audit" && <AuditTab actor={actor} sp={sp} />}
    </div>
  );
}
