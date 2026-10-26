"use server";
// Server actions behind the "Probna e-mail poruka" card and the platform e-mail settings
// (Plans/email-sender-name-and-test-email-plan.md). Same shape as actions/bankSms.ts: they return
// { ok } instead of redirecting, so the provider's exact error is shown next to the button and
// never travels in a URL.
import { revalidatePath } from "next/cache";
import { requireActor, requireSuperAdminActor } from "@/server/actor";
import { adminSendTestEmail, sendTestEmail, type TestEmailInput, type TestEmailResult } from "@/server/services/emailTest";
import { adminUpdateEmailSettings } from "@/server/services/platformSettings";

export type SendTestEmailActionResult = { ok: true; result: TestEmailResult } | { ok: false; error: string };

export async function sendTestEmailAction(input: TestEmailInput): Promise<SendTestEmailActionResult> {
  try {
    const actor = await requireActor("PRESIDENT", "ACCOUNTANT");
    const result = await sendTestEmail(actor, input);
    revalidatePath("/evidencije");
    revalidatePath("/podesavanja");
    return { ok: true, result };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Greška pri slanju." };
  }
}

export async function adminSendTestEmailAction(input: TestEmailInput): Promise<SendTestEmailActionResult> {
  try {
    const actor = await requireSuperAdminActor();
    const result = await adminSendTestEmail(actor, input);
    revalidatePath("/admin/podesavanja");
    return { ok: true, result };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Greška pri slanju." };
  }
}

export type SaveEmailSettingsResult = { ok: true } | { ok: false; error: string };

export async function saveEmailSettingsAction(input: {
  fromName: string;
  appendZevName: boolean;
  recipientAllowlist: string;
}): Promise<SaveEmailSettingsResult> {
  try {
    const actor = await requireSuperAdminActor();
    await adminUpdateEmailSettings(actor, input);
    revalidatePath("/admin/podesavanja");
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Greška pri čuvanju." };
  }
}
