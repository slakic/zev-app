// Čista logika bilješki i zaključaka sa sjednice (Plans/sjednica-uzivo-biljeske-i-zapisnik-plan.md): grupisanje po
// tački dnevnog reda i po temi van dnevnog reda. Isti izvor za režim uživo, detalj sjednice, "Sljedeći korak" i PDF
// zapisnika, pa sva četiri mjesta uvijek pokazuju isti redoslijed.

export type NoteKind = "NOTE" | "CONCLUSION";

export type NoteLike = {
  id: string;
  agendaItemId: string | null;
  topic: string | null;
  kind: NoteKind;
  position: number;
};

/** Zaključci i bilješke jedne tačke ili teme — zaključci prvi, svako u redoslijedu `position`. */
export type NoteGroup<T extends NoteLike> = { conclusions: T[]; notes: T[] };

export type OffAgendaTopic<T extends NoteLike> = NoteGroup<T> & { topic: string };

export const OFF_AGENDA_ID = "van";

const byPosition = <T extends NoteLike>(a: T, b: T) => a.position - b.position;

export function splitNotes<T extends NoteLike>(notes: T[]): NoteGroup<T> {
  const sorted = [...notes].sort(byPosition);
  return { conclusions: sorted.filter((n) => n.kind === "CONCLUSION"), notes: sorted.filter((n) => n.kind === "NOTE") };
}

/** Bilješke jedne tačke dnevnog reda. */
export function notesOfItem<T extends NoteLike>(notes: T[], agendaItemId: string): NoteGroup<T> {
  return splitNotes(notes.filter((n) => n.agendaItemId === agendaItemId));
}

/** Teme van dnevnog reda, redom po prvoj bilješci (najmanji `position`); ista tema = isti (obrezan) naslov. */
export function offAgendaTopics<T extends NoteLike>(notes: T[]): OffAgendaTopic<T>[] {
  const off = notes.filter((n) => n.agendaItemId === null).sort(byPosition);
  const order: string[] = [];
  const map = new Map<string, T[]>();
  for (const n of off) {
    const key = (n.topic ?? "").trim();
    if (!map.has(key)) {
      map.set(key, []);
      order.push(key);
    }
    map.get(key)!.push(n);
  }
  return order.map((topic) => ({ topic, ...splitNotes(map.get(topic)!) }));
}

export function noteCounts(notes: Pick<NoteLike, "kind">[]): { conclusions: number; notes: number } {
  return {
    conclusions: notes.filter((n) => n.kind === "CONCLUSION").length,
    notes: notes.filter((n) => n.kind === "NOTE").length,
  };
}

/** Prva bilješka istog tipa u istoj tački/temi prije ili poslije `note` (susjed za zamjenu mjesta), ili `null`. */
export function moveNeighbor<T extends NoteLike>(all: T[], note: T, direction: "up" | "down"): T | null {
  const topicKey = (n: T) => (n.topic ?? "").trim().toLowerCase();
  const sameScope = all
    .filter((n) => n.agendaItemId === note.agendaItemId && n.kind === note.kind && (note.agendaItemId !== null || topicKey(n) === topicKey(note)))
    .sort(byPosition);
  const i = sameScope.findIndex((n) => n.id === note.id);
  if (i < 0) return null;
  return (direction === "up" ? sameScope[i - 1] : sameScope[i + 1]) ?? null;
}
