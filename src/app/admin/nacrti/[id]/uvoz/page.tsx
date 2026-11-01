// Uvoz u nacrt klijenta za super admina (Plans/mcp-onboarding-asistent-plan.md §8): samo uz AKTIVAN pristup koji je admin
// dodijelio na kartici „Asistent” (klijent ga vidi i može ukloniti). Bez pristupa nema ni stranice ni akcije.
import { redirect } from "next/navigation";
import { requireSuperAdminActor } from "@/server/actor";
import { DraftAccessError, draftAccessForAdminWeb } from "@/server/services/draftAccess";
import { getDraftByAccess } from "@/server/services/onboarding";
import { OnboardingImport } from "@/components/onboarding-import";
import { PageHeader } from "@/components/ui";
import { assistantInstructions } from "@/lib/onboarding/import/importFormat";
import { t, tf } from "@/lib/i18n";

export default async function AdminDraftImportPage({ params }: { params: Promise<{ id: string }> }) {
  const actor = await requireSuperAdminActor();
  const { id } = await params;
  let name: string;
  try {
    const access = await draftAccessForAdminWeb(actor, id);
    name = (await getDraftByAccess(access)).label;
  } catch (e) {
    if (e instanceof DraftAccessError) redirect(`/admin/nacrti/${id}?err=${encodeURIComponent(e.message)}`);
    throw e;
  }
  const base = `/api/admin/nacrti/${id}/uvoz`;
  return (
    <div>
      <PageHeader
        title={t("onboarding.import.title")}
        subtitle={tf("onboarding.import.subtitleAdmin", { naziv: name })}
        backHref={`/admin/nacrti/${id}`}
        backLabel={t("onboarding.import.backAdmin")}
      />
      <OnboardingImport
        draftId={id}
        instructions={assistantInstructions()}
        csvHref={`${base}/obrazac.csv`}
        jsonHref={`${base}/primjer.json`}
        exportHref={`${base}/nacrt.json`}
        adminBackHref={`/admin/nacrti/${id}`}
      />
    </div>
  );
}
