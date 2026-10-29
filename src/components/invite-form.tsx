"use client";
// Forma „Pošalji poziv klijentu" na /admin/novi (mockup O-M01 ②③). Posle uspjeha forma se
// zamjenjuje jednokratnim prikazom linka — zato je ovo klijentska forma sa useActionState.
import { useActionState } from "react";
import { BtnLink, Field, Flash, SubmitBtn, inputCls } from "@/components/ui";
import { InviteLink } from "@/components/invite-link";
import { createInviteAction, type InviteLinkState } from "@/server/actions/onboarding";
import { t, tf } from "@/lib/i18n";

export function InviteForm({ tierOptions }: { tierOptions: { value: string; label: string }[] }) {
  const [state, formAction, pending] = useActionState<InviteLinkState, FormData>(createInviteAction, { status: "idle" });
  if (state.status === "ok") {
    return (
      <div className="space-y-4">
        <Flash msg={tf("onboarding.newPage.created", { datum: state.validUntil })} inset />
        <InviteLink link={state.link} email={state.email} inset />
        <BtnLink href="/admin?tab=pozivi">{t("onboarding.newPage.toList")}</BtnLink>
      </div>
    );
  }
  return (
    <form action={formAction} className="space-y-4">
      {state.status === "error" && <Flash err={state.error} inset />}
      <Field label={t("onboarding.newPage.workingName")} hint={t("onboarding.newPage.workingNameHint")}>
        <input name="workingName" required className={inputCls} />
      </Field>
      <Field label={t("onboarding.newPage.tier")}>
        <select name="tier" className={inputCls} defaultValue="BASIC_FINANCE">
          {tierOptions.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
      </Field>
      <Field label={t("onboarding.newPage.email")} hint={t("onboarding.newPage.emailHint")}>
        <input name="email" type="email" required className={inputCls} />
      </Field>
      <Field label={t("onboarding.newPage.note")} hint={t("onboarding.newPage.noteHint")}>
        <textarea name="note" rows={2} className={inputCls} />
      </Field>
      <SubmitBtn disabled={pending}>{t("onboarding.newPage.submit")}</SubmitBtn>
    </form>
  );
}
