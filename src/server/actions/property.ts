"use server";
// Edit actions for buildings/units on /zgrade. Split out of the page (rather than declared
// inline) so they can be passed as a prop into the client-side row components that show the
// inline edit panel with a working Cancel button (see building-row.tsx / unit-row.tsx).
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireActor } from "@/server/actor";
import { updateBuilding, updateUnit } from "@/server/services/property";
import { parseMoneyInput } from "@/lib/money";

export async function updateBuildingAction(formData: FormData) {
  const actor = await requireActor("PRESIDENT");
  const id = String(formData.get("id"));
  try {
    await updateBuilding(actor, id, {
      name: String(formData.get("name")),
      address: String(formData.get("address")),
      cadastralRef: (formData.get("cadastralRef") as string) || null,
      yearBuilt: formData.get("yearBuilt") ? Number(formData.get("yearBuilt")) : null,
      floorsCount: formData.get("floorsCount") ? Number(formData.get("floorsCount")) : null,
      note: (formData.get("note") as string) || null,
    });
  } catch (e) {
    redirect(`/zgrade?err=${encodeURIComponent(e instanceof Error ? e.message : "Greška")}`);
  }
  revalidatePath("/zgrade");
  redirect("/zgrade?msg=saved");
}

export async function updateUnitAction(formData: FormData) {
  const actor = await requireActor("PRESIDENT");
  const id = String(formData.get("id"));
  try {
    await updateUnit(actor, id, {
      buildingId: String(formData.get("buildingId")),
      entranceId: (formData.get("entranceId") as string) || null,
      type: formData.get("type") as never,
      label: String(formData.get("label")),
      floor: formData.get("floor") ? Number(formData.get("floor")) : null,
      usableArea: parseMoneyInput(formData.get("usableArea") as string | null) ?? undefined,
      ownershipShare: parseMoneyInput(formData.get("ownershipShare") as string | null) ?? undefined,
      occupantCount: Number(formData.get("occupantCount") ?? 0),
      typeCoefficient: parseMoneyInput(formData.get("typeCoefficient") as string | null) ?? undefined,
    });
  } catch (e) {
    redirect(`/zgrade?err=${encodeURIComponent(e instanceof Error ? e.message : "Greška")}`);
  }
  revalidatePath("/zgrade");
  redirect("/zgrade?msg=saved");
}
