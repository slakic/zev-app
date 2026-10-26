import { requireSuperAdminActor } from "@/server/actor";
import { PageHeader } from "@/components/ui";
import { EmailSettingsCard } from "@/components/email-settings-card";
import { TestEmailCard } from "@/components/test-email-card";
import { adminGetEmailSettings } from "@/server/services/platformSettings";
import { adminGetTestEmailStatus } from "@/server/services/emailTest";
import { t } from "@/lib/i18n";

// „Podešavanja platforme” (F9, X-R16): e-mail podešavanja i probna poruka su sa liste ZEV naloga
// prešli na svoju stavku menija. Isti kartice, isti serverski zaštićeni servisi.
export default async function AdminPlatformSettingsPage() {
  const actor = await requireSuperAdminActor();
  const [emailSettings, testEmailStatus] = await Promise.all([
    adminGetEmailSettings(actor),
    adminGetTestEmailStatus(actor),
  ]);
  return (
    <div>
      <PageHeader title={t("admin.settingsPage.title")} subtitle={t("admin.settingsPage.subtitle")} />
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <EmailSettingsCard settings={emailSettings} />
        <TestEmailCard status={testEmailStatus} scope="admin" />
      </div>
    </div>
  );
}
