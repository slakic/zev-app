"use server";
// Server akcije naloga i perioda (B1a). Samo čitaju formu i zovu journal.ts, koji provjerava prava i pravila.
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireActor } from "@/server/actor";
import * as j from "@/server/services/journal";
import * as ob from "@/server/services/openingBalance";
import * as ev from "@/server/services/ledgerEvents";

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

// ---------------------------------------------------------------------------
// Početno stanje (B1b)
// ---------------------------------------------------------------------------

const OPENING = "/knjigovodstvo/pocetno-stanje";

export async function prepareOpeningAction(fd: FormData) {
  const actor = await requireActor("ACCOUNTANT");
  let target = `${OPENING}?msg=openingPrepared`;
  try {
    await ob.prepareOpening(actor, { startDate: str(fd, "startDate") });
  } catch (e) {
    target = errUrl(OPENING, e);
  }
  revalidatePath("/knjigovodstvo");
  redirect(target);
}

/** Ručne stavke nacrta početnog stanja iz uređivača (useActionState, kao saveJournalDraftAction). */
export async function saveOpeningLinesAction(_prev: { error: string } | null, fd: FormData): Promise<{ error: string } | null> {
  const actor = await requireActor("ACCOUNTANT");
  try {
    const lines = JSON.parse(str(fd, "payload") || "[]") as j.JournalLineInput[];
    await ob.saveOpeningManualLines(actor, str(fd, "id"), { description: str(fd, "description"), lines });
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Greška" };
  }
  revalidatePath("/knjigovodstvo");
  redirect(`${OPENING}?msg=openingSaved`);
}

export async function postOpeningAction(fd: FormData) {
  const actor = await requireActor("ACCOUNTANT");
  const id = str(fd, "id");
  let target = `/knjigovodstvo/nalozi/${id}?msg=journalPosted`;
  try {
    await j.postEntry(actor, id);
  } catch (e) {
    target = errUrl(OPENING, e);
  }
  revalidatePath("/knjigovodstvo");
  redirect(target);
}

// ---------------------------------------------------------------------------
// Automatsko knjiženje (B2)
// ---------------------------------------------------------------------------

const EVENTS = "/knjigovodstvo?tab=dogadjaji";

export async function processPendingAction() {
  const actor = await requireActor("ACCOUNTANT");
  let target: string;
  try {
    const r = await ev.processPending(actor);
    target = `${EVENTS}&msg=eventsProcessed&proknjizeno=${r.posted}&ceka=${r.waiting}`;
  } catch (e) {
    target = errUrl(EVENTS, e);
  }
  revalidatePath("/knjigovodstvo");
  redirect(target);
}

export async function postEventIntoPeriodAction(fd: FormData) {
  const actor = await requireActor("ACCOUNTANT");
  let target = `${EVENTS}&msg=eventPosted`;
  try {
    await ev.postEventIntoOpenPeriod(actor, str(fd, "eventId"));
  } catch (e) {
    target = errUrl(EVENTS, e);
  }
  revalidatePath("/knjigovodstvo");
  redirect(target);
}
