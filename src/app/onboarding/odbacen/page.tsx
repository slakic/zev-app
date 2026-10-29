// Korisnik bez ZEV-a čiji je nacrt odbačen (Plans/zev-onboarding-wizard-plan.md §3.2): poruka umjesto
// prazne aplikacije. Nalog ostaje — može kasnije dobiti novi poziv ili pristup postojećem ZEV-u.
import { redirect } from "next/navigation";
import { requireActor } from "@/server/actor";
import { destroySession } from "@/server/auth/session";
import { hasDiscardedDraftOnly } from "@/server/services/onboarding";
import { AuthShell } from "@/components/auth-shell";
import { SubmitBtn } from "@/components/ui";
import { t } from "@/lib/i18n";

async function logoutAction() {
  "use server";
  await destroySession();
  redirect("/login");
}

export default async function DiscardedDraftPage() {
  const actor = await requireActor();
  if (actor.zevId || !(await hasDiscardedDraftOnly(actor.userId))) redirect("/");
  return (
    <AuthShell pageTitle={t("onboarding.discarded.title")}>
      <p className="mb-4 text-sm text-slate-700">{t("onboarding.discarded.body")}</p>
      <form action={logoutAction}>
        <SubmitBtn variant="secondary">{t("nav.logout")}</SubmitBtn>
      </form>
    </AuthShell>
  );
}
