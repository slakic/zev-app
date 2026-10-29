"use client";
// Red tabele „Pozivi i nacrti" na /admin (mockup O-M01 ④⑤⑥). Potvrde „Izdaj novi link" i „Opozovi
// poziv" se otvaraju u punoj širini ispod reda (obrazac membership-row.tsx). Novi link se prikazuje
// jednom, u istom panelu, iz stanja akcije — nikad kroz adresu stranice.
import { useActionState, useState } from "react";
import { ConfirmPanel, Field, Flash, RowAction, RowActionLink, StatusBadge, Td, inputCls } from "@/components/ui";
import { InviteLink } from "@/components/invite-link";
import { reissueInviteAction, revokeInviteAction, type InviteLinkState } from "@/server/actions/onboarding";
import { t, tf } from "@/lib/i18n";

export type InviteRowData = {
  id: string;
  email: string;
  workingName: string;
  tierLabel: string;
  state: "ACTIVE" | "EXPIRED" | "REVOKED" | "IN_PROGRESS" | "PUBLISHED" | "DISCARDED";
  progress: string;
  progressMeta: string;
  updated: string;
  /** Rok novog linka, za tekst potvrde. */
  newValidUntil: string;
  /** Nacrt (u toku ili zatvoren) — „Pregled nacrta”. */
  draftId: string | null;
};

const STATE_CHIP: Record<InviteRowData["state"], { status: string; labelKey: string }> = {
  ACTIVE: { status: "INVITE_ACTIVE", labelKey: "onboarding.list.stateActive" },
  EXPIRED: { status: "INVITE_EXPIRED", labelKey: "onboarding.list.stateExpired" },
  REVOKED: { status: "INVITE_REVOKED", labelKey: "onboarding.list.stateRevoked" },
  IN_PROGRESS: { status: "DRAFT_IN_PROGRESS", labelKey: "onboarding.list.stateInProgress" },
  PUBLISHED: { status: "DRAFT_PUBLISHED", labelKey: "onboarding.list.statePublished" },
  DISCARDED: { status: "INVITE_REVOKED", labelKey: "onboarding.list.stateRevoked" },
};

export function InviteRow({ row, colSpan }: { row: InviteRowData; colSpan: number }) {
  const [open, setOpen] = useState<null | "reissue" | "revoke">(null);
  const [state, reissueAction, pending] = useActionState<InviteLinkState, FormData>(reissueInviteAction, { status: "idle" });
  const canReissue = row.state === "ACTIVE" || row.state === "EXPIRED";
  const canRevoke = row.state === "ACTIVE";
  const chip = STATE_CHIP[row.state];
  const toggle = (which: "reissue" | "revoke") => setOpen((v) => (v === which ? null : which));
  return (
    <>
      <tr className={open ? "bg-slate-50" : undefined}>
        <Td>
          <span className="font-medium text-slate-900">{row.workingName}</span>
          <div className="text-[13px] text-slate-500">{row.email}</div>
        </Td>
        <Td>{row.tierLabel}</Td>
        <Td><StatusBadge status={chip.status} label={t(chip.labelKey)} /></Td>
        <Td>
          {row.progress}
          {row.progressMeta && <div className="text-[13px] text-slate-500">{row.progressMeta}</div>}
        </Td>
        <Td>{row.updated}</Td>
        <Td>
          <div className="flex flex-wrap items-center gap-1.5">
            {row.draftId && <RowActionLink href={`/admin/nacrti/${row.draftId}`}>{t("onboarding.adminDraft.view")}</RowActionLink>}
            {canReissue && (
              <RowAction type="button" variant="caution" aria-expanded={open === "reissue"} onClick={() => toggle("reissue")}>
                {open === "reissue" ? t("onboarding.list.close") : t("onboarding.list.reissue")}
              </RowAction>
            )}
            {canRevoke && (
              <RowAction type="button" variant="caution" aria-expanded={open === "revoke"} onClick={() => toggle("revoke")}>
                {open === "revoke" ? t("onboarding.list.close") : t("onboarding.list.revoke")}
              </RowAction>
            )}
          </div>
        </Td>
      </tr>
      {open === "reissue" && (
        <tr className="bg-slate-50">
          <td colSpan={colSpan} className="border-t border-slate-100 px-4 py-4">
            {state.status === "ok" ? (
              <div className="space-y-3">
                <Flash msg={tf("onboarding.newPage.reissued", { datum: state.validUntil })} inset />
                <InviteLink link={state.link} email={state.email} inset />
              </div>
            ) : (
              <>
                {state.status === "error" && <Flash err={state.error} inset />}
                <ConfirmPanel
                  title={tf("onboarding.list.reissueTitle", { email: row.email })}
                  body={<p className="text-sm text-amber-900">{tf("onboarding.list.reissueBody", { datum: row.newValidUntil })}</p>}
                  confirmLabel={t("onboarding.list.reissueConfirm")}
                  confirmDisabled={pending}
                  action={reissueAction}
                  hiddenFields={{ inviteId: row.id }}
                />
              </>
            )}
          </td>
        </tr>
      )}
      {open === "revoke" && (
        <tr className="bg-slate-50">
          <td colSpan={colSpan} className="border-t border-slate-100 px-4 py-4">
            <ConfirmPanel
              title={tf("onboarding.list.revokeTitle", { email: row.email })}
              body={<p className="text-sm text-amber-900">{t("onboarding.list.revokeBody")}</p>}
              confirmLabel={t("onboarding.list.revokeConfirm")}
              action={revokeInviteAction}
              hiddenFields={{ inviteId: row.id }}
            >
              <Field label={t("onboarding.list.reason")}>
                <input name="reason" required className={inputCls} />
              </Field>
            </ConfirmPanel>
          </td>
        </tr>
      )}
    </>
  );
}
