// OAuth 2.1 za MCP server — čista logika bez servera i baze (Plans/mcp-platforma-plan.md §5, Faza P-B).
// Ovdje su sve konstante i pravila koja treba provjeriti pogledom: dozvoljene povratne adrese, adrese
// metapodataka, PKCE, kanonski `resource`, bezbjedan `next` za prijavu. Izdavač i resurs se UVIJEK grade
// iz APP_URL (nikad iz Host zaglavlja), pa ih pozivalac prosljeđuje kao argument.
import { createHash } from "node:crypto";
import type { McpClient } from "@/generated/prisma/client";

// ---- Rokovi i prefiksi ----------------------------------------------------------------------------------

export const OAUTH_CODE_TTL_MS = 5 * 60 * 1000;
export const OAUTH_ACCESS_TTL_MS = 60 * 60 * 1000;
/** Ponovni refresh istim tokenom unutar ovog roka poslije rotacije je greška mreže, ne krađa: samo invalid_grant. */
export const OAUTH_REFRESH_REPLAY_GRACE_MS = 60 * 1000;

/** Prefiksi su različiti od starog tokena veze (`zev_mcp_` + 43 znaka), koji nikad ne smije izgledati kao ovi. */
export const OAUTH_ACCESS_PREFIX = "zev_mcp_at_";
export const OAUTH_REFRESH_PREFIX = "zev_mcp_rt_";
export const OAUTH_CLIENT_PREFIX = "zev_cl_";

export const OAUTH_SCOPE = "mcp";
export const OAUTH_SCOPES_SUPPORTED = ["mcp", "offline_access"] as const;

/** Najveći broj povratnih adresa i najveća veličina tijela registracije. */
export const MAX_REDIRECT_URIS = 5;
export const MAX_REGISTRATION_BYTES = 8 * 1024;

/**
 * CIMD (Client ID Metadata Document) je napravljen i testiran, ali se u metapodacima servera NE oglašava dok se
 * ne provjeri na pravom Claude klijentu (odluka D1). Promjena ove konstante je jedino što je potrebno.
 */
export const CIMD_ADVERTISED = false;

/** Samo ovi domaćini smiju biti `client_id` adresa dokumenta. */
export const CIMD_ALLOWED_HOSTS: readonly string[] = ["claude.ai", "claude.com", "chatgpt.com", "openai.com"];

// ---- Povratne adrese (D2) -------------------------------------------------------------------------------

const FIXED_REDIRECTS: readonly string[] = [
  "https://claude.ai/api/mcp/auth_callback",
  "https://claude.com/api/mcp/auth_callback",
  "https://chatgpt.com/connector_platform_oauth_redirect",
];
const CHATGPT_CONNECTOR_REDIRECT = /^https:\/\/chatgpt\.com\/connector\/oauth\/[A-Za-z0-9_-]{1,128}$/;
const LOOPBACK_HOSTS: readonly string[] = ["localhost", "127.0.0.1", "[::1]"];

function parseUrl(raw: string): URL | null {
  try {
    return new URL(raw);
  } catch {
    return null;
  }
}

/** http adresa na računaru korisnika (RFC 8252 §7.3): bilo koji port, bilo koja putanja. */
export function isLoopbackRedirect(raw: string): boolean {
  const u = parseUrl(raw);
  return !!u && u.protocol === "http:" && LOOPBACK_HOSTS.includes(u.hostname) && !u.username && !u.password && !raw.includes("#");
}

/** Strogo: tačno poznata https adresa nekog asistenta, ili adresa na lokalnom računaru. Sve ostalo se odbija. */
export function isAllowedRedirectUri(raw: unknown): raw is string {
  if (typeof raw !== "string" || raw.length === 0 || raw.length > 2048) return false;
  if (FIXED_REDIRECTS.includes(raw) || CHATGPT_CONNECTOR_REDIRECT.test(raw)) return true;
  return isLoopbackRedirect(raw);
}

/**
 * Da li tražena adresa odgovara registrovanoj. Tačno poređenje, osim za adrese na lokalnom računaru gdje se port
 * ignoriše (klijent bira slobodan port pri svakom pokretanju) a šema, domaćin, putanja i upit moraju biti isti.
 */
export function redirectUriMatches(registered: string, requested: string): boolean {
  if (registered === requested) return true;
  if (!isLoopbackRedirect(registered) || !isLoopbackRedirect(requested)) return false;
  const a = new URL(registered);
  const b = new URL(requested);
  return a.protocol === b.protocol && a.hostname === b.hostname && a.pathname === b.pathname && a.search === b.search;
}

/** Koji asistent stoji iza povratne adrese (za oznaku veze); samo informativno, ne daje nikakva ovlašćenja. */
export function clientFromRedirect(uri: string): McpClient {
  const host = parseUrl(uri)?.hostname;
  if (host === "claude.ai" || host === "claude.com") return "CLAUDE";
  if (host === "chatgpt.com") return "OPENAI";
  return "OTHER";
}

/** Domaćin koji se pokazuje korisniku na ekranu saglasnosti („Povratak na: …"). */
export function redirectHost(uri: string): string {
  return parseUrl(uri)?.host ?? "";
}

/** Gradi odredišnu adresu sa parametrima odgovora; postojeći upit registrovane adrese se čuva. */
export function appendAuthResponse(redirectUri: string, params: Record<string, string | undefined>): string {
  const u = new URL(redirectUri);
  for (const [k, v] of Object.entries(params)) if (v !== undefined) u.searchParams.set(k, v);
  return u.toString();
}

// ---- CIMD ----------------------------------------------------------------------------------------------

/** `client_id` je https adresa dokumenta sa putanjom, sa domaćinom sa spiska (D1). */
export function isCimdClientId(clientId: string): boolean {
  if (clientId.length > 512) return false;
  const u = parseUrl(clientId);
  if (!u || u.protocol !== "https:" || u.username || u.password || u.port || u.hash || clientId.includes("#")) return false;
  // URL već "sažima" tačke u putanji, pa se segmenti provjeravaju na izvornom tekstu.
  if (u.pathname === "/" || clientId.split("/").some((seg) => seg === "." || seg === "..")) return false;
  return CIMD_ALLOWED_HOSTS.includes(u.hostname);
}

// ---- Resurs i izdavač ----------------------------------------------------------------------------------

/** Izdavač = APP_URL bez završne kose crte. */
export function issuerOf(appUrl: string): string {
  return appUrl.replace(/\/+$/, "");
}
export function canonicalResource(appUrl: string): string {
  return `${issuerOf(appUrl)}/api/mcp`;
}
export function protectedResourceMetadataUrl(appUrl: string): string {
  return `${issuerOf(appUrl)}/.well-known/oauth-protected-resource/api/mcp`;
}

/** Parametar `resource` (RFC 8707) mora biti ovaj server: šema i domaćin bez razlike veličine slova, jedna završna kosa crta se tolerira. */
export function resourceMatches(requested: string, appUrl: string): boolean {
  const u = parseUrl(requested);
  if (!u || u.search || u.hash || u.username || u.password) return false;
  const path = u.pathname.endsWith("/") ? u.pathname.slice(0, -1) : u.pathname;
  return `${u.protocol}//${u.host}${path}` === canonicalResource(appUrl);
}

// ---- PKCE ----------------------------------------------------------------------------------------------

export const CODE_VERIFIER = /^[A-Za-z0-9._~-]{43,128}$/;
export const CODE_CHALLENGE = /^[A-Za-z0-9_-]{43}$/;

/** base64url(sha256(verifier)) — jedina podržana metoda (S256). */
export function pkceS256(verifier: string): string {
  return createHash("sha256").update(verifier, "ascii").digest("base64url");
}

// ---- Prijava i povratak na saglasnost ------------------------------------------------------------------

/**
 * `next` na /login smije voditi samo na /oauth/authorize ove aplikacije. Ovo je jedini slučaj kad prijava
 * preusmjerava na adresu iz upita, pa je pravilo namjerno usko: nikakva spoljna adresa, nikakva druga putanja.
 */
export function isSafeOAuthNext(next: unknown, appUrl: string): next is string {
  if (typeof next !== "string" || next.length === 0 || next.length > 4096) return false;
  if (!next.startsWith("/") || next.startsWith("//") || next.includes("\\")) return false;
  if ([...next].some((c) => c.charCodeAt(0) < 0x20 || c.charCodeAt(0) === 0x7f)) return false;
  const base = parseUrl(appUrl);
  const u = parseUrl(new URL(next, appUrl).toString());
  return !!base && !!u && u.origin === base.origin && u.pathname === "/oauth/authorize";
}

// ---- Imena ---------------------------------------------------------------------------------------------

/** Samoprijavljeno ime klijenta: bez kontrolnih znakova, najviše 100 znakova. Prikazuje se kao običan tekst. */
export function sanitizeClientName(raw: unknown, fallback = "MCP klijent"): string {
  if (typeof raw !== "string") return fallback;
  const clean = raw.replace(/[\u0000-\u001f\u007f-\u009f\u2028\u2029]/g, " ").replace(/\s+/g, " ").trim().slice(0, 100);
  return clean || fallback;
}

// ---- Metapodaci ----------------------------------------------------------------------------------------

/** RFC 9728: metapodaci zaštićenog resursa. */
export function buildPrm(appUrl: string) {
  return {
    resource: canonicalResource(appUrl),
    authorization_servers: [issuerOf(appUrl)],
    bearer_methods_supported: ["header"],
    scopes_supported: [OAUTH_SCOPE],
    resource_name: "ZEV upravnik",
  };
}

/** RFC 8414: metapodaci servera autorizacije. */
export function buildAsMetadata(appUrl: string) {
  const issuer = issuerOf(appUrl);
  return {
    issuer,
    authorization_endpoint: `${issuer}/oauth/authorize`,
    token_endpoint: `${issuer}/oauth/token`,
    registration_endpoint: `${issuer}/oauth/register`,
    revocation_endpoint: `${issuer}/oauth/revoke`,
    response_types_supported: ["code"],
    response_modes_supported: ["query"],
    grant_types_supported: ["authorization_code", "refresh_token"],
    token_endpoint_auth_methods_supported: ["none"],
    revocation_endpoint_auth_methods_supported: ["none"],
    code_challenge_methods_supported: ["S256"],
    scopes_supported: [...OAUTH_SCOPES_SUPPORTED],
    authorization_response_iss_parameter_supported: true,
    ...(CIMD_ADVERTISED ? { client_id_metadata_document_supported: true } : {}),
  };
}
