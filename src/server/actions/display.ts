"use server";
// Izbor prikaza (Plans/pristupacni-prikaz-plan.md, faza A): dugme „A+” u gornjoj traci, kartica
// „Prikaz” u „Moji podaci” i jednokratno pitanje. Postavka se upisuje na <html> u root layout-u,
// pa revalidacija cijelog stabla odmah mijenja prikaz bez novog učitavanja stranice.
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireActor } from "@/server/actor";
import { setUiPreferences } from "@/server/services/uiPreferences";

/** Samo putanja unutar aplikacije — nikad drugi host. */
function safeReturn(raw: FormDataEntryValue | null): string | null {
  const v = String(raw ?? "");
  return v.startsWith("/") && !v.startsWith("//") ? v : null;
}

export async function setTextSizeAction(formData: FormData) {
  const actor = await requireActor();
  await setUiPreferences(actor, { textLarge: formData.get("textSize") === "large" });
  revalidatePath("/", "layout");
  const back = safeReturn(formData.get("returnTo"));
  if (back) redirect(back);
}
