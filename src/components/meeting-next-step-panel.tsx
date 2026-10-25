// "Sljedeći korak" panel of the meeting detail page (F6.2, design-review D2 option A — a composition of existing
// pieces, not a new primitive): Card + StatusTimeline + one sentence of consequence + PreconditionList + exactly one
// button. The confirmation texts of invitations / opening / closing moved here unchanged from the page header; the
// finalization of the minutes got its own (new: it is irreversible). ⚠ preconditions never block the button; only
// `kind: "blocked"` (the service would refuse the step) hides it. Server component: `action` is the page's server action.
import type { ReactNode } from "react";
import { Card, StatusTimeline, SubmitBtn, ConfirmAction, RowLink } from "@/components/ui";
import { PreconditionList } from "@/components/precondition-list";
import { formatDateTime, tEnum, t, tf } from "@/lib/i18n";
import type { MeetingNextStep, MeetingNextStepInput } from "@/lib/meetingNextStep";
import type { MeetingStatus } from "@/generated/prisma/client";

export const MEETING_STATUS_ORDER: MeetingStatus[] = [
  "DRAFT", "SCHEDULED", "INVITATIONS_PREPARED", "INVITATIONS_SENT", "VOTING_OPEN",
  "VOTING_CLOSED", "RESULTS_REVIEW", "DECISION_RECORDED", "MINUTES_FINALIZED", "ARCHIVED",
];

export function MeetingTimeline({ status }: { status: MeetingStatus }) {
  return (
    <StatusTimeline
      steps={MEETING_STATUS_ORDER.map((s) => ({ key: s, label: tEnum("meetingStatus", s) }))}
      activeKey={status}
    />
  );
}

type SessionOpenPreview = {
  proposals: { id: string; code: string; title: string; preview: { voters: number; withoutEmail: number } | null }[];
  ballots: number;
  remainingToday: number;
};

export function MeetingNextStepPanel({
  meeting, step, input, statusAction, sessionOpen, proposalsToAutoClose,
}: {
  meeting: { id: string; title: string; status: MeetingStatus; scheduledAt: Date | null; location: string | null; body: "ASSEMBLY" | "BOARD" };
  step: MeetingNextStep | null;
  input: MeetingNextStepInput;
  statusAction: (formData: FormData) => void | Promise<void>;
  sessionOpen: SessionOpenPreview | null;
  proposalsToAutoClose: { id: string; code: string; title: string }[];
}) {
  const hidden: Record<string, string> = { meetingId: meeting.id, to: step?.to ?? "" };
  let button: ReactNode = null;

  if (step && step.kind === "plain") {
    button = (
      <form action={statusAction}>
        <input type="hidden" name="meetingId" value={meeting.id} />
        <input type="hidden" name="to" value={step.to} />
        <SubmitBtn>{step.label}</SubmitBtn>
      </form>
    );
  } else if (step && step.kind === "confirm") {
    if (step.to === "VOTING_CLOSED") {
      button = (
        <ConfirmAction
          trigger={step.label}
          triggerVariant="caution"
          title={t("confirm.sessionClose.title")}
          body={
            proposalsToAutoClose.length > 0 ? (
              <div className="space-y-1 text-sm text-amber-950">
                <p>{t("confirm.sessionClose.intro")}</p>
                <ul className="list-disc pl-5">
                  {proposalsToAutoClose.map((p) => (
                    <li key={p.id}>
                      {p.code} — {p.title}
                    </li>
                  ))}
                </ul>
              </div>
            ) : (
              <p className="text-sm text-amber-950">{t("confirm.sessionClose.none")}</p>
            )
          }
          confirmLabel={t("confirm.sessionClose.confirm")}
          action={statusAction}
          hiddenFields={hidden}
        />
      );
    } else if (step.to === "INVITATIONS_SENT" && input.invitations) {
      button = (
        <ConfirmAction
          trigger={t("confirm.invitations.trigger")}
          triggerVariant="caution"
          title={t("confirm.invitations.title")}
          body={
            <div className="space-y-1 text-sm text-amber-950">
              <p>
                {tf("confirm.invitations.body", {
                  naslov: meeting.title,
                  datum: formatDateTime(meeting.scheduledAt),
                  mjesto: meeting.location ?? "—",
                  broj: input.invitations.withEmail,
                  primaoci: meeting.body === "BOARD" ? t("confirm.invitations.board") : t("confirm.invitations.owners"),
                })}
              </p>
              {input.invitations.withoutEmail > 0 && <p>{tf("confirm.invitations.noEmail", { broj: input.invitations.withoutEmail })}</p>}
              <p>{t("confirm.invitations.irreversible")}</p>
            </div>
          }
          confirmLabel={tf("confirm.invitations.confirm", { broj: input.invitations.withEmail })}
          confirmVariant="primary"
          action={statusAction}
          hiddenFields={hidden}
        />
      );
    } else if (step.to === "VOTING_OPEN" && sessionOpen) {
      button = (
        <ConfirmAction
          trigger={step.label}
          triggerVariant="caution"
          title={t("confirm.sessionOpen.title")}
          body={
            <div className="space-y-1 text-sm text-amber-950">
              {sessionOpen.proposals.length === 0 ? (
                <p>{t("confirm.sessionOpen.none")}</p>
              ) : (
                <>
                  <p>{t("confirm.sessionOpen.intro")}</p>
                  <ul className="list-disc space-y-0.5 pl-5">
                    {sessionOpen.proposals.map((p) => (
                      <li key={p.id}>
                        {tf("confirm.sessionOpen.row", {
                          kod: p.code,
                          naslov: p.title,
                          glasaca: p.preview?.voters ?? 0,
                          bez: p.preview?.withoutEmail ?? 0,
                        })}
                      </li>
                    ))}
                  </ul>
                  <p>
                    {tf("confirm.sessionOpen.messages", { broj: sessionOpen.ballots })}{" "}
                    {!Number.isFinite(sessionOpen.remainingToday)
                      ? t("confirm.sessionOpen.limitNone")
                      : sessionOpen.ballots > sessionOpen.remainingToday
                        ? tf("confirm.sessionOpen.limitOver", { preostalo: sessionOpen.remainingToday, visak: sessionOpen.ballots - sessionOpen.remainingToday })
                        : tf("confirm.sessionOpen.limitLeft", { preostalo: sessionOpen.remainingToday })}
                  </p>
                  <p>{t("confirm.sessionOpen.irreversible")}</p>
                </>
              )}
            </div>
          }
          confirmLabel={t("confirm.sessionOpen.confirm")}
          confirmVariant="primary"
          action={statusAction}
          hiddenFields={hidden}
        />
      );
    } else if (step.to === "MINUTES_FINALIZED") {
      button = (
        <ConfirmAction
          trigger={step.label}
          triggerVariant="caution"
          title={t("meetingStep.finalize.title")}
          body={<p className="text-sm text-amber-950">{tf("meetingStep.finalize.body", { naslov: meeting.title })}</p>}
          confirmLabel={t("meetingStep.finalize.confirm")}
          confirmVariant="primary"
          action={statusAction}
          hiddenFields={hidden}
        />
      );
    }
  }

  return (
    <Card title={t("meetingStep.title")} className="mb-4">
      <MeetingTimeline status={meeting.status} />
      <p className="text-sm font-medium text-slate-800">{tf("meetingStep.now", { status: tEnum("meetingStatus", meeting.status) })}</p>
      {step && (
        <div className="mt-2 space-y-3">
          <p className="max-w-[68ch] text-sm text-slate-700">{step.consequence}</p>
          {step.preconditions.length > 0 && (
            <PreconditionList
              items={step.preconditions.map((p) => ({ ok: p.ok, text: p.href ? <RowLink href={p.href}>{p.text}</RowLink> : p.text }))}
            />
          )}
          {button}
        </div>
      )}
    </Card>
  );
}
