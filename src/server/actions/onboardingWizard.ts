"use server";
// Akcije koraka čarobnjaka (Plans/zev-onboarding-wizard-plan.md §4). Svaka šalje `version` nacrta
// (optimistička brava) i vraća korisnika na isti korak sa porukom; guard koraka i sva pravila su u
// servisu (src/server/services/onboarding.ts), ne ovdje.
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireActor } from "@/server/actor";
import {
  addDraftAccount,
  addDraftBuilding,
  addDraftEntrance,
  removeDraftAccount,
  removeDraftBuilding,
  removeDraftEntrance,
  saveAccountStep,
  saveZevStep,
  setNoAccounts,
} from "@/server/services/onboarding";
import { t } from "@/lib/i18n";

const str = (fd: FormData, k: string) => String(fd.get(k) ?? "");

async function run(
  slug: string,
  fd: FormData,
  fn: (actor: Awaited<ReturnType<typeof requireActor>>, version: number) => Promise<unknown>,
  /** Sačuvano, ali sa upozorenjem koje korisnik mora vidjeti (npr. neispravan JIB). */
  warnAfter?: () => string | null
) {
  const actor = await requireActor();
  const version = Number(fd.get("version"));
  try {
    await fn(actor, version);
  } catch (e) {
    redirect(`/onboarding/${slug}?err=${encodeURIComponent(e instanceof Error ? e.message : "Greška")}`);
  }
  revalidatePath("/onboarding", "layout");
  const warn = warnAfter?.();
  redirect(warn ? `/onboarding/${slug}?err=${encodeURIComponent(warn)}` : `/onboarding/${slug}?msg=saved`);
}

export async function saveAccountStepAction(fd: FormData) {
  await run("nalog", fd, (a, v) => saveAccountStep(a, v, { firstName: str(fd, "firstName"), lastName: str(fd, "lastName"), phone: str(fd, "phone") }));
}

export async function saveZevStepAction(fd: FormData) {
  let jibValid = true;
  await run("podaci-o-zev-u", fd, async (a, v) => {
    const res = await saveZevStep(a, v, {
      legalName: str(fd, "legalName"), shortName: str(fd, "shortName"), registrationNumber: str(fd, "registrationNumber"),
      jib: str(fd, "jib"), registeredAddress: str(fd, "registeredAddress"), city: str(fd, "city"),
      municipality: str(fd, "municipality"), foundingDate: str(fd, "foundingDate"), registrationDate: str(fd, "registrationDate"),
    });
    jibValid = res.jibValid;
  }, () => (jibValid ? null : t("onboarding.zev.jibInvalidSaved")));
}

export async function addAccountAction(fd: FormData) {
  await run("racuni", fd, (a, v) =>
    addDraftAccount(a, v, {
      type: str(fd, "type") === "CASH" ? "CASH" : "BANK",
      name: str(fd, "name"), bankName: str(fd, "bankName"), number: str(fd, "number"),
      openingBalance: str(fd, "openingBalance"), openingDate: str(fd, "openingDate"),
    })
  );
}

export async function removeAccountAction(fd: FormData) {
  await run("racuni", fd, (a, v) => removeDraftAccount(a, v, str(fd, "key")));
}

export async function setNoAccountsAction(fd: FormData) {
  await run("racuni", fd, (a, v) => setNoAccounts(a, v, str(fd, "value") === "true"));
}

export async function addBuildingAction(fd: FormData) {
  await run("zgrade", fd, (a, v) =>
    addDraftBuilding(a, v, {
      name: str(fd, "name"), address: str(fd, "address"), cadastralRef: str(fd, "cadastralRef"),
      yearBuilt: str(fd, "yearBuilt"), floorsCount: str(fd, "floorsCount"),
    })
  );
}

export async function removeBuildingAction(fd: FormData) {
  await run("zgrade", fd, (a, v) => removeDraftBuilding(a, v, str(fd, "key")));
}

export async function addEntranceAction(fd: FormData) {
  await run("zgrade", fd, (a, v) => addDraftEntrance(a, v, str(fd, "buildingKey"), str(fd, "name")));
}

export async function removeEntranceAction(fd: FormData) {
  await run("zgrade", fd, (a, v) => removeDraftEntrance(a, v, str(fd, "buildingKey"), str(fd, "entranceKey")));
}
