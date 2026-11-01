"use server";
// Akcije pristupa administratora nacrtu (Plans/mcp-onboarding-asistent-plan.md, O-A): dodaje super admin sa stranice
// nacrta, uklanja vlasnik nacrta (/nalog/asistenti) ili super admin. Greške idu nazad kao `err` (isti obrazac kao
// revokeMcpConnectionAction); provjera prava je u servisu.
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireActor, requireSuperAdminActor } from "@/server/actor";
import { getEnv } from "@/lib/env";
import { t } from "@/lib/i18n";
import { grantDraftAdminAccess, revokeDraftAdminAccess } from "@/server/services/mcpDraftAccess";

/** id nacrta ide u adresu preusmjeravanja, pa se prihvata samo oblik id-ja (cuid), nikad proizvoljan tekst. */
const draftIdOf = (formData: FormData) => {
  const id = String(formData.get("draftId") ?? "");
  return /^[A-Za-z0-9_-]{1,64}$/.test(id) ? id : "";
};

const msgOf = (e: unknown) => (e instanceof Error ? e.message : "Greška");

export async function grantDraftAdminAccessAction(formData: FormData): Promise<void> {
  const actor = await requireSuperAdminActor();
  const draftId = draftIdOf(formData);
  if (!draftId) redirect("/admin");
  const page = `/admin/nacrti/${draftId}`;
  if (getEnv().MCP_ENABLED !== "true") redirect(`${page}?err=${encodeURIComponent(t("assistants.adminAccess.errors.disabled"))}`);
  try {
    await grantDraftAdminAccess(actor, draftId);
  } catch (e) {
    redirect(`${page}?err=${encodeURIComponent(msgOf(e))}`);
  }
  revalidatePath(page);
  revalidatePath("/nalog/asistenti");
  redirect(`${page}?msg=access_granted`);
}

export async function revokeDraftAdminAccessAction(formData: FormData): Promise<void> {
  const actor = await requireActor();
  const draftId = draftIdOf(formData);
  // Povratak: samo dvije poznate stranice (nikad adresa iz forme).
  const back = String(formData.get("back") ?? "") === "admin" && draftId ? `/admin/nacrti/${draftId}` : "/nalog/asistenti";
  if (getEnv().MCP_ENABLED !== "true") redirect(`${back}?err=${encodeURIComponent(t("assistants.adminAccess.errors.disabled"))}`);
  try {
    await revokeDraftAdminAccess(actor, String(formData.get("id") ?? ""));
  } catch (e) {
    redirect(`${back}?err=${encodeURIComponent(msgOf(e))}`);
  }
  revalidatePath("/nalog/asistenti");
  if (draftId) revalidatePath(`/admin/nacrti/${draftId}`);
  redirect(`${back}?msg=access_revoked`);
}
