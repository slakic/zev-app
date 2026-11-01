// OnboardingShell (Plans/design-system.md §4.5, mockup O-M02; src/components/shells.tsx): školjka čarobnjaka za
// novi ZEV. Pristup: prijavljen korisnik sa nacrtom u toku.
import { redirect } from "next/navigation";
import { requireActor } from "@/server/actor";
import { getMyDraft, landingPath } from "@/server/services/onboarding";
import { OnboardingShell } from "@/components/shells";
import { getEnv } from "@/lib/env";
import { countActiveAdminAccess } from "@/server/services/mcpDraftAccess";

export default async function OnboardingLayout({ children }: { children: React.ReactNode }) {
  const actor = await requireActor();
  const draft = await getMyDraft(actor);
  if (!draft) redirect(await landingPath(actor));
  // „Asistent" i obavještenje o pristupu administratora postoje samo uz uključene asistente (MCP_ENABLED).
  const mcp = getEnv().MCP_ENABLED === "true";
  const adminAccessNotice = mcp && (await countActiveAdminAccess(draft.id)) > 0;
  return (
    <OnboardingShell
      actor={actor}
      showSaved
      assistantHref={mcp ? `/nalog/asistenti?opseg=draft:${draft.id}` : undefined}
      adminAccessNotice={adminAccessNotice}
    >
      {children}
    </OnboardingShell>
  );
}
