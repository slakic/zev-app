// /oauth/authorize — ekran saglasnosti OAuth-a za MCP (Plans/mcp-platforma-plan.md §5). Ovdje korisnik (u pregledniku,
// sa sesijom) odlučuje šta asistent smije. Redoslijed: 1) provjera klijenta i povratne adrese (greška se prikazuje,
// nikad ne preusmjerava), 2) greške zahtjeva idu klijentu, 3) neprijavljen korisnik ide na /login i vraća se ovamo.
// Iza MCP_OAUTH_ENABLED (inače 404).
import { notFound, redirect } from "next/navigation";
import { getAuthContext } from "@/server/auth/session";
import { requireActor } from "@/server/actor";
import { listOfferedScopes } from "@/server/services/mcpConnections";
import { validateAuthorizeRequest, type AuthorizeParams } from "@/server/mcp/oauth/authorize";
import { oauthEnabled } from "@/server/mcp/oauth/http";
import { isLoopbackRedirect, redirectHost } from "@/lib/mcp/oauth";
import { AuthShell } from "@/components/auth-shell";
import { McpOAuthConsentForm } from "@/components/mcp-oauth-consent-form";
import { t } from "@/lib/i18n";

export const dynamic = "force-dynamic";

const KEYS = ["client_id", "redirect_uri", "response_type", "state", "code_challenge", "code_challenge_method", "resource", "scope"] as const;
const ERR_CODES = ["scope", "name", "days", "request", "other"];

export default async function OAuthAuthorizePage({ searchParams }: { searchParams: Promise<AuthorizeParams> }) {
  if (!oauthEnabled()) notFound();
  const sp = await searchParams;

  const v = await validateAuthorizeRequest(sp);
  if (!v.ok && v.mode === "render") {
    return (
      <AuthShell pageTitle={t("oauth.error.title")} width="wide">
        <p className="text-sm text-slate-700">{t(`oauth.error.${v.reason}`)}</p>
        <p className="mt-2 text-[13px] text-slate-500">{t("oauth.error.hint")}</p>
      </AuthShell>
    );
  }
  if (!v.ok) redirect(v.url);

  // Neprijavljen: na prijavu i nazad na tačno ovaj zahtjev (login prihvata samo /oauth/authorize kao `next`).
  const qs = new URLSearchParams();
  for (const k of KEYS) {
    const val = sp[k];
    if (typeof val === "string") qs.set(k, val);
  }
  if (!(await getAuthContext())) redirect(`/login?next=${encodeURIComponent(`/oauth/authorize?${qs.toString()}`)}`);

  const actor = await requireActor();
  const offered = await listOfferedScopes(actor);
  const { req } = v;
  const err = typeof sp.err === "string" && ERR_CODES.includes(sp.err) ? sp.err : undefined;
  return (
    <AuthShell pageTitle={t("oauth.consent.title")} width="wide">
      <McpOAuthConsentForm
        params={{
          client_id: req.client.clientId,
          redirect_uri: req.redirectUri,
          response_type: "code",
          code_challenge: req.codeChallenge,
          code_challenge_method: "S256",
          state: req.state,
          resource: typeof sp.resource === "string" ? sp.resource : undefined,
        }}
        clientName={req.client.clientName}
        redirectHost={redirectHost(req.redirectUri)}
        localhost={isLoopbackRedirect(req.redirectUri)}
        email={actor.email}
        offered={offered.map((o) => ({ key: o.key, label: o.label }))}
        errCode={err}
      />
    </AuthShell>
  );
}
