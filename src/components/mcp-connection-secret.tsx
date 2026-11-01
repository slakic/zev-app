"use client";
// Jednokratni prikaz podataka za povezivanje asistenta (mockup X-M05 ⑥⑦): adresa servera i token, svaki u polju
// samo za čitanje sa „Kopiraj", pa uputstvo za izabranog asistenta. Token postoji samo u ovom odgovoru servera —
// ne čuva se i ne ide u adresu stranice (obrazac `InviteLink`). Sve stoji u jednoj kartici stranice, bez
// ugniježđenih kartica; „Gotovo" (sakriva token i vraća formu) je `secondary` jer je jedino `primary` bilo „Napravi vezu".
import { useState } from "react";
import { Btn, inputCls } from "@/components/ui";
import { t } from "@/lib/i18n";

type Client = "CLAUDE" | "OPENAI" | "OTHER";

export function CopyField({ label, value, hint }: { label: string; value: string; hint?: string }) {
  const [copied, setCopied] = useState(false);
  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Bez Clipboard API-ja (nesiguran kontekst) vrijednost se i dalje može označiti i kopirati ručno.
    }
  }
  return (
    <div>
      <span className="text-sm font-medium text-slate-700">{label}</span>
      <div className="mt-1 flex max-w-3xl flex-wrap items-center gap-2">
        <label className="min-w-0 flex-1">
          <span className="sr-only">{label}</span>
          <input readOnly value={value} onFocus={(e) => e.currentTarget.select()} className={`${inputCls} bg-slate-50 font-mono text-[13px]`} />
        </label>
        <Btn type="button" variant="tonal" onClick={copy}>{t("assistants.secret.copy")}</Btn>
        <span aria-live="polite" className="text-[13px] text-slate-600">{copied ? t("assistants.secret.copied") : ""}</span>
      </div>
      {hint && <p className="mt-1 text-[13px] text-slate-500">{hint}</p>}
    </div>
  );
}

const pre = "mt-1 overflow-x-auto rounded-lg border border-slate-200 bg-slate-50 p-3 font-mono text-[13px] text-slate-800";

export function McpConnectionSecret({
  serverUrl, token, client, oauthEnabled = false, onDone,
}: { serverUrl: string; token: string; client: Client; oauthEnabled?: boolean; onDone: () => void }) {
  return (
    <div className="space-y-5">
      <div>
        <p className="text-sm font-semibold text-slate-700">{t("assistants.secret.title")}</p>
        <p className="mt-1 max-w-[68ch] text-sm text-slate-700">{t("assistants.secret.body")}</p>
      </div>
      <div className="space-y-3">
        <CopyField label={t("assistants.secret.serverUrl")} value={serverUrl} />
        <CopyField label={t("assistants.secret.token")} value={token} hint={t("assistants.secret.tokenWarning")} />
      </div>

      <div className="border-t border-slate-100 pt-4">
        <p className="text-sm font-semibold text-slate-700">{t("assistants.howTo.title")}</p>
        {client === "CLAUDE" && (
          <div className="mt-2 grid gap-4 md:grid-cols-2">
            <div>
              <p className="text-sm font-medium text-slate-700">{t("assistants.howTo.claudeCode")}</p>
              <p className="mt-1 text-sm text-slate-700">{t("assistants.howTo.claudeCodeIntro")}</p>
              <pre className={pre}>{`claude mcp add --transport http zev-upravnik \\\n  ${serverUrl} \\\n  --header "Authorization: Bearer ${token}"`}</pre>
            </div>
            <div>
              <p className="text-sm font-medium text-slate-700">{t("assistants.howTo.claudeApps")}</p>
              <p className="mt-1 text-sm text-slate-700">{t(oauthEnabled ? "assistants.howTo.claudeAppsBodyOAuth" : "assistants.howTo.claudeAppsBody")}</p>
            </div>
          </div>
        )}
        {client === "OPENAI" && (
          <div className="mt-2">
            <p className="text-sm font-medium text-slate-700">{t("assistants.howTo.openai")}</p>
            <p className="mt-1 max-w-[68ch] text-sm text-slate-700">{t("assistants.howTo.openaiBody")}</p>
          </div>
        )}
        {client === "OTHER" && (
          <div className="mt-2">
            <p className="text-sm font-medium text-slate-700">{t("assistants.howTo.other")}</p>
            <p className="mt-1 max-w-[68ch] text-sm text-slate-700">{t("assistants.howTo.otherBody")}</p>
          </div>
        )}
      </div>

      <div className="border-t border-slate-100 pt-4">
        <Btn type="button" variant="secondary" onClick={onDone}>{t("assistants.secret.done")}</Btn>
      </div>
    </div>
  );
}
