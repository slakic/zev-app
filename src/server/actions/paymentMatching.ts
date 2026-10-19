"use server";
// Form actions behind /fakture/uplate/uskladjivanje (Plans/sms-statement-payment-matching-plan.md).
// Plain <form action>s that redirect back with ?msg / ?err, like the other server-rendered pages.
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireActor } from "@/server/actor";
import {
  confirmSmsByStatement,
  linkChannelTransaction,
  markChannelNotSame,
  mergeChannelDuplicate,
} from "@/server/services/paymentMatching";
import { formatMoney } from "@/lib/money";

const PAGE = "/fakture/uplate/uskladjivanje";

async function run(tab: string, fn: () => Promise<string>): Promise<never> {
  let msg: string;
  try {
    msg = await fn();
  } catch (e) {
    if (e && typeof e === "object" && "digest" in e) throw e;
    redirect(`${PAGE}?tab=${tab}&err=${encodeURIComponent(e instanceof Error ? e.message : "Greška")}`);
  }
  revalidatePath(PAGE);
  revalidatePath("/fakture/uplate");
  revalidatePath("/fakture/uplate/sms");
  revalidatePath("/fakture");
  redirect(`${PAGE}?tab=${tab}&msg=${encodeURIComponent(msg)}`);
}

export async function mergeChannelDuplicateAction(formData: FormData): Promise<void> {
  const actor = await requireActor("ACCOUNTANT");
  await run("duplikati", async () => {
    const res = await mergeChannelDuplicate(actor, {
      smsId: String(formData.get("smsId") ?? ""),
      otherPaymentId: String(formData.get("otherPaymentId") ?? ""),
    });
    const moved = Number(res.moved) > 0 ? ` Na zadržanu uplatu je prenijeto ${formatMoney(res.moved)} raspoređivanja.` : "";
    const notMoved =
      Number(res.notMoved) > 0
        ? ` ${formatMoney(res.notMoved)} nije bilo moguće prenijeti — te fakture su ponovo otvorene.`
        : "";
    return `Uplate su spojene: duplikat je storniran.${moved}${notMoved}`;
  });
}

export async function linkChannelTransactionAction(formData: FormData): Promise<void> {
  const actor = await requireActor("ACCOUNTANT");
  await run("duplikati", async () => {
    await linkChannelTransaction(actor, {
      smsId: String(formData.get("smsId") ?? ""),
      otherTransactionId: String(formData.get("otherTransactionId") ?? ""),
    });
    return "Isplate su označene kao ista transakcija.";
  });
}

export async function markChannelNotSameAction(formData: FormData): Promise<void> {
  const actor = await requireActor("ACCOUNTANT");
  await run("duplikati", async () => {
    await markChannelNotSame(actor, {
      smsId: String(formData.get("smsId") ?? ""),
      otherPaymentId: String(formData.get("otherPaymentId") ?? "") || null,
      otherTransactionId: String(formData.get("otherTransactionId") ?? "") || null,
    });
    return "Zapamćeno: to su dvije različite transakcije.";
  });
}

export async function confirmSmsByStatementAction(formData: FormData): Promise<void> {
  const actor = await requireActor("ACCOUNTANT");
  await run("bez-izvoda", async () => {
    await confirmSmsByStatement(actor, String(formData.get("smsId") ?? ""));
    return "SMS stavka je označena kao potvrđena izvodom.";
  });
}
