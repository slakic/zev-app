// Zajednički HTTP dio OAuth krajnjih tačaka (Plans/mcp-platforma-plan.md §5). Pozivaju ih klijenti asistenata
// (pa i preglednik sa tuđe stranice), ne prijavljeni korisnik: ovdje se NIKAD ne čitaju kolačići.
// CORS je otvoren (`*`) jer krajnje tačke ne koriste kolačiće ni ambijentalna ovlašćenja; zaštitu daju
// PKCE, tačno poređenje povratnih adresa i jednokratni kodovi.
import { getEnv } from "@/lib/env";
import { sha256 } from "@/server/auth/tokens";

const CORS_BASE = { "access-control-allow-origin": "*" };

/** MCP i OAuth moraju biti uključeni; inače krajnja tačka ne postoji (404). */
export function oauthEnabled(): boolean {
  const env = getEnv();
  return env.MCP_ENABLED === "true" && env.MCP_OAUTH_ENABLED === "true";
}

/** Vraća 404 odgovor kad je OAuth isključen, inače null. Poziva se prvo u svakoj OAuth ruti. */
export function requireOAuthEnabled(): Response | null {
  return oauthEnabled() ? null : new Response("Not found", { status: 404 });
}

export function corsPreflight(req: Request, methods: string): Response {
  return new Response(null, {
    status: 204,
    headers: {
      ...CORS_BASE,
      "access-control-allow-methods": methods,
      "access-control-allow-headers": req.headers.get("access-control-request-headers") ?? "content-type, authorization",
      "access-control-max-age": "600",
    },
  });
}

export function oauthJson(status: number, body: unknown, extraHeaders: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...CORS_BASE, ...extraHeaders },
  });
}

/** Odgovor sa tajnama (token, registracija) ne smije u keš. */
export function oauthNoStore(status: number, body: unknown, extraHeaders: Record<string, string> = {}): Response {
  return oauthJson(status, body, { "cache-control": "no-store", pragma: "no-cache", ...extraHeaders });
}

export function oauthError(status: number, error: string, description?: string, extraHeaders: Record<string, string> = {}): Response {
  return oauthNoStore(status, description ? { error, error_description: description } : { error }, extraHeaders);
}

/** Metapodaci su javni i smiju kratko u keš. */
export function metadataResponse(body: unknown): Response {
  return oauthJson(200, body, { "cache-control": "public, max-age=300" });
}

/** Čita tijelo najviše `maxBytes` bajtova (prekida čim se prekorači, ne učitava sve u memoriju). */
export async function readLimitedText(req: Request, maxBytes: number): Promise<string | null> {
  if (Number(req.headers.get("content-length") ?? 0) > maxBytes) return null;
  if (!req.body) return "";
  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel().catch(() => {});
      return null;
    }
    chunks.push(value);
  }
  return new TextDecoder().decode(Buffer.concat(chunks));
}

/** Samo `application/x-www-form-urlencoded`; sve ostalo (ili preveliko tijelo) je null. */
export async function parseForm(req: Request, maxBytes: number): Promise<URLSearchParams | null> {
  const type = req.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase();
  if (type !== "application/x-www-form-urlencoded") return null;
  const text = await readLimitedText(req, maxBytes);
  return text === null ? null : new URLSearchParams(text);
}

/** sha256 IP adrese iz zaglavlja proxyja; isto pravilo kao na /api/mcp. Sirova adresa se nikad ne čuva. */
export function ipHashOf(req: Request): string | null {
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? req.headers.get("x-real-ip") ?? null;
  return ip ? sha256(ip) : null;
}
