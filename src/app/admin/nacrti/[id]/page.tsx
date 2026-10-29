// Pregled nacrta novog ZEV-a za platformskog admina (Plans/zev-onboarding-wizard-plan.md §3.2): samo
// čitanje — gdje je klijent zapeo — i „Odbaci nacrt” za nacrt koji neće biti objavljen.
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireSuperAdminActor } from "@/server/actor";
import { discardOnboardingDraft, getDraftForAdmin } from "@/server/services/onboarding";
import { OnboardingSummary } from "@/components/onboarding-summary";
import { PreconditionList } from "@/components/precondition-list";
import { Card, ConfirmAction, Field, Flash, PageHeader, inputCls } from "@/components/ui";
import { formatDateTime, t, tf } from "@/lib/i18n";

async function discardAction(formData: FormData) {
  "use server";
  const actor = await requireSuperAdminActor();
  const id = String(formData.get("draftId") ?? "");
  try {
    await discardOnboardingDraft(actor, id, String(formData.get("reason") ?? ""));
  } catch (e) {
    redirect(`/admin/nacrti/${id}?err=${encodeURIComponent(e instanceof Error ? e.message : "Greška")}`);
  }
  revalidatePath("/admin");
  redirect(`/admin/nacrti/${id}?msg=discarded`);
}

export default async function AdminDraftPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ err?: string; msg?: string }> }) {
  const actor = await requireSuperAdminActor();
  const { id } = await params;
  const { err, msg } = await searchParams;
  const draft = await getDraftForAdmin(actor, id).catch(() => null);
  if (!draft) notFound();
  const current = draft.progress.steps.find((s) => s.key === draft.progress.currentStep)!;
  const steps = draft.progress.steps.filter((s) => s.key !== "review");
  return (
    <div>
      <PageHeader
        title={tf("onboarding.adminDraft.title", { naziv: draft.data.zev.legalName || draft.invite.workingName })}
        subtitle={tf("onboarding.adminDraft.subtitle", {
          email: draft.email,
          korak: `${tf("onboarding.stepOf", { broj: current.number, ukupno: draft.progress.steps.length })} · ${current.label} · ${formatDateTime(draft.updatedAt)}`,
        })}
        backHref="/admin?tab=pozivi"
        backLabel={t("onboarding.adminDraft.back")}
      />
      <Flash err={err} msg={msg === "discarded" ? t("onboarding.adminDraft.discarded") : undefined} />
      <div className="space-y-6">
        <p className="max-w-[68ch] text-sm text-slate-600">
          {draft.status === "PUBLISHED" && draft.publishedZevId ? (
            <>
              {tf("onboarding.adminDraft.published", { datum: formatDateTime(draft.publishedAt) })}{" "}
              <Link href={`/admin/${draft.publishedZevId}`} className="font-medium text-primary-ink underline underline-offset-2">{t("onboarding.adminDraft.openZev")}</Link>
            </>
          ) : draft.status === "DISCARDED" ? t("onboarding.adminDraft.discarded") : t("onboarding.adminDraft.readOnly")}
        </p>
        <Card title={t("onboarding.adminDraft.stepsTitle")}>
          <PreconditionList items={steps.map((s) => ({ ok: s.complete, text: s.label }))} />
        </Card>
        <OnboardingSummary data={draft.data} editable={false} />
        {draft.status === "IN_PROGRESS" && (
          <Card>
            <ConfirmAction
              trigger={t("onboarding.adminDraft.discard")}
              title={tf("onboarding.adminDraft.discardTitle", { naziv: draft.data.zev.legalName || draft.invite.workingName })}
              body={<p className="text-sm text-amber-900">{t("onboarding.adminDraft.discardBody")}</p>}
              confirmLabel={t("onboarding.adminDraft.discardLabel")}
              action={discardAction}
              hiddenFields={{ draftId: draft.id }}
            >
              <Field label={t("onboarding.adminDraft.reason")}>
                <input name="reason" required className={inputCls} />
              </Field>
            </ConfirmAction>
          </Card>
        )}
      </div>
    </div>
  );
}
