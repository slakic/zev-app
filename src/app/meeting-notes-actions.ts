"use server";
// Server akcije bilješki i zaključaka sa sjednice — dijele ih režim uživo (/uzivo/[meetingId]) i detalj sjednice
// (/skupstina/[id]). Svaka sama poziva requireActor (isti razlog kao u /uzivo: ruta je van (app) layouta), a pravo
// pisanja provjerava servis. Čuvanje i izmjena vraćaju rezultat (tekst u polju ne smije nestati), a brisanje,
// pomjeranje i zapisničar su obični obrasci pa greška ide u ?err= na stranicu odakle su došli.
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireActor } from "@/server/actor";
import {
  addMeetingNote, updateMeetingNote, deleteMeetingNote, moveMeetingNote, setMinutesTaker,
  NoteInputError, NoteConflictError,
} from "@/server/services/meetingNotes";
import { generateMinutesPdf } from "@/server/services/documents";
import { ForbiddenError } from "@/server/auth/guards";
import { t } from "@/lib/i18n";

export type NoteActionState = { ok: boolean; error?: string; at: number } | null;

function userMessage(e: unknown): string {
  if (e instanceof NoteInputError || e instanceof NoteConflictError || e instanceof ForbiddenError) return e.message;
  return t("meetingNotes.err.saveFailed");
}

function refresh(meetingId: string) {
  revalidatePath(`/uzivo/${meetingId}`);
  revalidatePath(`/skupstina/${meetingId}`);
}

function safeReturn(raw: FormDataEntryValue | null, meetingId: string): string {
  const v = String(raw ?? "");
  return v.startsWith("/uzivo/") || v.startsWith("/skupstina/") ? v : `/skupstina/${meetingId}`;
}

function withErr(path: string, message: string): string {
  const [base, hash] = path.split("#");
  return `${base}${base.includes("?") ? "&" : "?"}err=${encodeURIComponent(message)}${hash ? `#${hash}` : ""}`;
}

export async function saveNoteAction(formData: FormData): Promise<NoteActionState> {
  const actor = await requireActor("PRESIDENT", "ACCOUNTANT");
  const meetingId = String(formData.get("meetingId"));
  try {
    await addMeetingNote(actor, {
      meetingId,
      agendaItemId: String(formData.get("agendaItemId") ?? "") || null,
      topic: String(formData.get("topic") ?? ""),
      kind: String(formData.get("kind")) as "NOTE" | "CONCLUSION",
      text: String(formData.get("text") ?? ""),
    });
  } catch (e) {
    return { ok: false, error: userMessage(e), at: Date.now() };
  }
  refresh(meetingId);
  return { ok: true, at: Date.now() };
}

export async function updateNoteAction(formData: FormData): Promise<NoteActionState> {
  const actor = await requireActor("PRESIDENT", "ACCOUNTANT");
  const meetingId = String(formData.get("meetingId"));
  try {
    await updateMeetingNote(actor, String(formData.get("id")), {
      text: String(formData.get("text") ?? ""),
      kind: String(formData.get("kind")) as "NOTE" | "CONCLUSION",
      expectedVersion: Number(formData.get("expectedVersion")),
    });
  } catch (e) {
    return { ok: false, error: userMessage(e), at: Date.now() };
  }
  refresh(meetingId);
  return { ok: true, at: Date.now() };
}

export async function deleteNoteAction(formData: FormData) {
  const actor = await requireActor("PRESIDENT", "ACCOUNTANT");
  const meetingId = String(formData.get("meetingId"));
  const back = safeReturn(formData.get("returnTo"), meetingId);
  let error: string | null = null;
  try {
    await deleteMeetingNote(actor, String(formData.get("id")), Number(formData.get("expectedVersion")));
  } catch (e) {
    error = userMessage(e);
  }
  refresh(meetingId);
  if (error) redirect(withErr(back, error));
}

export async function moveNoteAction(formData: FormData) {
  const actor = await requireActor("PRESIDENT", "ACCOUNTANT");
  const meetingId = String(formData.get("meetingId"));
  const back = safeReturn(formData.get("returnTo"), meetingId);
  let error: string | null = null;
  try {
    await moveMeetingNote(actor, String(formData.get("id")), formData.get("direction") === "up" ? "up" : "down");
  } catch (e) {
    error = userMessage(e);
  }
  refresh(meetingId);
  if (error) redirect(withErr(back, error));
}

export async function setMinutesTakerAction(formData: FormData) {
  const actor = await requireActor("PRESIDENT", "ACCOUNTANT");
  const meetingId = String(formData.get("meetingId"));
  const back = safeReturn(formData.get("returnTo"), meetingId);
  let error: string | null = null;
  try {
    await setMinutesTaker(actor, meetingId, String(formData.get("partyId") ?? "") || null);
  } catch (e) {
    error = userMessage(e);
  }
  refresh(meetingId);
  if (error) redirect(withErr(back, error));
}

/** „Nacrt zapisnika (PDF)” iz režima uživo: generiše nacrt (PRESIDENT, kao na detalju sjednice) i otvara PDF. */
export async function draftMinutesPdfAction(formData: FormData) {
  const actor = await requireActor("PRESIDENT");
  const meetingId = String(formData.get("meetingId"));
  let docId: string | null = null;
  let error: string | null = null;
  try {
    docId = (await generateMinutesPdf(actor, meetingId, { finalize: false })).id;
  } catch (e) {
    error = userMessage(e);
  }
  if (error || !docId) redirect(withErr(`/uzivo/${meetingId}?tab=zapisnik`, error ?? t("meetingNotes.err.saveFailed")));
  redirect(`/api/dokumenti/${docId}`);
}
