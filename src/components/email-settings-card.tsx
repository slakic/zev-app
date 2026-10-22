"use client";
// Platform e-mail settings in /admin (Plans/email-sender-name-and-test-email-plan.md, odluke P1 i
// P3): the sender display name, whether a ZEV's messages add the ZEV's name to it, and the go-live
// allowlist. Saved through a server action that returns { ok } (same pattern as test-email-card).
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { saveEmailSettingsAction } from "@/server/actions/notifications";
import type { AdminEmailSettings } from "@/server/services/platformSettings";
import { buildFromName } from "@/lib/emailFromName";
import { Card, Field, inputCls, btnBase, btnVariantCls } from "@/components/ui";

const okCls = "rounded-xl border-l-4 border-l-emerald-500 bg-emerald-50 px-3 py-2.5 text-sm text-emerald-800 shadow-sm";
const errCls = "rounded-xl border-l-4 border-l-red-500 bg-red-50 px-3 py-2.5 text-sm text-red-800 shadow-sm";

export function EmailSettingsCard({ settings }: { settings: AdminEmailSettings }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [fromName, setFromName] = useState(settings.fromName ?? "");
  const [appendZevName, setAppendZevName] = useState(settings.appendZevName);
  const [allowlist, setAllowlist] = useState(settings.recipientAllowlist.join("\n"));
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);

  const base = fromName.trim() || settings.provider.defaultFromName;
  const example = appendZevName ? buildFromName(base, { shortName: "Kneza Miloša 12", legalName: "" }) : base;
  const allowlistOn = allowlist.trim().length > 0;

  function save(e: React.FormEvent) {
    e.preventDefault();
    setResult(null);
    startTransition(async () => {
      const res = await saveEmailSettingsAction({ fromName, appendZevName, recipientAllowlist: allowlist });
      setResult(res.ok ? { ok: true, text: "Sačuvano." } : { ok: false, text: res.error });
      if (res.ok) router.refresh();
    });
  }

  return (
    <Card title="E-mail podešavanja platforme" hint="Važe za sve ZEV naloge.">
      <form onSubmit={save} className="space-y-3">
        <Field label="Ime pošiljaoca" hint={`Prazno = „${settings.provider.defaultFromName}”`}>
          <input value={fromName} onChange={(e) => setFromName(e.target.value)} maxLength={60} className={inputCls} />
        </Field>
        <label className="flex items-start gap-2 text-sm text-slate-700">
          <input
            type="checkbox"
            checked={appendZevName}
            onChange={(e) => setAppendZevName(e.target.checked)}
            className="mt-0.5 h-4 w-4 rounded border-slate-300"
          />
          <span>Poruke jednog ZEV-a nose i naziv tog ZEV-a</span>
        </label>
        <p className="text-[13px] text-slate-500">
          Primalac vidi: <span className="font-medium text-slate-700">{example}</span>
        </p>

        <Field
          label="Probni period: slanje samo na ove adrese"
          hint="Jedna adresa ili @domen po redu. Dok lista nije prazna, stvarna e-pošta ide samo njima; ostale poruke se ne šalju. Prazno = svima."
        >
          <textarea
            value={allowlist}
            onChange={(e) => setAllowlist(e.target.value)}
            rows={3}
            className={inputCls}
            placeholder={"vi@primjer.ba\n@zevupravnik.com"}
          />
        </Field>
        {allowlistOn && (
          <p className="text-[13px] text-amber-800">
            Probni period je uključen: pozivi za glasanje i ostale poruke vlasnicima van liste se ne šalju i ne šalju se ni
            kasnije.
          </p>
        )}

        <button type="submit" disabled={pending} className={`${btnBase} ${btnVariantCls.tonal}`}>
          {pending ? "Čuvam…" : "Sačuvaj"}
        </button>
        {result && (
          <div role={result.ok ? "status" : "alert"} className={result.ok ? okCls : errCls}>
            {result.text}
          </div>
        )}
      </form>
    </Card>
  );
}
