"use server";
// Promjena zajednickog predstavnika suvlasnika (K-03a) — pozivaju je "Zgrade › Posebni dijelovi" i
// "Vlasnici › Vlasnistvo". `returnTo` je ogranicen na dvije poznate putanje (nikad slobodan URL).
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireActor } from "@/server/actor";
import { setVotingRepresentative } from "@/server/services/ownership";

const RETURN_PATHS: Record<string, string> = {
  zgrade: "/zgrade?tab=posebni",
  vlasnici: "/vlasnici?tab=vlasnistvo",
};

export async function setVotingRepresentativeAction(formData: FormData) {
  const actor = await requireActor("PRESIDENT");
  const back = RETURN_PATHS[String(formData.get("returnTo"))] ?? RETURN_PATHS.zgrade;
  const sep = back.includes("?") ? "&" : "?";
  try {
    await setVotingRepresentative(actor, String(formData.get("unitId")), String(formData.get("partyId")));
  } catch (e) {
    redirect(`${back}${sep}err=${encodeURIComponent(e instanceof Error ? e.message : "Greška")}`);
  }
  revalidatePath("/zgrade");
  revalidatePath("/vlasnici");
  redirect(`${back}${sep}msg=representative`);
}
