"use server";
// Odluka korisnika na ekranu saglasnosti OAuth-a (/oauth/authorize). Tanak omotač oko servisa: korisnik dolazi
// ISKLJUČIVO iz sesije (requireActor), a svi parametri zahtjeva iz skrivenih polja se ponovo provjeravaju u
// authorize.ts. Preusmjerenje na klijenta (spoljna adresa) ide samo kroz adresu koju je izgradio taj servis.
import { notFound, redirect } from "next/navigation";
import { requireActor } from "@/server/actor";
import { destroySession } from "@/server/auth/session";
import { oauthEnabled } from "@/server/mcp/oauth/http";
import { approveAuthorization, denyAuthorization, type AuthorizeParams } from "@/server/mcp/oauth/authorize";
import { t } from "@/lib/i18n";

const PARAM_KEYS = ["client_id", "redirect_uri", "state", "code_challenge", "code_challenge_method", "response_type", "resource"] as const;

/** Greške se vraćaju kao kratak kod (ne kao tekst u adresi), da se na ekranu saglasnosti ne može prikazati tuđ tekst. */
function errorCode(message: string): string {
  if (message === t("assistants.errors.scopeNotOffered")) return "scope";
  if (message === t("assistants.errors.nameRequired") || message === t("assistants.errors.nameTooLong")) return "name";
  if (message === t("assistants.errors.daysInvalid")) return "days";
  if (message === t("oauth.error.invalid_client") || message === t("oauth.error.invalid_redirect_uri")) return "request";
  return "other";
}

export async function mcpOAuthDecisionAction(formData: FormData): Promise<void> {
  if (!oauthEnabled()) notFound();
  const actor = await requireActor();
  const params: AuthorizeParams = {};
  const qs = new URLSearchParams();
  for (const key of PARAM_KEYS) {
    const v = formData.get(key);
    if (typeof v === "string") {
      params[key] = v;
      qs.set(key, v);
    }
  }

  let target: string;
  try {
    target =
      formData.get("decision") === "allow"
        ? await approveAuthorization(actor, params, {
            name: String(formData.get("name") ?? ""),
            scopeKey: String(formData.get("scopeKey") ?? ""),
            days: String(formData.get("days") ?? ""),
          })
        : await denyAuthorization(params);
  } catch (e) {
    qs.set("err", errorCode(e instanceof Error ? e.message : ""));
    target = `/oauth/authorize?${qs.toString()}`;
  }
  redirect(target);
}

/** „Nisam ja": odjava, pa nazad na prijavu sa povratkom na isti zahtjev (adresa se gradi samo od poznatih parametara). */
export async function mcpOAuthSwitchAccountAction(formData: FormData): Promise<void> {
  if (!oauthEnabled()) notFound();
  const qs = new URLSearchParams();
  for (const key of PARAM_KEYS) {
    const v = formData.get(key);
    if (typeof v === "string") qs.set(key, v);
  }
  await destroySession();
  redirect(`/login?next=${encodeURIComponent(`/oauth/authorize?${qs.toString()}`)}`);
}
