// Bilješke i zaključci sa sjednice + zapisničar (Plans/sjednica-uzivo-biljeske-i-zapisnik-plan.md, v2.54.0).
//
// Pišu predsjednik i računovođa (isti krug kao režim uživo, P-B2). Bilješke se mogu mijenjati i brisati do finalizacije
// zapisnika (P-B5); svaka promjena ide u audit sa tekstom prije i poslije, jer tabela nije append-only. Dva uređaja
// ne prepisuju jedan drugog: izmjena nosi `version` koji je korisnik vidio, pa zastarjela izmjena dobija poruku
// umjesto da tiho pregazi tuđi tekst.
import { prisma } from "@/lib/prisma";
import { audit } from "@/server/audit";
import { requireRole, requireZev, ForbiddenError, type Actor } from "@/server/auth/guards";
import { partyDisplayName } from "./ownership";
import { moveNeighbor, noteCounts, notesOfItem, offAgendaTopics, type NoteKind } from "@/lib/meetingNotes";
import { t, tf } from "@/lib/i18n";
import type { MeetingStatus, MeetingBody } from "@/generated/prisma/client";

/** Od "Zakazana" (priprema) do "Odluke evidentirane" (P-B5 + plan §2.2). */
export const NOTE_WRITABLE_STATUSES: MeetingStatus[] = [
  "SCHEDULED", "INVITATIONS_PREPARED", "INVITATIONS_SENT", "VOTING_OPEN", "VOTING_CLOSED", "RESULTS_REVIEW", "DECISION_RECORDED",
];

const LOCKED_STATUSES: MeetingStatus[] = ["MINUTES_FINALIZED", "ARCHIVED"];

/** Pogrešan unos (prazan tekst, tema bez naslova…) — poruka je namijenjena korisniku. */
export class NoteInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NoteInputError";
  }
}

export class NoteConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NoteConflictError";
  }
}

export type MeetingNoteRow = {
  id: string;
  agendaItemId: string | null;
  topic: string | null;
  kind: NoteKind;
  text: string;
  position: number;
  version: number;
  updatedAt: Date;
};

const MAX_TEXT = 5000;
const MAX_TOPIC = 200;

function noteState(status: MeetingStatus): "writable" | "locked" | "early" {
  if (LOCKED_STATUSES.includes(status)) return "locked";
  return NOTE_WRITABLE_STATUSES.includes(status) ? "writable" : "early";
}

function assertWritable(status: MeetingStatus) {
  const s = noteState(status);
  if (s === "locked") throw new ForbiddenError(t("meetingNotes.err.locked"));
  if (s === "early") throw new ForbiddenError(t("meetingNotes.err.early"));
}

function cleanText(raw: string): string {
  const text = raw.replace(/\r\n/g, "\n").trim();
  if (!text) throw new NoteInputError(t("meetingNotes.err.textEmpty"));
  if (text.length > MAX_TEXT) throw new NoteInputError(tf("meetingNotes.err.textTooLong", { broj: MAX_TEXT }));
  return text;
}

function toRow(n: { id: string; agendaItemId: string | null; topic: string | null; kind: NoteKind; text: string; position: number; version: number; updatedAt: Date }): MeetingNoteRow {
  return { id: n.id, agendaItemId: n.agendaItemId, topic: n.topic, kind: n.kind, text: n.text, position: n.position, version: n.version, updatedAt: n.updatedAt };
}

async function loadMeeting(zevId: string, meetingId: string) {
  return prisma.meeting.findUniqueOrThrow({ where: { id: meetingId, zevId }, select: { id: true, status: true } });
}

async function updaterName(zevId: string, userId: string): Promise<string> {
  const party = await prisma.party.findFirst({ where: { zevId, userId } });
  if (party) return partyDisplayName(party) || t("meetingNotes.err.someone");
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { email: true } });
  return user?.email ?? t("meetingNotes.err.someone");
}

export async function listMeetingNotes(actor: Actor, meetingId: string): Promise<MeetingNoteRow[]> {
  requireRole(actor, "PRESIDENT", "ACCOUNTANT");
  const zevId = requireZev(actor);
  await loadMeeting(zevId, meetingId);
  const rows = await prisma.meetingNote.findMany({ where: { zevId, meetingId }, orderBy: [{ position: "asc" }, { createdAt: "asc" }] });
  return rows.map(toRow);
}

export async function addMeetingNote(
  actor: Actor,
  data: { meetingId: string; agendaItemId?: string | null; topic?: string | null; kind: NoteKind; text: string }
): Promise<MeetingNoteRow> {
  requireRole(actor, "PRESIDENT", "ACCOUNTANT");
  const zevId = requireZev(actor);
  const meeting = await loadMeeting(zevId, data.meetingId);
  assertWritable(meeting.status);
  if (data.kind !== "NOTE" && data.kind !== "CONCLUSION") throw new NoteInputError(t("meetingNotes.err.kind"));
  const text = cleanText(data.text);
  const agendaItemId = data.agendaItemId || null;
  let topic: string | null = null;
  if (agendaItemId) {
    // AgendaItem has no zevId of its own — the tenant is proven through its Meeting (same zevId already checked above).
    const item = await prisma.agendaItem.findFirst({ where: { id: agendaItemId, meetingId: data.meetingId } });
    if (!item) throw new NoteInputError(t("meetingNotes.err.itemNotInMeeting"));
  } else {
    topic = (data.topic ?? "").trim().replace(/\s+/g, " ");
    if (!topic) throw new NoteInputError(t("meetingNotes.err.topicRequired"));
    if (topic.length > MAX_TOPIC) throw new NoteInputError(tf("meetingNotes.err.topicTooLong", { broj: MAX_TOPIC }));
  }

  const created = await prisma.$transaction(async (tx) => {
    if (topic) {
      // Ista tema se prepoznaje bez obzira na velika/mala slova: koristi se već upisan naslov.
      const existing = await tx.meetingNote.findFirst({
        where: { zevId, meetingId: data.meetingId, agendaItemId: null, topic: { equals: topic, mode: "insensitive" } },
        orderBy: { position: "asc" },
      });
      if (existing?.topic) topic = existing.topic;
    }
    const max = await tx.meetingNote.aggregate({ where: { zevId, meetingId: data.meetingId, agendaItemId }, _max: { position: true } });
    return tx.meetingNote.create({
      data: {
        zevId, meetingId: data.meetingId, agendaItemId, topic, kind: data.kind, text,
        position: (max._max.position ?? 0) + 1, createdById: actor.userId, updatedById: actor.userId,
      },
    });
  });
  await audit(actor, {
    action: "meeting.note.create", targetType: "MeetingNote", targetId: created.id,
    after: { meetingId: data.meetingId, agendaItemId, topic, kind: created.kind, text },
  });
  return toRow(created);
}

export async function updateMeetingNote(
  actor: Actor,
  id: string,
  data: { text: string; kind?: NoteKind; expectedVersion: number }
): Promise<MeetingNoteRow> {
  requireRole(actor, "PRESIDENT", "ACCOUNTANT");
  const zevId = requireZev(actor);
  const before = await prisma.meetingNote.findFirst({ where: { id, zevId } });
  if (!before) throw new NoteConflictError(t("meetingNotes.err.gone"));
  const meeting = await loadMeeting(zevId, before.meetingId);
  assertWritable(meeting.status);
  const text = cleanText(data.text);
  const kind = data.kind ?? before.kind;
  if (kind !== "NOTE" && kind !== "CONCLUSION") throw new NoteInputError(t("meetingNotes.err.kind"));

  const res = await prisma.meetingNote.updateMany({
    where: { id, zevId, version: data.expectedVersion },
    data: { text, kind, updatedById: actor.userId, version: { increment: 1 } },
  });
  if (res.count === 0) {
    const current = await prisma.meetingNote.findFirst({ where: { id, zevId } });
    if (!current) throw new NoteConflictError(t("meetingNotes.err.gone"));
    throw new NoteConflictError(tf("meetingNotes.err.stale", { ime: await updaterName(zevId, current.updatedById) }));
  }
  const after = await prisma.meetingNote.findFirstOrThrow({ where: { id, zevId } });
  await audit(actor, {
    action: "meeting.note.update", targetType: "MeetingNote", targetId: id,
    before: { kind: before.kind, text: before.text, version: before.version },
    after: { kind: after.kind, text: after.text, version: after.version },
  });
  return toRow(after);
}

export async function deleteMeetingNote(actor: Actor, id: string, expectedVersion?: number): Promise<void> {
  requireRole(actor, "PRESIDENT", "ACCOUNTANT");
  const zevId = requireZev(actor);
  const before = await prisma.meetingNote.findFirst({ where: { id, zevId } });
  if (!before) throw new NoteConflictError(t("meetingNotes.err.gone"));
  const meeting = await loadMeeting(zevId, before.meetingId);
  assertWritable(meeting.status);
  if (expectedVersion !== undefined && before.version !== expectedVersion) {
    throw new NoteConflictError(tf("meetingNotes.err.stale", { ime: await updaterName(zevId, before.updatedById) }));
  }
  const res = await prisma.meetingNote.deleteMany({ where: { id, zevId, version: before.version } });
  if (res.count === 0) throw new NoteConflictError(t("meetingNotes.err.gone"));
  await audit(actor, {
    action: "meeting.note.delete", targetType: "MeetingNote", targetId: id,
    before: { meetingId: before.meetingId, agendaItemId: before.agendaItemId, topic: before.topic, kind: before.kind, text: before.text, version: before.version },
  });
}

/** Zamjena mjesta sa susjedom istog tipa u istoj tački/temi (zaključci se prikazuju odvojeno od bilješki). */
export async function moveMeetingNote(actor: Actor, id: string, direction: "up" | "down"): Promise<void> {
  requireRole(actor, "PRESIDENT", "ACCOUNTANT");
  const zevId = requireZev(actor);
  const note = await prisma.meetingNote.findFirst({ where: { id, zevId } });
  if (!note) throw new NoteConflictError(t("meetingNotes.err.gone"));
  const meeting = await loadMeeting(zevId, note.meetingId);
  assertWritable(meeting.status);
  const all = await prisma.meetingNote.findMany({ where: { zevId, meetingId: note.meetingId, agendaItemId: note.agendaItemId } });
  const neighbor = moveNeighbor(all, note, direction);
  if (!neighbor) return;
  await prisma.$transaction([
    prisma.meetingNote.update({ where: { id: note.id }, data: { position: neighbor.position, updatedById: actor.userId, version: { increment: 1 } } }),
    prisma.meetingNote.update({ where: { id: neighbor.id }, data: { position: note.position, updatedById: actor.userId, version: { increment: 1 } } }),
  ]);
  await audit(actor, {
    action: "meeting.note.move", targetType: "MeetingNote", targetId: id,
    before: { position: note.position }, after: { position: neighbor.position, direction },
  });
}

// ---- Zapisničar (P-B4) ----

/** Lica koja se mogu odrediti za zapisničara: aktivna lica evidencije ZEV-a. */
export async function listMinutesTakerCandidates(actor: Actor) {
  requireRole(actor, "PRESIDENT", "ACCOUNTANT");
  const parties = await prisma.party.findMany({
    where: { zevId: requireZev(actor), active: true },
    orderBy: [{ lastName: "asc" }, { orgName: "asc" }, { firstName: "asc" }],
  });
  return parties.map((p) => ({ id: p.id, name: partyDisplayName(p) })).filter((p) => p.name);
}

export async function setMinutesTaker(actor: Actor, meetingId: string, partyId: string | null): Promise<void> {
  requireRole(actor, "PRESIDENT", "ACCOUNTANT");
  const zevId = requireZev(actor);
  const meeting = await prisma.meeting.findUniqueOrThrow({ where: { id: meetingId, zevId }, select: { id: true, status: true, minutesTakerId: true } });
  if (LOCKED_STATUSES.includes(meeting.status)) throw new ForbiddenError(t("meetingNotes.err.locked"));
  if (partyId) await prisma.party.findUniqueOrThrow({ where: { id: partyId, zevId, active: true }, select: { id: true } });
  await prisma.meeting.update({ where: { id: meetingId, zevId }, data: { minutesTakerId: partyId } });
  await audit(actor, {
    action: "meeting.minutes_taker.set", targetType: "Meeting", targetId: meetingId,
    before: { minutesTakerId: meeting.minutesTakerId }, after: { minutesTakerId: partyId },
  });
}

// ---- Sadržaj zapisnika: jedan izvor za pregled (uživo, detalj sjednice) i za PDF ----

export type MinutesProposal = {
  id: string;
  code: string;
  version: number;
  title: string;
  text: string;
  status: string;
  decisionNumber: string | null;
  result: { approveWeight: string; rejectWeight: string; abstainWeight: string; quorumReached: boolean; accepted: boolean } | null;
};

export type MinutesItem = {
  id: string;
  order: number;
  title: string;
  proposals: MinutesProposal[];
  conclusions: MeetingNoteRow[];
  notes: MeetingNoteRow[];
};

export type MinutesTopic = { topic: string; conclusions: MeetingNoteRow[]; notes: MeetingNoteRow[] };

export type MinutesContent = {
  meeting: {
    id: string;
    title: string;
    body: MeetingBody;
    status: MeetingStatus;
    scheduledAt: Date | null;
    location: string | null;
    discussionNotes: string | null;
    minutesTaker: { id: string; name: string } | null;
  };
  items: MinutesItem[];
  /** Prijedlozi koji nisu vezani ni za jednu tačku (zapisnik ih ipak mora pokazati). */
  unlinkedProposals: MinutesProposal[];
  topics: MinutesTopic[];
  counts: { conclusions: number; notes: number };
  state: "writable" | "locked" | "early";
};

/** Bez provjere uloge — pozivaju je samo servisi koji su je već obavili (UI pregled, `generateMinutesPdf`). */
export async function loadMinutesContent(zevId: string, meetingId: string): Promise<MinutesContent> {
  const meeting = await prisma.meeting.findUniqueOrThrow({
    where: { id: meetingId, zevId },
    include: {
      agendaItems: { orderBy: { order: "asc" } },
      proposals: { where: { status: { notIn: ["WITHDRAWN", "SUPERSEDED"] } }, orderBy: { code: "asc" } },
      minutesTaker: true,
    },
  });
  const noteRows = (await prisma.meetingNote.findMany({ where: { zevId, meetingId }, orderBy: [{ position: "asc" }, { createdAt: "asc" }] })).map(toRow);
  const toProposal = (p: (typeof meeting.proposals)[number]): MinutesProposal => {
    const r = p.resultSummary as { approveWeight?: string; rejectWeight?: string; abstainWeight?: string; quorumReached?: boolean; accepted?: boolean } | null;
    return {
      id: p.id, code: p.code, version: p.version, title: p.title, text: p.text, status: p.status, decisionNumber: p.decisionNumber,
      result: r
        ? { approveWeight: r.approveWeight ?? "0", rejectWeight: r.rejectWeight ?? "0", abstainWeight: r.abstainWeight ?? "0", quorumReached: Boolean(r.quorumReached), accepted: Boolean(r.accepted) }
        : null,
    };
  };
  return {
    meeting: {
      id: meeting.id, title: meeting.title, body: meeting.body, status: meeting.status, scheduledAt: meeting.scheduledAt,
      location: meeting.location, discussionNotes: meeting.discussionNotes,
      minutesTaker: meeting.minutesTaker ? { id: meeting.minutesTaker.id, name: partyDisplayName(meeting.minutesTaker) } : null,
    },
    items: meeting.agendaItems.map((a) => ({
      id: a.id, order: a.order, title: a.title,
      proposals: meeting.proposals.filter((p) => p.agendaItemId === a.id).map(toProposal),
      ...notesOfItem(noteRows, a.id),
    })),
    unlinkedProposals: meeting.proposals.filter((p) => !p.agendaItemId).map(toProposal),
    topics: offAgendaTopics(noteRows),
    counts: noteCounts(noteRows),
    state: noteState(meeting.status),
  };
}

export async function getMinutesContent(actor: Actor, meetingId: string): Promise<MinutesContent> {
  requireRole(actor, "PRESIDENT", "ACCOUNTANT");
  return loadMinutesContent(requireZev(actor), meetingId);
}

