"use server";
// Akcije uvoza nacrta iz fajla (pregled → potvrda, kao bankPdfImport.ts): ne preusmjeravaju, vraćaju stanje koje
// klijentska komponenta prikazuje. Pravo pristupa se razrješava OVDJE na serveru: vlasnik uvijek radi nad SVOJIM nacrtom u
// toku (ID iz forme se ne uzima u obzir), a ID nacrta iz forme znači tuđi nacrt i prolazi samo za super admina sa
// aktivnim pristupom (draftAccessForAdminWeb).
import { revalidatePath } from "next/cache";
import { requireActor } from "@/server/actor";
import { t } from "@/lib/i18n";
import { DraftAccessError, draftAccessForAdminWeb, draftAccessForOwner, type DraftAccess } from "@/server/services/draftAccess";
import { StaleDraftError, getDraftByAccess, getMyDraft } from "@/server/services/onboarding";
import { commitDraftImport, previewDraftImport, type ImportPreview } from "@/server/services/onboardingImport";
import { IMPORT_MAX_BYTES } from "@/lib/onboarding/import/importFormat";

export type ImportPreviewState = { ok: true; preview: ImportPreview } | { ok: false; error: string };
export type ImportCommitState =
  | { ok: true; added: number; updated: number; proposals: number; nextStep: { slug: string; label: string } }
  | { ok: false; error: string };

async function resolveAccess(fd: FormData): Promise<{ access: DraftAccess; admin: boolean }> {
  const actor = await requireActor();
  const draftId = String(fd.get("draftId") ?? "");
  if (draftId) return { access: await draftAccessForAdminWeb(actor, draftId), admin: true };
  const mine = await getMyDraft(actor);
  if (!mine) throw new DraftAccessError(t("onboarding.noDraft"));
  return { access: await draftAccessForOwner(actor, mine.id), admin: false };
}

/** Fajl iz forme; veličina se provjerava prije čitanja bajtova. */
async function readFile(fd: FormData): Promise<{ filename: string; bytes: Uint8Array }> {
  const file = fd.get("file");
  if (!(file instanceof File) || file.size === 0) throw new Error(t("onboarding.import.msg.noFile"));
  if (file.size > IMPORT_MAX_BYTES) throw new Error(t("onboarding.import.msg.tooBig"));
  return { filename: file.name, bytes: new Uint8Array(await file.arrayBuffer()) };
}

function messageOf(e: unknown): string {
  if (e instanceof StaleDraftError) return t("onboarding.import.msg.stale");
  if (e instanceof Error) return e.message;
  return t("onboarding.import.msg.failed");
}

export async function previewDraftImportAction(fd: FormData): Promise<ImportPreviewState> {
  try {
    const { access } = await resolveAccess(fd);
    return { ok: true, preview: await previewDraftImport(access, await readFile(fd)) };
  } catch (e) {
    return { ok: false, error: messageOf(e) };
  }
}

export async function commitDraftImportAction(fd: FormData): Promise<ImportCommitState> {
  try {
    const { access } = await resolveAccess(fd);
    const file = await readFile(fd);
    const res = await commitDraftImport(access, { ...file, version: Number(fd.get("version")), sha256: String(fd.get("sha256") ?? "") });
    revalidatePath("/onboarding", "layout");
    revalidatePath(`/admin/nacrti/${access.draftId}`);
    const draft = await getDraftByAccess(access);
    const cur = draft.progress.steps.find((s) => s.key === draft.progress.currentStep)!;
    return { ok: true, added: res.added, updated: res.updated, proposals: res.proposals, nextStep: { slug: cur.slug, label: cur.label } };
  } catch (e) {
    return { ok: false, error: messageOf(e) };
  }
}
