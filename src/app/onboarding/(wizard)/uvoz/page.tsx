// Uvoz nacrta iz JSON/CSV fajla za vlasnika nacrta (Plans/mcp-onboarding-asistent-plan.md §8). Statički segment „uvoz” ima
// prednost nad [step]. Pravo pristupa: samo SVOJ nacrt u toku (getMyDraft), nikad ID iz adrese ili forme.
import { redirect } from "next/navigation";
import { requireActor } from "@/server/actor";
import { getMyDraft, landingPath, stepSlug } from "@/server/services/onboarding";
import { OnboardingImport } from "@/components/onboarding-import";
import { PageHeader } from "@/components/ui";
import { assistantInstructions } from "@/lib/onboarding/import/importFormat";
import { t, tf } from "@/lib/i18n";

export default async function OnboardingImportPage() {
  const actor = await requireActor();
  const draft = await getMyDraft(actor);
  if (!draft) redirect(await landingPath(actor));
  const current = draft.progress.steps.find((s) => s.key === draft.progress.currentStep)!;
  return (
    <main className="mx-auto w-full max-w-[1440px] p-4 md:p-8">
      <div className="max-w-5xl">
        <PageHeader
          title={t("onboarding.import.title")}
          subtitle={t("onboarding.import.subtitle")}
          backHref={`/onboarding/${stepSlug(current.key)}`}
          backLabel={tf("onboarding.import.back", { korak: current.label })}
        />
        <OnboardingImport
          instructions={assistantInstructions()}
          csvHref="/api/onboarding/uvoz/obrazac.csv"
          jsonHref="/api/onboarding/uvoz/primjer.json"
          exportHref="/api/onboarding/uvoz/nacrt.json"
        />
      </div>
    </main>
  );
}
