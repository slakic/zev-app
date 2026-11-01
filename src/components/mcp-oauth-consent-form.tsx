// Ekran saglasnosti OAuth-a (/oauth/authorize), forma „Dozvoli / Odbij". Običan server obrazac (bez klijentskog
// JS-a): odluka ide u mcpOAuthDecisionAction, koji sve skrivene parametre ponovo provjerava. Opcije opsega su iste kao
// na /nalog/asistenti (mcp-scope-options). „Dozvoli" je jedino `primary` dugme; „Odbij" je `secondary`.
import { ChoiceCards, Field, Flash, SubmitBtn, inputCls } from "@/components/ui";
import { buildScopeOptions, defaultScopeKey } from "@/components/mcp-scope-options";
import { mcpOAuthDecisionAction, mcpOAuthSwitchAccountAction } from "@/server/actions/mcpOAuth";
import { MCP_EXPIRY_DAYS } from "@/lib/mcp/scopes";
import { t, tf } from "@/lib/i18n";

export type ConsentParams = Record<"client_id" | "redirect_uri" | "code_challenge" | "code_challenge_method" | "response_type", string> & {
  state?: string;
  resource?: string;
};

function Hidden({ params }: { params: ConsentParams }) {
  return (
    <>
      {Object.entries(params).map(([k, v]) => (v === undefined ? null : <input key={k} type="hidden" name={k} value={v} />))}
    </>
  );
}

export function McpOAuthConsentForm({
  params, clientName, redirectHost, localhost, email, offered, errCode,
}: {
  params: ConsentParams;
  clientName: string;
  redirectHost: string;
  localhost: boolean;
  email: string;
  offered: { key: string; label: string; via?: "OWNER" | "ADMIN" }[];
  errCode?: string;
}) {
  return (
    <div className="space-y-4">
      {errCode && <Flash err={t(`oauth.consent.errors.${errCode}`)} inset />}
      <div className="space-y-1.5 text-sm text-slate-700">
        <p>{tf("oauth.consent.intro", { klijent: clientName })}</p>
        <p>
          {t("oauth.consent.returnTo")} <strong className="font-semibold text-slate-900">{redirectHost}</strong>
        </p>
      </div>
      {localhost && <Flash warn={t("oauth.consent.localhost")} inset />}

      <form action={mcpOAuthSwitchAccountAction} className="text-[13px] text-slate-600">
        <Hidden params={params} />
        {tf("oauth.consent.signedIn", { email })}{" "}
        <button type="submit" className="text-blue-700 hover:underline">{t("oauth.consent.switchAccount")}</button>
      </form>

      <form action={mcpOAuthDecisionAction} className="space-y-4 border-t border-slate-100 pt-4">
        <Hidden params={params} />
        <Field label={t("assistants.form.name")} hint={t("assistants.form.nameHint")}>
          <input name="name" required maxLength={80} defaultValue={clientName.slice(0, 80)} className={inputCls} />
        </Field>
        <ChoiceCards name="scopeKey" legend={t("assistants.form.scope")} options={buildScopeOptions(offered)} defaultValue={defaultScopeKey(offered)} />
        <Field label={t("assistants.form.days")} hint={t("assistants.form.daysHint")}>
          <select name="days" className={inputCls} defaultValue="30">
            {MCP_EXPIRY_DAYS.map((d) => (
              <option key={d} value={d}>{tf("assistants.form.daysOption", { n: d })}</option>
            ))}
          </select>
        </Field>
        <p className="text-[13px] text-slate-500">{t("oauth.consent.note")}</p>
        <div className="flex flex-wrap gap-2 border-t border-slate-100 pt-4">
          <SubmitBtn name="decision" value="allow">{t("oauth.consent.allow")}</SubmitBtn>
          <SubmitBtn name="decision" value="deny" variant="secondary">{t("oauth.consent.deny")}</SubmitBtn>
        </div>
      </form>
    </div>
  );
}
