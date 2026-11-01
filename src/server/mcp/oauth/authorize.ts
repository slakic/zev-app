// Autorizacija (ekran saglasnosti) OAuth-a za MCP (Plans/mcp-platforma-plan.md §5). Parametre zahtjeva
// provjerava validateAuthorizeRequest — i pri prikazu stranice i pri odluci korisnika, jer skrivena polja
// forme dolaze iz preglednika pa im se ne vjeruje. Redoslijed je bitan: dok klijent i povratna adresa
// nisu provjereni, greška se NIKAD ne šalje preusmjeravanjem (otvoreni redirect), nego se prikazuje.
import { prisma } from "@/lib/prisma";
import type { Actor } from "@/server/auth/guards";
import { generateToken, sha256 } from "@/server/auth/tokens";
import { getEnv } from "@/lib/env";
import {
  CODE_CHALLENGE,
  OAUTH_CODE_TTL_MS,
  appendAuthResponse,
  canonicalResource,
  issuerOf,
  redirectUriMatches,
  resourceMatches,
} from "@/lib/mcp/oauth";
import { connectionDaysSchema, connectionNameSchema, resolveScopesForKey } from "@/server/services/mcpConnections";
import { resolveClient, touchClient, type ResolvedClient } from "@/server/mcp/oauth/clients";
import { t } from "@/lib/i18n";

/** Parametri kako stižu iz upita stranice ili iz skrivenih polja forme. */
export type AuthorizeParams = Record<string, string | string[] | undefined>;

export type ValidatedAuthorizeRequest = {
  client: ResolvedClient;
  redirectUri: string;
  state: string | undefined;
  codeChallenge: string;
  resource: string;
};

export type AuthorizeValidation =
  | { ok: true; req: ValidatedAuthorizeRequest }
  | { ok: false; mode: "render"; reason: "invalid_client" | "invalid_redirect_uri" }
  | { ok: false; mode: "redirect"; url: string };

/** Jedna vrijednost ili undefined; ponovljen parametar (niz) se tretira kao neispravan. */
function single(v: string | string[] | undefined): string | undefined | null {
  if (Array.isArray(v)) return null;
  return v;
}

export async function validateAuthorizeRequest(params: AuthorizeParams): Promise<AuthorizeValidation> {
  const appUrl = getEnv().APP_URL;
  const clientIdRaw = single(params.client_id);
  const redirectRaw = single(params.redirect_uri);

  // a/b/c: klijent i povratna adresa. Bilo koja greška ovdje je prikaz, ne preusmjeravanje.
  if (!clientIdRaw) return { ok: false, mode: "render", reason: "invalid_client" };
  const client = await resolveClient(clientIdRaw);
  if (!client) return { ok: false, mode: "render", reason: "invalid_client" };
  if (!redirectRaw) return { ok: false, mode: "render", reason: "invalid_redirect_uri" };
  // Koristi se REGISTROVANA adresa kad je tačna; za lokalni računar tražena (sa svojim portom) jer je i klijent
  // na tom portu. Obje su prošle isti spisak.
  const registered = client.redirectUris.find((r) => redirectUriMatches(r, redirectRaw));
  if (!registered) return { ok: false, mode: "render", reason: "invalid_redirect_uri" };
  const redirectUri = redirectRaw;

  // d: od ovog trenutka greške idu klijentu, sa `state` i `iss` (RFC 9207).
  const stateRaw = single(params.state);
  const state = stateRaw === null || (stateRaw !== undefined && stateRaw.length > 2048) ? null : stateRaw;
  const iss = issuerOf(appUrl);
  const errorRedirect = (error: string, description: string): AuthorizeValidation => ({
    ok: false,
    mode: "redirect",
    url: appendAuthResponse(redirectUri, { error, error_description: description, state: state ?? undefined, iss }),
  });
  if (state === null) return errorRedirect("invalid_request", "Parametar state nije ispravan.");

  if (single(params.response_type) !== "code") return errorRedirect("unsupported_response_type", "Podržan je samo response_type=code.");
  const challenge = single(params.code_challenge);
  if (!challenge || !CODE_CHALLENGE.test(challenge) || single(params.code_challenge_method) !== "S256") {
    return errorRedirect("invalid_request", "Obavezan je PKCE: code_challenge sa code_challenge_method=S256.");
  }
  const resourceRaw = single(params.resource);
  if (resourceRaw === null) return errorRedirect("invalid_request", "Parametar resource nije ispravan.");
  if (resourceRaw !== undefined && !resourceMatches(resourceRaw, appUrl)) return errorRedirect("invalid_target", "Nepoznat resource.");

  // e: `scope` se ne razmatra — stvarna ovlašćenja bira korisnik na ekranu saglasnosti.
  return { ok: true, req: { client, redirectUri, state: state ?? undefined, codeChallenge: challenge, resource: canonicalResource(appUrl) } };
}

export type ConsentInput = { name: string; scopeKey: string; days: number | string };

/**
 * Korisnik je dozvolio. Izdaje jednokratni kod (5 minuta, u bazi samo sha256) i vraća adresu za preusmjeravanje na
 * klijenta. Veza (McpConnection) se ovdje NE pravi — nastaje tek razmjenom koda, da napuštena saglasnost ne ostavlja vezu.
 */
export async function approveAuthorization(actor: Actor, params: AuthorizeParams, input: ConsentInput): Promise<string> {
  const v = await validateAuthorizeRequest(params);
  if (!v.ok) {
    if (v.mode === "redirect") return v.url;
    throw new Error(t(`oauth.error.${v.reason}`));
  }
  const name = connectionNameSchema.safeParse(input.name);
  if (!name.success) throw new Error(name.error.issues[0]?.message ?? t("assistants.errors.invalid"));
  const days = connectionDaysSchema.safeParse(input.days);
  if (!days.success) throw new Error(days.error.issues[0]?.message ?? t("assistants.errors.invalid"));
  // Isto pravilo kao pri ručnom pravljenju veze: opseg se izvodi iz baze, ne iz forme.
  const scopes = await resolveScopesForKey(actor, String(input.scopeKey).slice(0, 100));

  const code = generateToken(32);
  await prisma.mcpOAuthCode.create({
    data: {
      codeHash: sha256(code),
      clientId: v.req.client.id,
      userId: actor.userId,
      redirectUri: v.req.redirectUri,
      codeChallenge: v.req.codeChallenge,
      resource: v.req.resource,
      scopes,
      connectionName: name.data,
      days: days.data,
      expiresAt: new Date(Date.now() + OAUTH_CODE_TTL_MS),
    },
  });
  touchClient(v.req.client.id);
  return appendAuthResponse(v.req.redirectUri, { code, state: v.req.state, iss: issuerOf(getEnv().APP_URL) });
}

/** Korisnik je odbio: klijent dobija `access_denied`. Ništa se ne upisuje. */
export async function denyAuthorization(params: AuthorizeParams): Promise<string> {
  const v = await validateAuthorizeRequest(params);
  if (!v.ok) {
    if (v.mode === "redirect") return v.url;
    throw new Error(t(`oauth.error.${v.reason}`));
  }
  return appendAuthResponse(v.req.redirectUri, { error: "access_denied", state: v.req.state, iss: issuerOf(getEnv().APP_URL) });
}
