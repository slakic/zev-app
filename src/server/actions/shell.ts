"use server";
// Akcije koje dijele sve školjke (aplikacija, platforma, čarobnjak): odjava i prebacivanje aktivnog ZEV-a.
// Ranije su bile prepisane u svakom layout-u.
import { redirect } from "next/navigation";
import { requireActor } from "@/server/actor";
import { destroySession } from "@/server/auth/session";
import { switchActiveZev } from "@/server/services/memberships";

export async function logoutAction() {
  await destroySession();
  redirect("/login");
}

export async function switchZevAction(formData: FormData) {
  const actor = await requireActor();
  const zevId = String(formData.get("zevId") ?? "");
  try {
    await switchActiveZev(actor, zevId);
  } catch (e) {
    redirect(`/?err=${encodeURIComponent(e instanceof Error ? e.message : "Greška")}`);
  }
  redirect("/");
}
