"use server";
// Akcije platformskog admina za pozive (Plans/zev-onboarding-wizard-plan.md §3). Kreiranje i novi
// link vraćaju stanje (useActionState) umjesto preusmjeravanja: link se prikazuje JEDNOM, na istom
// ekranu, i nikad ne ide u adresu stranice (istorija pretraživača, logovi).
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireSuperAdminActor } from "@/server/actor";
import {
  createOnboardingInvite,
  onboardingInviteLink,
  reissueOnboardingInvite,
  revokeOnboardingInvite,
  sendOnboardingInviteEmail,
} from "@/server/services/onboarding";
import { formatDate } from "@/lib/i18n";

export type InviteLinkState =
  | { status: "idle" }
  | { status: "error"; error: string }
  | { status: "ok"; link: string; email: string; validUntil: string; emailStatus: InviteEmailStatus; emailError?: string };

/** `skipped` = admin je isključio slanje; link se šalje ručno. */
export type InviteEmailStatus = "sent" | "queued" | "failed" | "skipped";

/** Slanje e-poštom posle kreiranja/novog linka; greška slanja nikad ne ruši poziv (link se kopira ručno). */
async function maybeSendEmail(actor: Parameters<typeof sendOnboardingInviteEmail>[0], formData: FormData, inviteId: string, token: string) {
  if (formData.get("sendEmail") !== "on") return { emailStatus: "skipped" as const };
  try {
    const r = await sendOnboardingInviteEmail(actor, { inviteId, token });
    return { emailStatus: r.status, emailError: r.error };
  } catch (e) {
    return { emailStatus: "failed" as const, emailError: e instanceof Error ? e.message : "Greška" };
  }
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
    const sent = await maybeSendEmail(actor, formData, res.inviteId, res.token);
    revalidatePath("/admin");
    return { status: "ok", link: onboardingInviteLink(res.token), email: email.trim().toLowerCase(), validUntil: formatDate(res.expiresAt), ...sent };
  } catch (e) {
    return { status: "error", error: e instanceof Error ? e.message : "Greška" };
  }
}

export async function reissueInviteAction(_prev: InviteLinkState, formData: FormData): Promise<InviteLinkState> {
  const actor = await requireSuperAdminActor();
  try {
    const inviteId = String(formData.get("inviteId") ?? "");
    const res = await reissueOnboardingInvite(actor, inviteId);
    const sent = await maybeSendEmail(actor, formData, inviteId, res.token);
    revalidatePath("/admin");
    return { status: "ok", link: onboardingInviteLink(res.token), email: res.email, validUntil: formatDate(res.expiresAt), ...sent };
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
