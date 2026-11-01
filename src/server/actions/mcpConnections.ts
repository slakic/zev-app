"use server";
// Akcije stranice „Povezani asistenti" (/nalog/asistenti). Pravljenje veze vraća stanje (useActionState)
// umjesto preusmjeravanja: token se prikazuje JEDNOM, na istom ekranu, i nikad ne ide u adresu stranice
// (istorija pretraživača, logovi) — isti obrazac kao poziv u onboarding.ts.
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireActor } from "@/server/actor";
import { createMcpConnection, revokeMcpConnection } from "@/server/services/mcpConnections";
import { getEnv } from "@/lib/env";
import { formatDate } from "@/lib/i18n";
import type { McpClient } from "@/generated/prisma/client";

export type McpConnectionState =
  | { status: "idle" }
  | { status: "error"; error: string }
  | { status: "ok"; name: string; validUntil: string; serverUrl: string; token: string; client: McpClient };

export async function createMcpConnectionAction(_prev: McpConnectionState, formData: FormData): Promise<McpConnectionState> {
  const actor = await requireActor();
  if (getEnv().MCP_ENABLED !== "true") return { status: "error", error: "Greška" };
  try {
    const res = await createMcpConnection(actor, {
      name: String(formData.get("name") ?? ""),
      client: String(formData.get("client") ?? "") as McpClient,
      scopeKey: String(formData.get("scopeKey") ?? ""),
      days: Number(formData.get("days")),
    });
    revalidatePath("/nalog/asistenti");
    return {
      status: "ok",
      name: res.connection.name,
      validUntil: formatDate(res.connection.expiresAt),
      serverUrl: `${getEnv().APP_URL.replace(/\/+$/, "")}/api/mcp`,
      token: res.token,
      client: String(formData.get("client")) as McpClient,
    };
  } catch (e) {
    return { status: "error", error: e instanceof Error ? e.message : "Greška" };
  }
}

export async function revokeMcpConnectionAction(formData: FormData): Promise<void> {
  const actor = await requireActor();
  let name: string;
  try {
    ({ name } = await revokeMcpConnection(actor, String(formData.get("id") ?? "")));
  } catch (e) {
    redirect(`/nalog/asistenti?err=${encodeURIComponent(e instanceof Error ? e.message : "Greška")}`);
  }
  revalidatePath("/nalog/asistenti");
  redirect(`/nalog/asistenti?msg=revoked&naziv=${encodeURIComponent(name)}`);
}
