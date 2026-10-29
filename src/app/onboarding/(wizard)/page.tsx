// /onboarding vodi na trenutni korak — prvi nekompletan (onboardingProgress).
import { redirect } from "next/navigation";
import { requireActor } from "@/server/actor";
import { getMyDraft, landingPath, stepSlug } from "@/server/services/onboarding";

export default async function OnboardingIndex() {
  const actor = await requireActor();
  const draft = await getMyDraft(actor);
  if (!draft) redirect(await landingPath(actor));
  redirect(`/onboarding/${stepSlug(draft.progress.currentStep)}`);
}
