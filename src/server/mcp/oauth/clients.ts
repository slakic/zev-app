// OAuth klijenti MCP servera (Plans/mcp-platforma-plan.md §5): dinamička registracija (DCR, RFC 7591) i
// dokument metapodataka na https adresi (CIMD). SVE što klijent o sebi kaže (ime, adresa) je nepouzdano i
// služi samo za prikaz; jedino što se provjerava i na šta se oslanja su povratne adrese sa spiska (oauth.ts).
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { audit } from "@/server/audit";
import { generateToken } from "@/server/auth/tokens";
import {
  MAX_REDIRECT_URIS,
  OAUTH_CLIENT_PREFIX,
  isAllowedRedirectUri,
  isCimdClientId,
  redirectHost,
  sanitizeClientName,
} from "@/lib/mcp/oauth";

/** Najviše toliko neiskorišćenih DCR klijenata u 24 sata, pa registracija vraća 503 (zaštita od zatrpavanja baze). */
export const DCR_DAILY_UNUSED_CAP = 500;
const DAY_MS = 24 * 60 * 60 * 1000;

const CIMD_TIMEOUT_MS = 3000;
const CIMD_MAX_BYTES = 5 * 1024;
const CIMD_MIN_CACHE_MS = 5 * 60 * 1000;
const CIMD_MAX_CACHE_MS = DAY_MS;
const CIMD_DEFAULT_CACHE_MS = 60 * 60 * 1000;

export type ResolvedClient = {
  id: string;
  clientId: string;
  kind: "DCR" | "CIMD";
  clientName: string;
  redirectUris: string[];
};

function toResolved(row: { id: string; clientId: string; kind: "DCR" | "CIMD"; clientName: string; redirectUris: unknown }): ResolvedClient {
  const uris = Array.isArray(row.redirectUris) ? row.redirectUris.filter((u): u is string => typeof u === "string") : [];
  return { id: row.id, clientId: row.clientId, kind: row.kind, clientName: row.clientName, redirectUris: uris };
}

function safeHttpsUrl(raw: string | undefined): string | null {
  if (!raw) return null;
  try {
    const u = new URL(raw);
    return u.protocol === "https:" && !u.username && !u.password && raw.length <= 512 ? u.toString() : null;
  } catch {
    return null;
  }
}

// ---- DCR -----------------------------------------------------------------------------------------------

export type DcrResult =
  | {
      ok: true;
      response: {
        client_id: string;
        client_id_issued_at: number;
        client_name: string;
        redirect_uris: string[];
        grant_types: string[];
        response_types: string[];
        token_endpoint_auth_method: "none";
      };
    }
  | { ok: false; status: number; error: string; description: string };

const OUR_GRANTS = ["authorization_code", "refresh_token"];
const optionalString = z.string().max(1000).optional().catch(undefined);
const dcrSchema = z.object({
  client_name: optionalString,
  client_uri: optionalString,
  software_id: optionalString,
  software_version: optionalString,
  grant_types: z.array(z.string()).optional(),
  response_types: z.array(z.string()).optional(),
  // Svaki drugi način autentikacije klijenta se tiho svodi na "none": tajne se nikad ne izdaju.
  token_endpoint_auth_method: z.string().optional(),
});

export async function registerDcrClient(body: unknown, ipHash: string | null): Promise<DcrResult> {
  const bad = (error: string, description: string): DcrResult => ({ ok: false, status: 400, error, description });
  if (typeof body !== "object" || body === null || Array.isArray(body)) return bad("invalid_client_metadata", "Tijelo mora biti JSON objekat.");
  const raw = body as Record<string, unknown>;

  const uris = raw.redirect_uris;
  if (!Array.isArray(uris) || uris.length < 1 || uris.length > MAX_REDIRECT_URIS) {
    return bad("invalid_redirect_uri", `redirect_uris mora imati od 1 do ${MAX_REDIRECT_URIS} adresa.`);
  }
  if (!uris.every(isAllowedRedirectUri)) return bad("invalid_redirect_uri", "Povratna adresa nije dozvoljena.");
  const redirectUris = [...new Set(uris as string[])];

  const parsed = dcrSchema.safeParse(raw);
  if (!parsed.success) return bad("invalid_client_metadata", "Metapodaci klijenta nisu ispravni.");
  const meta = parsed.data;
  if (meta.grant_types && !meta.grant_types.every((g) => OUR_GRANTS.includes(g))) return bad("invalid_client_metadata", "Nepodržan grant_types.");
  if (meta.response_types && !meta.response_types.every((r) => r === "code")) return bad("invalid_client_metadata", "Nepodržan response_types.");

  const since = new Date(Date.now() - DAY_MS);
  const unused = await prisma.mcpOAuthClient.count({ where: { kind: "DCR", createdAt: { gt: since }, connections: { none: {} } } });
  if (unused >= DCR_DAILY_UNUSED_CAP) {
    return { ok: false, status: 503, error: "temporarily_unavailable", description: "Registracija je privremeno nedostupna." };
  }

  const clientName = sanitizeClientName(meta.client_name);
  const clientId = OAUTH_CLIENT_PREFIX + generateToken(16);
  const row = await prisma.$transaction(async (tx) => {
    const created = await tx.mcpOAuthClient.create({
      data: {
        clientId,
        kind: "DCR",
        clientName,
        clientUri: safeHttpsUrl(meta.client_uri),
        redirectUris,
        softwareId: meta.software_id?.slice(0, 200) || null,
        softwareVersion: meta.software_version?.slice(0, 100) || null,
        registeredIpHash: ipHash,
      },
      select: { id: true, createdAt: true },
    });
    // Bez korisnika (registracija je anonimna); u zapis ide samo ime i domaćini, nikad IP adresa ni tajna.
    await audit(
      null,
      {
        action: "mcp.oauth.client_register",
        targetType: "McpOAuthClient",
        targetId: created.id,
        ipHash,
        after: { clientName, redirectHosts: [...new Set(redirectUris.map(redirectHost))] },
      },
      tx
    );
    return created;
  });

  return {
    ok: true,
    response: {
      client_id: clientId,
      client_id_issued_at: Math.floor(row.createdAt.getTime() / 1000),
      client_name: clientName,
      redirect_uris: redirectUris,
      grant_types: meta.grant_types ?? OUR_GRANTS,
      response_types: ["code"],
      token_endpoint_auth_method: "none",
    },
  };
}

// ---- CIMD ----------------------------------------------------------------------------------------------

const cimdSchema = z.object({
  client_id: z.string(),
  client_name: z.string().optional().catch(undefined),
  client_uri: z.string().optional().catch(undefined),
  redirect_uris: z.array(z.string()).min(1).max(MAX_REDIRECT_URIS),
  token_endpoint_auth_method: z.string().optional(),
});

function cacheMs(res: Response): number {
  const m = /max-age=(\d+)/i.exec(res.headers.get("cache-control") ?? "");
  if (!m) return CIMD_DEFAULT_CACHE_MS;
  return Math.min(CIMD_MAX_CACHE_MS, Math.max(CIMD_MIN_CACHE_MS, Number(m[1]) * 1000));
}

async function readCapped(res: Response, maxBytes: number): Promise<string | null> {
  if (!res.body) return null;
  const reader = res.body.getReader();
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

/** Dohvata i provjerava dokument klijenta. Domaćin je već na spisku (isCimdClientId), preusmjeravanja su zabranjena. */
async function fetchCimdClient(clientId: string): Promise<ResolvedClient | null> {
  let res: Response;
  try {
    res = await fetch(clientId, {
      redirect: "error",
      signal: AbortSignal.timeout(CIMD_TIMEOUT_MS),
      headers: { accept: "application/json" },
    });
  } catch {
    return null;
  }
  if (!res.ok || !(res.headers.get("content-type") ?? "").toLowerCase().includes("application/json")) return null;
  const text = await readCapped(res, CIMD_MAX_BYTES);
  if (text === null) return null;
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return null;
  }
  const doc = cimdSchema.safeParse(json);
  if (!doc.success || doc.data.client_id !== clientId) return null;
  if (doc.data.token_endpoint_auth_method && doc.data.token_endpoint_auth_method !== "none") return null;
  if (!doc.data.redirect_uris.every(isAllowedRedirectUri)) return null;

  const redirectUris = [...new Set(doc.data.redirect_uris)];
  const clientName = sanitizeClientName(doc.data.client_name, new URL(clientId).hostname);
  const metadataExpiresAt = new Date(Date.now() + cacheMs(res));
  const data = { clientName, clientUri: safeHttpsUrl(doc.data.client_uri), redirectUris, metadataExpiresAt };
  const row = await prisma.mcpOAuthClient.upsert({
    where: { clientId },
    create: { clientId, kind: "CIMD", ...data },
    update: data,
    select: { id: true, clientId: true, kind: true, clientName: true, redirectUris: true },
  });
  return toResolved(row);
}

// ---- Zajedničko ----------------------------------------------------------------------------------------

/** Klijent po `client_id`: red iz baze, ili (CIMD) dohvaćen dokument sa spiska dozvoljenih domaćina. Nepoznat → null. */
export async function resolveClient(clientId: string): Promise<ResolvedClient | null> {
  if (!clientId || clientId.length > 512) return null;
  const row = await prisma.mcpOAuthClient.findUnique({
    where: { clientId },
    select: { id: true, clientId: true, kind: true, clientName: true, redirectUris: true, metadataExpiresAt: true },
  });
  if (row) {
    if (row.kind === "CIMD" && (!row.metadataExpiresAt || row.metadataExpiresAt <= new Date())) {
      return isCimdClientId(clientId) ? fetchCimdClient(clientId) : null;
    }
    return toResolved(row);
  }
  return isCimdClientId(clientId) ? fetchCimdClient(clientId) : null;
}

/** Klijent iz baze bez ikakvog dohvata (token endpoint: klijent je prošao kroz authorize pa je red već tu). */
export async function findStoredClient(clientId: string): Promise<ResolvedClient | null> {
  if (!clientId || clientId.length > 512) return null;
  const row = await prisma.mcpOAuthClient.findUnique({
    where: { clientId },
    select: { id: true, clientId: true, kind: true, clientName: true, redirectUris: true },
  });
  return row ? toResolved(row) : null;
}

const TOUCH_THROTTLE_MS = 5 * 60 * 1000;

/** Fire-and-forget: zabilježi zadnje korišćenje klijenta, najviše jednom u 5 minuta. */
export function touchClient(id: string): void {
  const threshold = new Date(Date.now() - TOUCH_THROTTLE_MS);
  prisma.mcpOAuthClient
    .updateMany({ where: { id, OR: [{ lastUsedAt: null }, { lastUsedAt: { lt: threshold } }] }, data: { lastUsedAt: new Date() } })
    .catch(() => {});
}
