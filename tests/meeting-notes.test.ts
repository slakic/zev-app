// Plans/sjednica-uzivo-biljeske-i-zapisnik-plan.md (v2.54.0): bilješke i zaključci sa sjednice, zapisničar i zapisnik (PDF).
import { describe, it, expect } from "vitest";
import { prisma } from "@/lib/prisma";
import { createFixture, type Fixture } from "./helpers";
import { createMeeting, addAgendaItem, getMeetingNextStepInput } from "@/server/services/meetings";
import {
  addMeetingNote, updateMeetingNote, deleteMeetingNote, moveMeetingNote, listMeetingNotes, setMinutesTaker,
  getMinutesContent, NoteConflictError,
} from "@/server/services/meetingNotes";
import { generateMinutesPdf, readDocumentFile } from "@/server/services/documents";
import { extractPdfText } from "@/server/services/bankStatementPdf";
import { meetingNextStep } from "@/lib/meetingNextStep";
import type { MeetingStatus } from "@/generated/prisma/client";

async function setup(tag: string, opts?: { body?: "ASSEMBLY" | "BOARD"; status?: MeetingStatus }) {
  const f: Fixture = await createFixture(tag);
  const meeting = await createMeeting(f.president, { title: `Sjednica ${f.t}`, type: "REGULAR", body: opts?.body ?? "ASSEMBLY", scheduledAt: new Date("2026-11-20T17:00:00Z"), location: "Sala" });
  const a1 = await addAgendaItem(f.president, { meetingId: meeting.id, title: "Usvajanje budžeta" });
  const a2 = await addAgendaItem(f.president, { meetingId: meeting.id, title: "Razno" });
  await prisma.meeting.update({ where: { id: meeting.id }, data: { status: opts?.status ?? "VOTING_OPEN" } });
  return { f, meeting, a1, a2 };
}

describe("meetingNotes service — guards and rules", () => {
  it("owner is refused; president and accountant may write", async () => {
    const { f, meeting, a1 } = await setup("mn-guard");
    await expect(addMeetingNote(f.actorA, { meetingId: meeting.id, agendaItemId: a1.id, kind: "NOTE", text: "x" })).rejects.toThrow();
    await expect(listMeetingNotes(f.actorA, meeting.id)).rejects.toThrow();
    await addMeetingNote(f.president, { meetingId: meeting.id, agendaItemId: a1.id, kind: "NOTE", text: "od predsjednika" });
    await addMeetingNote(f.accountant, { meetingId: meeting.id, agendaItemId: a1.id, kind: "CONCLUSION", text: "od računovođe" });
    expect((await listMeetingNotes(f.president, meeting.id)).map((n) => n.text)).toEqual(["od predsjednika", "od računovođe"]);
  });

  it("another ZEV cannot read or write the notes of this meeting", async () => {
    const { f, meeting, a1 } = await setup("mn-tenant");
    const other: Fixture = await createFixture("mn-tenant-b");
    const note = await addMeetingNote(f.president, { meetingId: meeting.id, agendaItemId: a1.id, kind: "NOTE", text: "tajno" });
    await expect(listMeetingNotes(other.president, meeting.id)).rejects.toThrow();
    await expect(addMeetingNote(other.president, { meetingId: meeting.id, agendaItemId: a1.id, kind: "NOTE", text: "x" })).rejects.toThrow();
    await expect(updateMeetingNote(other.president, note.id, { text: "x", expectedVersion: 1 })).rejects.toThrow(NoteConflictError);
    await expect(deleteMeetingNote(other.president, note.id)).rejects.toThrow(NoteConflictError);
    await expect(moveMeetingNote(other.president, note.id, "up")).rejects.toThrow(NoteConflictError);
    expect((await prisma.meetingNote.findUniqueOrThrow({ where: { id: note.id } })).text).toBe("tajno");
  });

  it("an agenda item of another meeting is refused", async () => {
    const { f, meeting } = await setup("mn-foreign-item");
    const other = await setup("mn-foreign-item2");
    await expect(addMeetingNote(f.president, { meetingId: meeting.id, agendaItemId: other.a1.id, kind: "NOTE", text: "x" })).rejects.toThrow(/ne pripada/);
  });

  it("a topic outside the agenda needs a title; empty text is refused; the same topic (any case) is grouped", async () => {
    const { f, meeting } = await setup("mn-topic");
    await expect(addMeetingNote(f.president, { meetingId: meeting.id, kind: "NOTE", text: "bez teme" })).rejects.toThrow(/naslov/);
    await expect(addMeetingNote(f.president, { meetingId: meeting.id, topic: "Parking", kind: "NOTE", text: "   " })).rejects.toThrow(/prazan/);
    await addMeetingNote(f.president, { meetingId: meeting.id, topic: "Parking", kind: "NOTE", text: "prvo" });
    const second = await addMeetingNote(f.president, { meetingId: meeting.id, topic: "  parking ", kind: "CONCLUSION", text: "drugo" });
    expect(second.topic).toBe("Parking");
    const content = await getMinutesContent(f.president, meeting.id);
    expect(content.topics).toHaveLength(1);
    expect(content.topics[0].conclusions.map((n) => n.text)).toEqual(["drugo"]);
    expect(content.topics[0].notes.map((n) => n.text)).toEqual(["prvo"]);
  });

  it("writable from SCHEDULED; not from DRAFT", async () => {
    const early = await setup("mn-draft", { status: "DRAFT" });
    await expect(addMeetingNote(early.f.president, { meetingId: early.meeting.id, agendaItemId: early.a1.id, kind: "NOTE", text: "x" })).rejects.toThrow(/zakazane/);
    const sched = await setup("mn-sched", { status: "SCHEDULED" });
    await addMeetingNote(sched.f.president, { meetingId: sched.meeting.id, agendaItemId: sched.a1.id, kind: "NOTE", text: "priprema" });
    const rec = await setup("mn-rec", { status: "DECISION_RECORDED" });
    await addMeetingNote(rec.f.president, { meetingId: rec.meeting.id, agendaItemId: rec.a1.id, kind: "NOTE", text: "ispravka" });
  });

  it("a stale version is refused with the editor's name instead of overwriting", async () => {
    const { f, meeting, a1 } = await setup("mn-stale");
    const note = await addMeetingNote(f.president, { meetingId: meeting.id, agendaItemId: a1.id, kind: "NOTE", text: "v1" });
    const v2 = await updateMeetingNote(f.president, note.id, { text: "v2 od predsjednika", expectedVersion: note.version });
    expect(v2.version).toBe(2);
    const err = await updateMeetingNote(f.accountant, note.id, { text: "računovođa piše preko", expectedVersion: 1 }).catch((e) => e);
    expect(err).toBeInstanceOf(NoteConflictError);
    expect(err.message).toMatch(/u međuvremenu promijenio/);
    expect(err.message).toContain("Petar");
    expect((await prisma.meetingNote.findUniqueOrThrow({ where: { id: note.id } })).text).toBe("v2 od predsjednika");
    // a deleted note reads as such, not as a stale one
    await deleteMeetingNote(f.president, note.id);
    await expect(updateMeetingNote(f.accountant, note.id, { text: "x", expectedVersion: 2 })).rejects.toThrow(/obrisana/);
  });

  it("everything is refused after the minutes are finalized (also minute-taker)", async () => {
    const { f, meeting, a1 } = await setup("mn-lock");
    const note = await addMeetingNote(f.president, { meetingId: meeting.id, agendaItemId: a1.id, kind: "NOTE", text: "prije" });
    await prisma.meeting.update({ where: { id: meeting.id }, data: { status: "MINUTES_FINALIZED" } });
    await expect(addMeetingNote(f.president, { meetingId: meeting.id, agendaItemId: a1.id, kind: "NOTE", text: "poslije" })).rejects.toThrow(/finalizovan/);
    await expect(updateMeetingNote(f.president, note.id, { text: "poslije", expectedVersion: 1 })).rejects.toThrow(/finalizovan/);
    await expect(deleteMeetingNote(f.president, note.id)).rejects.toThrow(/finalizovan/);
    await expect(moveMeetingNote(f.president, note.id, "down")).rejects.toThrow(/finalizovan/);
    await expect(setMinutesTaker(f.president, meeting.id, f.ownerA.id)).rejects.toThrow(/finalizovan/);
    await prisma.meeting.update({ where: { id: meeting.id }, data: { status: "ARCHIVED" } });
    await expect(deleteMeetingNote(f.president, note.id)).rejects.toThrow(/finalizovan/);
    expect((await getMinutesContent(f.president, meeting.id)).state).toBe("locked");
  });

  it("audits create / update / delete with the text before and after", async () => {
    const { f, meeting, a1 } = await setup("mn-audit");
    const note = await addMeetingNote(f.president, { meetingId: meeting.id, agendaItemId: a1.id, kind: "NOTE", text: "stari tekst" });
    await updateMeetingNote(f.president, note.id, { text: "novi tekst", kind: "CONCLUSION", expectedVersion: 1 });
    await deleteMeetingNote(f.president, note.id);
    const events = await prisma.auditEvent.findMany({ where: { targetId: note.id, zevId: f.zev.id }, orderBy: { createdAt: "asc" } });
    expect(events.map((e) => e.action)).toEqual(["meeting.note.create", "meeting.note.update", "meeting.note.delete"]);
    expect((events[0].after as { text: string }).text).toBe("stari tekst");
    expect(events[1].before).toMatchObject({ text: "stari tekst", kind: "NOTE" });
    expect(events[1].after).toMatchObject({ text: "novi tekst", kind: "CONCLUSION" });
    expect((events[2].before as { text: string }).text).toBe("novi tekst");
  });

  it("moves a note past its same-kind neighbour only", async () => {
    const { f, meeting, a1 } = await setup("mn-move");
    const add = (kind: "NOTE" | "CONCLUSION", text: string) => addMeetingNote(f.president, { meetingId: meeting.id, agendaItemId: a1.id, kind, text });
    const n1 = await add("NOTE", "n1");
    await add("CONCLUSION", "c1");
    const n2 = await add("NOTE", "n2");
    await moveMeetingNote(f.president, n2.id, "up");
    let c = (await getMinutesContent(f.president, meeting.id)).items[0];
    expect(c.notes.map((n) => n.text)).toEqual(["n2", "n1"]);
    expect(c.conclusions.map((n) => n.text)).toEqual(["c1"]);
    await moveMeetingNote(f.president, n2.id, "up"); // already first: no-op
    await moveMeetingNote(f.president, n1.id, "down"); // already last: no-op
    c = (await getMinutesContent(f.president, meeting.id)).items[0];
    expect(c.notes.map((n) => n.text)).toEqual(["n2", "n1"]);
  });

  it("minute-taker: set, clear, foreign party refused, audited", async () => {
    const { f, meeting } = await setup("mn-taker");
    const other: Fixture = await createFixture("mn-taker-b");
    await expect(setMinutesTaker(f.president, meeting.id, other.ownerA.id)).rejects.toThrow();
    await setMinutesTaker(f.accountant, meeting.id, f.ownerA.id);
    expect((await getMinutesContent(f.president, meeting.id)).meeting.minutesTaker?.id).toBe(f.ownerA.id);
    await setMinutesTaker(f.president, meeting.id, null);
    expect((await getMinutesContent(f.president, meeting.id)).meeting.minutesTaker).toBeNull();
    expect(await prisma.auditEvent.count({ where: { action: "meeting.minutes_taker.set", targetId: meeting.id } })).toBe(2);
    await expect(setMinutesTaker(f.actorA, meeting.id, f.ownerA.id)).rejects.toThrow();
  });
});

describe("minutes PDF", () => {
  it("puts conclusions under their item, results under their item's proposal, off-agenda section, taker and BOARD title", async () => {
    const { f, meeting, a1, a2 } = await setup("mn-pdf", { body: "BOARD", status: "DECISION_RECORDED" });
    await prisma.proposal.create({
      data: {
        zevId: f.zev.id, meetingId: meeting.id, agendaItemId: a1.id, code: "P-PDF-1", title: "Budžet za 2027", text: "Usvaja se budžet.",
        scopeType: "ZEV", votingRuleId: f.rule.id, status: "ACCEPTED", decisionNumber: "ODL-7",
        resultSummary: { approveWeight: "80.0000", rejectWeight: "10.0000", abstainWeight: "5.0000", quorumReached: true, accepted: true },
      },
    });
    await addMeetingNote(f.president, { meetingId: meeting.id, agendaItemId: a1.id, kind: "CONCLUSION", text: "Budžet se objavljuje na oglasnoj tabli." });
    await addMeetingNote(f.president, { meetingId: meeting.id, agendaItemId: a2.id, kind: "NOTE", text: "Pitanje kontejnera za otpad." });
    await addMeetingNote(f.president, { meetingId: meeting.id, topic: "Parking u dvorištu", kind: "CONCLUSION", text: "Tema ide na sljedeću sjednicu." });
    await setMinutesTaker(f.president, meeting.id, f.ownerA.id);

    const row = await generateMinutesPdf(f.president, meeting.id, { finalize: false });
    const text = await extractPdfText((await readDocumentFile(f.president, row.id)).buffer);

    expect(text).toContain("ZAPISNIK SA SJEDNICE UPRAVNOG ODBORA");
    expect(text).not.toContain("SJEDNICE SKUPŠTINE");
    const iItem1 = text.indexOf("1. Usvajanje budžeta", text.indexOf("Tok sjednice"));
    const iItem2 = text.indexOf("2. Razno", iItem1);
    const iResult = text.indexOf("P-PDF-1 v1");
    const iConclusion = text.indexOf("Budžet se objavljuje");
    const iNote = text.indexOf("Pitanje kontejnera");
    const iOff = text.indexOf("Van dnevnog reda");
    expect(iItem1).toBeGreaterThan(-1);
    expect(iResult).toBeGreaterThan(iItem1);
    expect(iResult).toBeLessThan(iItem2);
    expect(iConclusion).toBeGreaterThan(iItem1);
    expect(iConclusion).toBeLessThan(iItem2);
    expect(text).toContain("Zaključak 1:");
    expect(iNote).toBeGreaterThan(iItem2);
    expect(iNote).toBeLessThan(iOff);
    expect(text).toContain("USVOJENO");
    expect(text).toContain("ODL-7");
    expect(text).toContain("Parking u dvorištu");
    expect(text).toContain("Tema ide na sljedeću sjednicu.");
    expect(text).toContain("nije odlučivalo");
    expect(text).toContain("Zapisničar: Ana A-");
    expect(text).not.toContain("Tok rasprave");
  });

  it("ASSEMBLY title, legacy discussion text only when present, empty taker and empty item sentence", async () => {
    const { f, meeting } = await setup("mn-pdf2", { status: "DECISION_RECORDED" });
    let row = await generateMinutesPdf(f.president, meeting.id);
    let text = await extractPdfText((await readDocumentFile(f.president, row.id)).buffer);
    expect(text).toContain("ZAPISNIK SA SJEDNICE SKUPŠTINE");
    expect(text).toContain("Bez zapisanih zaključaka.");
    expect(text).not.toContain("Tok rasprave");
    expect(text).not.toContain("Van dnevnog reda");
    expect(text).toMatch(/Zapisničar:\s*\n?_+/);
    await prisma.meeting.update({ where: { id: meeting.id }, data: { discussionNotes: "Stara rasprava." } });
    row = await generateMinutesPdf(f.president, meeting.id);
    text = await extractPdfText((await readDocumentFile(f.president, row.id)).buffer);
    expect(text).toContain("Tok rasprave");
    expect(text).toContain("Stara rasprava.");
  });

  it("paginates a long list of notes without losing any of them", async () => {
    const { f, meeting, a1 } = await setup("mn-pdf3", { status: "DECISION_RECORDED" });
    for (let i = 1; i <= 45; i++) {
      await addMeetingNote(f.president, { meetingId: meeting.id, agendaItemId: a1.id, kind: i % 2 ? "NOTE" : "CONCLUSION", text: `Dugačka bilješka broj ${i}. `.repeat(6) });
    }
    const row = await generateMinutesPdf(f.president, meeting.id);
    const text = await extractPdfText((await readDocumentFile(f.president, row.id)).buffer);
    for (const i of [1, 22, 45]) expect(text).toContain(`Dugačka bilješka broj ${i}.`);
    expect(text).toContain("Zapisničar:");
  });
});

describe("Sljedeći korak — bilješke prije finalizacije zapisnika", () => {
  it("getMeetingNextStepInput counts notes and meetingNextStep warns for an item without any conclusion", async () => {
    const { f, meeting, a1 } = await setup("mn-step", { status: "DECISION_RECORDED" });
    await addMeetingNote(f.president, { meetingId: meeting.id, agendaItemId: a1.id, kind: "CONCLUSION", text: "z" });
    await addMeetingNote(f.president, { meetingId: meeting.id, agendaItemId: a1.id, kind: "NOTE", text: "b1" });
    await addMeetingNote(f.president, { meetingId: meeting.id, topic: "Tema", kind: "NOTE", text: "b2" });
    const { input } = await getMeetingNextStepInput(f.president, meeting.id);
    expect(input.minutesNotes).toMatchObject({ conclusions: 1, notes: 2, conclusionItemIds: [a1.id] });
    const step = meetingNextStep({ ...input, minutesDraftExists: true })!;
    const texts = step.preconditions.map((p) => `${p.ok ? "ok" : "warn"}:${p.text}`);
    expect(texts).toContain("ok:Zaključaka: 1, bilješki: 2.");
    expect(texts.some((x) => x.startsWith("warn:") && x.includes("Tačka 2") && x.includes("Razno"))).toBe(true);
    expect(texts.some((x) => x.includes("Tačka 1"))).toBe(false);
    expect(step.kind).toBe("confirm"); // upozorenje ne blokira
  });
});
