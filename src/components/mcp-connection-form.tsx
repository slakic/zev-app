"use client";
// Forma „Poveži asistenta" na /nalog/asistenti (mockup X-M05 ③④⑤). Posle uspjeha se zamjenjuje jednokratnim
// prikazom tokena — zato je ovo klijentska forma sa useActionState (kao InviteForm). Opseg se bira među
// opsezima koje server nudi; server ga ipak ponovo izvodi i ne vjeruje vrijednosti iz forme.
import { useActionState, useState } from "react";
import { ChoiceCards, Field, Flash, SubmitBtn, inputCls } from "@/components/ui";
import { McpConnectionSecret } from "@/components/mcp-connection-secret";
import { createMcpConnectionAction, type McpConnectionState } from "@/server/actions/mcpConnections";
import { MCP_EXPIRY_DAYS } from "@/lib/mcp/scopes";
import { buildScopeOptions, defaultScopeKey } from "@/components/mcp-scope-options";
import { t, tf } from "@/lib/i18n";

export function McpConnectionForm({
  offered, preselect, oauthEnabled = false,
}: { offered: { key: string; label: string; via?: "OWNER" | "ADMIN" }[]; /** Opseg iz adrese (već provjeren da je među ponuđenima). */ preselect?: string; oauthEnabled?: boolean }) {
  const [state, formAction, pending] = useActionState<McpConnectionState, FormData>(createMcpConnectionAction, { status: "idle" });
  // „Gotovo, sakrij token" ne smije biti link na istu adresu: soft navigacija čuva stanje klijentske
  // komponente, pa bi token ostao na ekranu. Zato se sakriveni token pamti po vrijednosti.
  const [hiddenToken, setHiddenToken] = useState<string | null>(null);
  if (state.status === "ok" && state.token !== hiddenToken) {
    return (
      <div className="space-y-4">
        <Flash msg={tf("assistants.created", { naziv: state.name, datum: state.validUntil })} inset />
        <McpConnectionSecret serverUrl={state.serverUrl} token={state.token} client={state.client} oauthEnabled={oauthEnabled} onDone={() => setHiddenToken(state.token)} />
      </div>
    );
  }
  const options = buildScopeOptions(offered);
  return (
    <form action={formAction} className="space-y-4">
      {state.status === "error" && <Flash err={state.error} inset />}
      <div className="grid gap-4 md:grid-cols-2">
        <Field label={t("assistants.form.name")} hint={t("assistants.form.nameHint")}>
          <input name="name" required maxLength={80} className={inputCls} />
        </Field>
        <Field label={t("assistants.form.client")} hint={t("assistants.form.clientHint")}>
          <select name="client" className={inputCls} defaultValue="CLAUDE">
            {(["CLAUDE", "OPENAI", "OTHER"] as const).map((c) => (
              <option key={c} value={c}>{t(`assistants.form.clients.${oauthEnabled && c === "CLAUDE" ? "CLAUDE_TOKEN" : c}`)}</option>
            ))}
          </select>
        </Field>
      </div>
      <ChoiceCards name="scopeKey" legend={t("assistants.form.scope")} options={options} defaultValue={defaultScopeKey(offered, preselect)} />
      <div className="grid gap-4 md:grid-cols-2">
        <Field label={t("assistants.form.days")} hint={t("assistants.form.daysHint")}>
          <select name="days" className={inputCls} defaultValue="30">
            {MCP_EXPIRY_DAYS.map((d) => (
              <option key={d} value={d}>{tf("assistants.form.daysOption", { n: d })}</option>
            ))}
          </select>
        </Field>
      </div>
      <div className="border-t border-slate-100 pt-4">
        <SubmitBtn disabled={pending}>{t("assistants.form.submit")}</SubmitBtn>
      </div>
    </form>
  );
}
