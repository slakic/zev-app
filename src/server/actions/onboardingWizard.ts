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
  addDraftBoardMember,
  addDraftCommonAsset,
  addDraftStake,
  publishOnboardingDraft,
  removeDraftBoardMember,
  removeDraftStake,
  setAccountantLater,
  setDraftAccountant,
  setUnitDisputed,
  addDraftUnit,
  confirmDraftRegister,
  removeDraftCommonAsset,
  removeDraftUnit,
  unlockDraftRegister,
  updateDraftUnit,
  addDraftEntrance,
  removeDraftAccount,
  removeDraftBuilding,
  removeDraftEntrance,
  saveAccountStep,
  saveZevStep,
  setNoAccounts,
} from "@/server/services/onboarding";
import { t } from "@/lib/i18n";
import { setSessionActiveZev } from "@/server/auth/session";

const str = (fd: FormData, k: string) => String(fd.get(k) ?? "");

async function run(
  slug: string,
  fd: FormData,
  fn: (actor: Awaited<ReturnType<typeof requireActor>>, version: number) => Promise<unknown>,
  /** Sačuvano, ali sa upozorenjem koje korisnik mora vidjeti (npr. neispravan JIB). */
  warnAfter?: () => string | null,
  /** Dodatni parametri adrese posle uspjeha (npr. zadržan izbor u formi). */
  keepQuery = ""
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
  redirect(warn ? `/onboarding/${slug}?err=${encodeURIComponent(warn)}` : `/onboarding/${slug}?msg=saved${keepQuery}`);
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

function unitInput(fd: FormData) {
  // Jedno polje „Zgrada i ulaz”: vrijednost je "zgrada" ili "zgrada|ulaz".
  const [buildingKey, entranceKey] = str(fd, "place").split("|");
  return {
    buildingKey, entranceKey: entranceKey || null, type: str(fd, "type"), label: str(fd, "label"),
    floor: str(fd, "floor"), usableArea: str(fd, "usableArea"), ownershipShare: str(fd, "ownershipShare"),
  };
}

export async function addUnitAction(fd: FormData) {
  // Posle dodavanja forma ostaje otvorena sa istom zgradom/ulazom i vrstom (§6, mockup O-M02 ③).
  const keep = `&mjesto=${encodeURIComponent(str(fd, "place"))}&vrsta=${encodeURIComponent(str(fd, "type"))}`;
  await run("posebni-dijelovi", fd, (a, v) => addDraftUnit(a, v, unitInput(fd)), undefined, keep);
}

export async function updateUnitAction(fd: FormData) {
  await run("posebni-dijelovi", fd, (a, v) => updateDraftUnit(a, v, str(fd, "key"), unitInput(fd)));
}

export async function removeUnitAction(fd: FormData) {
  await run("posebni-dijelovi", fd, (a, v) => removeDraftUnit(a, v, str(fd, "key")));
}

export async function addCommonAssetAction(fd: FormData) {
  await run("zajednicki-dijelovi", fd, (a, v) =>
    addDraftCommonAsset(a, v, { buildingKey: str(fd, "buildingKey"), kind: str(fd, "kind"), name: str(fd, "name"), description: str(fd, "description") })
  );
}

export async function removeCommonAssetAction(fd: FormData) {
  await run("zajednicki-dijelovi", fd, (a, v) => removeDraftCommonAsset(a, v, str(fd, "key")));
}

export async function confirmRegisterAction(fd: FormData) {
  await run("utvrdjivanje-registra", fd, (a, v) => confirmDraftRegister(a, v));
}

export async function unlockRegisterAction(fd: FormData) {
  await run("utvrdjivanje-registra", fd, (a, v) => unlockDraftRegister(a, v));
}

function partyChoice(fd: FormData) {
  return {
    partyKey: str(fd, "partyKey"),
    newParty: {
      kind: str(fd, "kind"), firstName: str(fd, "firstName"), lastName: str(fd, "lastName"),
      orgName: str(fd, "orgName"), orgIdNumber: str(fd, "orgIdNumber"), email: str(fd, "email"), phone: str(fd, "phone"),
    },
  };
}

/** Dokaz o vlasništvu iz forme (isto kao readProofFile na /vlasnici). */
async function readProof(fd: FormData) {
  const file = fd.get("proofFile") as File | null;
  if (!file || file.size === 0) return null;
  return { buffer: Buffer.from(await file.arrayBuffer()), filename: file.name, mime: file.type };
}

export async function addStakeAction(fd: FormData) {
  const unitKey = str(fd, "unitKey");
  const proof = await readProof(fd);
  const keep = `&jedinica=${encodeURIComponent(unitKey)}`;
  await run("vlasnici", fd, (a, v) => addDraftStake(a, v, { ...partyChoice(fd), unitKey, sharePercent: str(fd, "sharePercent"), validFrom: str(fd, "validFrom") }, proof), undefined, keep);
}

export async function removeStakeAction(fd: FormData) {
  await run("vlasnici", fd, (a, v) => removeDraftStake(a, v, str(fd, "key")), undefined, `&jedinica=${encodeURIComponent(str(fd, "unitKey"))}`);
}

export async function setDisputedAction(fd: FormData) {
  await run("vlasnici", fd, (a, v) => setUnitDisputed(a, v, str(fd, "unitKey"), str(fd, "value") === "true"));
}

export async function setAccountantAction(fd: FormData) {
  await run("organi-i-nalozi", fd, (a, v) =>
    setDraftAccountant(a, v, {
      ...partyChoice(fd), validFrom: str(fd, "validFrom"),
      loginEmail: fd.get("withLogin") === "on" ? str(fd, "loginEmail") : null,
      password: str(fd, "password"),
    })
  );
}

export async function setAccountantLaterAction(fd: FormData) {
  await run("organi-i-nalozi", fd, (a, v) => setAccountantLater(a, v, str(fd, "value") === "true"));
}

export async function addBoardMemberAction(fd: FormData) {
  await run("organi-i-nalozi", fd, (a, v) => addDraftBoardMember(a, v, { ...partyChoice(fd), validFrom: str(fd, "validFrom") }));
}

export async function removeBoardMemberAction(fd: FormData) {
  await run("organi-i-nalozi", fd, (a, v) => removeDraftBoardMember(a, v, str(fd, "key")));
}

/** Objava: nastaje ZEV, sesija prelazi na njega, korisnik ide na početnu svog novog ZEV-a. */
export async function publishAction(fd: FormData) {
  const actor = await requireActor();
  let zevId: string;
  try {
    ({ zevId } = await publishOnboardingDraft(actor, Number(fd.get("version"))));
  } catch (e) {
    redirect(`/onboarding/pregled?err=${encodeURIComponent(e instanceof Error ? e.message : "Greška")}`);
  }
  if (actor.sessionId) await setSessionActiveZev(actor.sessionId, zevId);
  revalidatePath("/", "layout");
  redirect("/?msg=onboarding_published");
}
