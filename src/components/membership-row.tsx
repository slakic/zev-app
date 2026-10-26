"use client";
// Red tabele „Nalozi u ovom ZEV-u” (admin › ZEV detalj) sa potvrdom uklanjanja pristupa koja se
// otvara u PUNOJ ŠIRINI ispod reda (F9, X-R15) — isti obrazac kao building-row.tsx: mali klijentski
// otok, red sa `colSpan` ispod. Prije toga je `ConfirmAction` živio u ćeliji „Radnje”, pa je panel
// bio odsječen na 1440px. Sama radnja ostaje serverska (`revokeAction`) i server je provjerava.
import { useState } from "react";
import { Td, StatusBadge, RowAction, Btn, Field, inputCls, ConfirmPanel } from "@/components/ui";
import { t, tf } from "@/lib/i18n";

export type MembershipRowData = {
  userId: string;
  role: string;
  roleLabel: string;
  email: string;
  isPlatformAdmin: boolean;
  accountActive: boolean;
  since: string;
};

export function MembershipRow({
  zevId,
  zevName,
  membership: m,
  isMe,
  colSpan,
  revokeAction,
  enterAction,
}: {
  zevId: string;
  zevName: string;
  membership: MembershipRowData;
  /** Red je sopstveni pristup super admina: drugačiji naziv radnje i tekst potvrde. */
  isMe: boolean;
  colSpan: number;
  revokeAction: (formData: FormData) => void | Promise<void>;
  enterAction: (formData: FormData) => void | Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const trigger = isMe ? t("tenant.removeMyAccess") : t("tenant.revokeAccess");
  return (
    <>
      <tr className={open ? "bg-slate-50" : undefined}>
        <Td>
          {m.email}
          {m.isPlatformAdmin && (
            <span className="ml-2">
              <StatusBadge status="PLATFORM_ADMIN" label={t("tenant.platformAdmin")} />
            </span>
          )}
        </Td>
        <Td>{m.roleLabel}</Td>
        <Td>
          <StatusBadge
            status={m.accountActive ? "ACTIVE" : "SUSPENDED"}
            label={m.accountActive ? t("admin.detail.accountActive") : t("admin.detail.accountInactive")}
          />
        </Td>
        <Td>{m.since}</Td>
        <Td>
          <div className="flex flex-wrap items-center gap-1.5">
            {isMe && (
              <form action={enterAction}>
                <input type="hidden" name="zevId" value={zevId} />
                <RowAction type="submit">{t("tenant.enterThisZev")}</RowAction>
              </form>
            )}
            <RowAction type="button" variant="caution" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
              {open ? t("admin.detail.revoke.close") : trigger}
            </RowAction>
          </div>
        </Td>
      </tr>
      {open && (
        <tr className="bg-slate-50">
          <td colSpan={colSpan} className="border-t border-slate-100 px-4 py-4">
            <ConfirmPanel
              title={isMe ? t("confirm.removeAccess.title") : t("admin.detail.revoke.title")}
              body={
                <p className="text-sm text-amber-950">
                  {isMe
                    ? tf("confirm.removeAccess.body", { naziv: zevName, uloga: m.roleLabel })
                    : tf("admin.detail.revoke.body", { korisnik: m.email, uloga: m.roleLabel })}
                </p>
              }
              confirmLabel={isMe ? t("confirm.removeAccess.confirm") : trigger}
              confirmVariant="caution"
              action={revokeAction}
              hiddenFields={{ zevId, userId: m.userId, role: m.role }}
              footer={<Btn type="button" onClick={() => setOpen(false)}>{t("admin.detail.revoke.cancel")}</Btn>}
            >
              <Field label={t("confirm.removeAccess.reasonLabel")}>
                <input name="reason" required className={inputCls} />
              </Field>
            </ConfirmPanel>
          </td>
        </tr>
      )}
    </>
  );
}
