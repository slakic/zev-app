"use server";
// Server actions behind the SMS booking queue and the webhook-key card
// (Plans/bank-sms-ingestion-plan.md). Same shape as bankPdfImport.ts: client components call
// these and get { ok } back instead of redirecting, so a rejected confirmation can be shown
// next to the rows the accountant is editing.
import { revalidatePath } from "next/cache";
import { requireActor } from "@/server/actor";
import {
  checkBankSmsText,
  confirmBankSms,
  dismissBankSms,
  issueBankSmsToken,
  revokeBankSmsToken,
  type ConfirmBankSmsItem,
} from "@/server/services/bankSms";

function refresh() {
  revalidatePath("/fakture/uplate");
  revalidatePath("/fakture/uplate/sms");
  revalidatePath("/troskovi");
  revalidatePath("/podesavanja");
}

export type ConfirmSmsResult = { ok: true; confirmed: number } | { ok: false; error: string };

export async function confirmBankSmsAction(items: ConfirmBankSmsItem[]): Promise<ConfirmSmsResult> {
  try {
    const actor = await requireActor("ACCOUNTANT");
    const res = await confirmBankSms(actor, { items });
    refresh();
    return { ok: true, confirmed: res.confirmed };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Greška pri potvrdi." };
  }
}

/** Used as a <form action> by ConfirmAction (hidden `smsId`, required `reason`). */
export async function dismissBankSmsAction(formData: FormData): Promise<void> {
  const actor = await requireActor("ACCOUNTANT");
  await dismissBankSms(actor, String(formData.get("smsId") ?? ""), String(formData.get("reason") ?? ""));
  refresh();
}

export type IssueTokenResult = { ok: true; token: string; url: string } | { ok: false; error: string };

export async function issueBankSmsTokenAction(): Promise<IssueTokenResult> {
  try {
    const actor = await requireActor("PRESIDENT", "ACCOUNTANT");
    const res = await issueBankSmsToken(actor);
    refresh();
    return { ok: true, token: res.token, url: res.url };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Greška." };
  }
}

export async function revokeBankSmsTokenAction(): Promise<{ ok: boolean; error?: string }> {
  try {
    const actor = await requireActor("PRESIDENT", "ACCOUNTANT");
    await revokeBankSmsToken(actor);
    refresh();
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Greška." };
  }
}

export type CheckSmsResult =
  | { ok: true; result: Awaited<ReturnType<typeof checkBankSmsText>> }
  | { ok: false; error: string };

export async function checkBankSmsTextAction(text: string): Promise<CheckSmsResult> {
  try {
    const actor = await requireActor("PRESIDENT", "ACCOUNTANT");
    return { ok: true, result: await checkBankSmsText(actor, String(text ?? "")) };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Greška." };
  }
}
