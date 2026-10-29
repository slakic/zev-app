"use server";
// Akcije platformskog admina za pozive (Plans/zev-onboarding-wizard-plan.md §3). Kreiranje i novi
// link vraćaju stanje (useActionState) umjesto preusmjeravanja: link se prikazuje JEDNOM, na istom
// ekranu, i nikad ne ide u adresu stranice (istorija pretraživača, logovi).
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireSuperAdminActor } from "@/server/actor";
import { createOnboardingInvite, reissueOnboardingInvite, revokeOnboardingInvite } from "@/server/services/onboarding";
import { getEnv } from "@/lib/env";
import { formatDate } from "@/lib/i18n";

export type InviteLinkState =
  | { status: "idle" }
  | { status: "error"; error: string }
  | { status: "ok"; link: string; email: string; validUntil: string };

function inviteLink(token: string): string {
  return `${getEnv().APP_URL.replace(/\/$/, "")}/onboarding/poziv/${token}`;
}

export async function createInviteAction(_prev: InviteLinkState, formData: FormData): Promise<InviteLinkState> {
  const actor = await requireSuperAdminActor();
  try {
    const email = String(formData.get("email") ?? "");
    const res = await createOnboardingInvite(actor, {
      workingName: String(formData.get("workingName") ?? ""),
      tier: formData.get("tier") as never,
      email,
      note: (formData.get("note") as string) || null,
    });
    revalidatePath("/admin");
    return { status: "ok", link: inviteLink(res.token), email: email.trim().toLowerCase(), validUntil: formatDate(res.expiresAt) };
  } catch (e) {
    return { status: "error", error: e instanceof Error ? e.message : "Greška" };
  }
}

export async function reissueInviteAction(_prev: InviteLinkState, formData: FormData): Promise<InviteLinkState> {
  const actor = await requireSuperAdminActor();
  try {
    const res = await reissueOnboardingInvite(actor, String(formData.get("inviteId") ?? ""));
    revalidatePath("/admin");
    return { status: "ok", link: inviteLink(res.token), email: res.email, validUntil: formatDate(res.expiresAt) };
  } catch (e) {
    return { status: "error", error: e instanceof Error ? e.message : "Greška" };
  }
}

export async function revokeInviteAction(formData: FormData): Promise<void> {
  const actor = await requireSuperAdminActor();
  try {
    await revokeOnboardingInvite(actor, String(formData.get("inviteId") ?? ""), String(formData.get("reason") ?? ""));
  } catch (e) {
    redirect(`/admin?tab=pozivi&err=${encodeURIComponent(e instanceof Error ? e.message : "Greška")}`);
  }
  revalidatePath("/admin");
  redirect("/admin?tab=pozivi&msg=revoked");
}
