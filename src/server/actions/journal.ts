"use server";
// Server akcije naloga i perioda (B1a). Samo čitaju formu i zovu journal.ts, koji provjerava prava i pravila.
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireActor } from "@/server/actor";
import * as j from "@/server/services/journal";

const str = (fd: FormData, k: string) => String(fd.get(k) ?? "");
const errUrl = (path: string, e: unknown) => `${path}${path.includes("?") ? "&" : "?"}err=${encodeURIComponent(e instanceof Error ? e.message : "Greška")}`;

/**
 * Snimanje nacrta iz uređivača (useActionState): greška se VRAĆA formi, pa uneseni redovi ostaju na ekranu;
 * uspjeh preusmjerava na stranicu naloga.
 */
export async function saveJournalDraftAction(_prev: { error: string } | null, fd: FormData): Promise<{ error: string } | null> {
  const actor = await requireActor("ACCOUNTANT");
  const id = str(fd, "id") || null;
  let entryId: string;
  try {
    const lines = JSON.parse(str(fd, "payload") || "[]") as j.JournalLineInput[];
    const e = await j.saveDraft(actor, { documentDate: str(fd, "documentDate"), postingDate: str(fd, "postingDate"), description: str(fd, "description"), lines }, id);
    entryId = e.id;
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Greška" };
  }
  revalidatePath("/knjigovodstvo");
  redirect(`/knjigovodstvo/nalozi/${entryId}?msg=journalSaved`);
}

async function onEntry(fd: FormData, msg: string, fn: (id: string) => Promise<unknown>, after?: (res: unknown) => string) {
  const id = str(fd, "id");
  let target = `/knjigovodstvo/nalozi/${id}?msg=${msg}`;
  try {
    const res = await fn(id);
    if (after) target = after(res);
  } catch (e) {
    target = errUrl(`/knjigovodstvo/nalozi/${id}`, e);
  }
  revalidatePath("/knjigovodstvo");
  redirect(target);
}

export async function postJournalAction(fd: FormData) {
  const actor = await requireActor("ACCOUNTANT");
  await onEntry(fd, "journalPosted", (id) => j.postEntry(actor, id));
}

export async function deleteJournalDraftAction(fd: FormData) {
  const actor = await requireActor("ACCOUNTANT");
  await onEntry(fd, "journalDeleted", (id) => j.deleteDraft(actor, id), () => "/knjigovodstvo?tab=nalozi&msg=journalDeleted");
}

export async function reverseJournalAction(fd: FormData) {
  const actor = await requireActor("ACCOUNTANT");
  await onEntry(
    fd, "journalReversed",
    (id) => j.reverseEntry(actor, id, { reason: str(fd, "reason"), postingDate: str(fd, "postingDate") }),
    (res) => `/knjigovodstvo/nalozi/${(res as { id: string }).id}?msg=journalReversed`
  );
}

async function onPeriod(msg: string, fn: () => Promise<unknown>) {
  let target = `/knjigovodstvo?tab=godine&msg=${msg}`;
  try {
    await fn();
  } catch (e) {
    target = errUrl("/knjigovodstvo?tab=godine", e);
  }
  revalidatePath("/knjigovodstvo");
  redirect(target);
}

export async function closePeriodAction(fd: FormData) {
  const actor = await requireActor("ACCOUNTANT");
  await onPeriod("periodClosed", () => j.closePeriod(actor, str(fd, "periodId")));
}

export async function requestReopenAction(fd: FormData) {
  const actor = await requireActor("PRESIDENT", "ACCOUNTANT");
  await onPeriod("reopenRequested", () => j.requestReopen(actor, str(fd, "periodId"), str(fd, "reason")));
}

export async function decideReopenAction(fd: FormData) {
  const actor = await requireActor("PRESIDENT", "ACCOUNTANT");
  const approve = str(fd, "decision") === "APPROVED";
  await onPeriod(approve ? "reopenApproved" : "reopenRejected", () => j.decideReopen(actor, str(fd, "requestId"), approve, str(fd, "note") || null));
}
