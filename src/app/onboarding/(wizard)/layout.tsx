// OnboardingShell (Plans/design-system.md §4.5, mockup O-M02; src/components/shells.tsx): školjka čarobnjaka za
// novi ZEV. Pristup: prijavljen korisnik sa nacrtom u toku.
import { redirect } from "next/navigation";
import { requireActor } from "@/server/actor";
import { getMyDraft, landingPath } from "@/server/services/onboarding";
import { OnboardingShell } from "@/components/shells";

export default async function OnboardingLayout({ children }: { children: React.ReactNode }) {
  const actor = await requireActor();
  const draft = await getMyDraft(actor);
  if (!draft) redirect(await landingPath(actor));
  return <OnboardingShell actor={actor} showSaved>{children}</OnboardingShell>;
}
