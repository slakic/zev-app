"use server";
// "Izmjena registra" (FR-Q3): the client form serialises the change as JSON in `payload`; the document is a
// real file input. Everything is validated again in changeUnitRegister (service), this only parses.
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireActor } from "@/server/actor";
import { changeUnitRegister, type RegisterChangeInput } from "@/server/services/unitRegister";
import { parseMoneyInput } from "@/lib/money";

const NUM_KEYS = new Set(["usableArea", "ownershipShare", "typeCoefficient"]);

/** The user may type "17,60"; the service wants "17.60". */
function normalise(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(normalise);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([k, v]) => [k, NUM_KEYS.has(k) && typeof v === "string" ? parseMoneyInput(v) ?? "" : normalise(v)]),
    );
  }
  return value;
}

export async function changeUnitRegisterAction(formData: FormData) {
  const actor = await requireActor("PRESIDENT");
  try {
    const payload = normalise(JSON.parse(String(formData.get("payload") ?? "{}"))) as Omit<RegisterChangeInput, "reason">;
    const file = formData.get("document") as File | null;
    if (!file || file.size === 0) throw new Error("Dokument o izmjeni registra je obavezan.");
    await changeUnitRegister(
      actor,
      { ...payload, reason: String(formData.get("reason") ?? "") } as RegisterChangeInput,
      { buffer: Buffer.from(await file.arrayBuffer()), filename: file.name, mime: file.type },
    );
  } catch (e) {
    redirect(`/zgrade/registar/izmjena?err=${encodeURIComponent(e instanceof Error ? e.message : "Greška")}`);
  }
  revalidatePath("/zgrade");
  redirect("/zgrade?tab=posebni&msg=changed");
}
