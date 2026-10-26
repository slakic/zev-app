"use client";
// Bilješke i zaključci sa sjednice (Plans/sjednica-uzivo-biljeske-i-zapisnik-plan.md, v2.54.0): forma i lista za jednu
// tačku dnevnog reda ili temu van dnevnog reda. Klijentska komponenta iz istog razloga kao prozivka (roll-call.tsx):
// ekran uživo se osvježava svakih 10 s kroz router.refresh(), koji čuva stanje klijentskih komponenti — tekst koji se
// kuca ne smije nestati. Uz to se nacrt čuva u localStorage po sjednici i tački (sve u try/catch: privatni prozor,
// blokirani podaci), pa ga ne briše ni slučajno zatvoren tab. Tekst se briše tek poslije uspješnog čuvanja; na grešku
// ostaje u polju. Samo komponente iz ui.tsx — bez novih boja, veličina i tretmana dugmadi.
import { useEffect, useState, useTransition } from "react";
import { Btn, RowAction, ConfirmAction, Flash, SegmentedAction, inputCls } from "@/components/ui";
import { saveNoteAction, updateNoteAction, deleteNoteAction, moveNoteAction, type NoteActionState } from "@/app/meeting-notes-actions";
import { t, tf } from "@/lib/i18n";

export type NoteView = { id: string; kind: "NOTE" | "CONCLUSION"; text: string; version: number; position: number };
export type TopicView = { topic: string; conclusions: NoteView[]; notes: NoteView[] };

type Draft = { text: string; kind: "NOTE" | "CONCLUSION"; topic: string };

const draftKey = (meetingId: string, scope: string) => `zev:note-draft:${meetingId}:${scope}`;

function readDraft(key: string): Draft | null {
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return null;
    const d = JSON.parse(raw) as Partial<Draft>;
    if (typeof d.text !== "string") return null;
    return { text: d.text, kind: d.kind === "CONCLUSION" ? "CONCLUSION" : "NOTE", topic: typeof d.topic === "string" ? d.topic : "" };
  } catch {
    return null;
  }
}

function writeDraft(key: string, draft: Draft | null) {
  try {
    if (draft) window.localStorage.setItem(key, JSON.stringify(draft));
    else window.localStorage.removeItem(key);
  } catch {
    /* privatni prozor / blokirani podaci: forma radi i bez nacrta */
  }
}

const kindOptions = () => [
  { value: "NOTE", label: t("meetingNotes.kind.NOTE") },
  { value: "CONCLUSION", label: t("meetingNotes.kind.CONCLUSION") },
];

function runAction(
  action: (fd: FormData) => Promise<NoteActionState>,
  fd: FormData,
  start: (cb: () => Promise<void>) => void,
  setResult: (r: NoteActionState) => void,
  onOk: () => void
) {
  start(async () => {
    try {
      const r = await action(fd);
      setResult(r);
      if (r?.ok) onOk();
    } catch {
      setResult({ ok: false, error: t("meetingNotes.err.saveFailed"), at: Date.now() });
    }
  });
}

/** Nova bilješka / zaključak. `askTopic`: tema van dnevnog reda sa slobodnim naslovom; `topic`: tema je već određena. */
export function NoteForm({
  meetingId, agendaItemId, topic, askTopic, scope,
}: { meetingId: string; agendaItemId?: string; topic?: string; askTopic?: boolean; scope: string }) {
  const key = draftKey(meetingId, scope);
  const [text, setText] = useState("");
  const [kind, setKind] = useState<"NOTE" | "CONCLUSION">("NOTE");
  const [topicInput, setTopicInput] = useState("");
  const [loaded, setLoaded] = useState(false);
  const [restored, setRestored] = useState(false);
  const [result, setResult] = useState<NoteActionState>(null);
  const [pending, startTransition] = useTransition();

  // Nacrt se učitava poslije montiranja (ne tokom renderovanja): server i klijent prvo prikažu istu praznu formu.
  useEffect(() => {
    const d = readDraft(key);
    if (d && (d.text || d.topic)) {
      setText(d.text);
      setKind(d.kind);
      setTopicInput(d.topic);
      setRestored(true);
    }
    setLoaded(true);
  }, [key]);

  useEffect(() => {
    if (!loaded) return;
    writeDraft(key, text || topicInput ? { text, kind, topic: topicInput } : null);
  }, [loaded, key, text, kind, topicInput]);

  const canSave = text.trim().length > 0 && (!askTopic || topicInput.trim().length > 0) && !pending;

  return (
    <form
      className="space-y-3"
      onSubmit={(e) => {
        e.preventDefault();
        if (!canSave) return;
        const fd = new FormData(e.currentTarget);
        runAction(saveNoteAction, fd, startTransition, setResult, () => {
          setText("");
          setTopicInput("");
          setRestored(false);
          writeDraft(key, null);
        });
      }}
    >
      <input type="hidden" name="meetingId" value={meetingId} />
      {agendaItemId && <input type="hidden" name="agendaItemId" value={agendaItemId} />}
      {!askTopic && topic !== undefined && <input type="hidden" name="topic" value={topic} />}
      <input type="hidden" name="kind" value={kind} />
      {askTopic && (
        <label className="block text-sm">
          <span className="mb-1 block font-medium text-slate-700">{t("meetingNotes.topicLabel")}</span>
          <input
            name="topic"
            value={topicInput}
            onChange={(e) => setTopicInput(e.target.value)}
            placeholder={t("meetingNotes.topicPlaceholder")}
            maxLength={200}
            className={inputCls}
          />
        </label>
      )}
      <SegmentedAction name="kind" active={kind} onSelect={(v) => setKind(v === "CONCLUSION" ? "CONCLUSION" : "NOTE")} options={kindOptions()} />
      <textarea
        name="text"
        rows={4}
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder={t("meetingNotes.textPlaceholder")}
        aria-label={t("meetingNotes.textLabel")}
        className={`${inputCls} min-h-[7rem] resize-y`}
      />
      <div className="flex flex-wrap items-center gap-3">
        <Btn type="submit" variant="tonal" disabled={!canSave}>
          {pending ? t("meetingNotes.saving") : t("meetingNotes.save")}
        </Btn>
        {restored && !pending && <span className="text-[13px] text-slate-500">{t("meetingNotes.draftRestored")}</span>}
      </div>
      {result && !result.ok && <Flash err={result.error} inset />}
    </form>
  );
}

function NoteItem({
  meetingId, note, label, writable, returnTo, canUp, canDown,
}: { meetingId: string; note: NoteView; label: string; writable: boolean; returnTo: string; canUp: boolean; canDown: boolean }) {
  const [editing, setEditing] = useState(false);
  // Verzija se pamti u trenutku otvaranja uređivanja: osvježavanje ekrana ne smije tiho "podmetnuti" noviju verziju
  // i dozvoliti da se prepiše tuđa izmjena.
  const [baseVersion, setBaseVersion] = useState(note.version);
  const [text, setText] = useState(note.text);
  const [kind, setKind] = useState(note.kind);
  const [result, setResult] = useState<NoteActionState>(null);
  const [pending, startTransition] = useTransition();

  const hidden = (
    <>
      <input type="hidden" name="meetingId" value={meetingId} />
      <input type="hidden" name="id" value={note.id} />
      <input type="hidden" name="returnTo" value={returnTo} />
    </>
  );

  return (
    <li className="rounded-lg border border-slate-200/80 p-3">
      {editing ? (
        <div className="space-y-3">
        <form
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            if (!text.trim() || pending) return;
            runAction(updateNoteAction, new FormData(e.currentTarget), startTransition, setResult, () => setEditing(false));
          }}
        >
          {hidden}
          <input type="hidden" name="expectedVersion" value={baseVersion} />
          <input type="hidden" name="kind" value={kind} />
          <SegmentedAction name="kind" active={kind} onSelect={(v) => setKind(v === "CONCLUSION" ? "CONCLUSION" : "NOTE")} options={kindOptions()} />
          <textarea
            name="text"
            rows={4}
            value={text}
            onChange={(e) => setText(e.target.value)}
            aria-label={t("meetingNotes.textLabel")}
            className={`${inputCls} min-h-[7rem] resize-y`}
          />
          <div className="flex flex-wrap items-center gap-2">
            <Btn type="submit" variant="tonal" disabled={pending || !text.trim()}>
              {pending ? t("meetingNotes.saving") : t("meetingNotes.save")}
            </Btn>
            <Btn type="button" variant="secondary" onClick={() => { setEditing(false); setResult(null); }}>
              {t("meetingNotes.cancel")}
            </Btn>
          </div>
          {result && !result.ok && <Flash err={result.error} inset />}
        </form>
        {/* Zasebno od obrasca iznad: ConfirmAction je i sam <form>, a obrasci se ne ugnježđuju. */}
        <ConfirmAction
          trigger={t("meetingNotes.delete")}
          triggerVariant="caution"
          title={t("meetingNotes.deleteTitle")}
          body={<p className="text-sm text-amber-950">{t("meetingNotes.deleteBody")}</p>}
          confirmLabel={t("meetingNotes.deleteConfirm")}
          action={deleteNoteAction}
          hiddenFields={{ meetingId, id: note.id, expectedVersion: String(baseVersion), returnTo }}
        />
        </div>
      ) : (
        <>
          <p className="text-[13px] font-medium text-slate-500">{label}</p>
          <p className="mt-0.5 whitespace-pre-wrap break-words text-[15px] text-slate-900">{note.text}</p>
          {writable && (
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <RowAction
                type="button"
                variant="secondary"
                onClick={() => { setBaseVersion(note.version); setText(note.text); setKind(note.kind); setResult(null); setEditing(true); }}
              >
                {t("meetingNotes.edit")}
              </RowAction>
              {[{ dir: "up", ok: canUp, label: t("meetingNotes.up") }, { dir: "down", ok: canDown, label: t("meetingNotes.down") }].map((m) =>
                m.ok ? (
                  <form key={m.dir} action={moveNoteAction}>
                    {hidden}
                    <input type="hidden" name="direction" value={m.dir} />
                    <RowAction type="submit" variant="secondary">{m.label}</RowAction>
                  </form>
                ) : null
              )}
            </div>
          )}
        </>
      )}
    </li>
  );
}

/** Zaključci (numerisani) pa bilješke jedne tačke ili teme, sa formom za novi unos kad je pisanje dozvoljeno. */
export function NotesBlock({
  meetingId, agendaItemId, topic, askTopic, conclusions, notes, writable, returnTo, scope,
}: {
  meetingId: string;
  agendaItemId?: string;
  topic?: string;
  askTopic?: boolean;
  conclusions: NoteView[];
  notes: NoteView[];
  writable: boolean;
  returnTo: string;
  scope: string;
}) {
  const empty = conclusions.length === 0 && notes.length === 0;
  return (
    <div className="space-y-4">
      {empty && !askTopic && <p className="text-[13px] text-slate-500">{t("meetingNotes.empty")}</p>}
      {conclusions.length > 0 && (
        <ul className="space-y-2">
          {conclusions.map((n, i) => (
            <NoteItem
              key={n.id}
              meetingId={meetingId}
              note={n}
              label={tf("meetingNotes.conclusionN", { broj: i + 1 })}
              writable={writable}
              returnTo={returnTo}
              canUp={i > 0}
              canDown={i < conclusions.length - 1}
            />
          ))}
        </ul>
      )}
      {notes.length > 0 && (
        <ul className="space-y-2">
          {notes.map((n, i) => (
            <NoteItem
              key={n.id}
              meetingId={meetingId}
              note={n}
              label={t("meetingNotes.kind.NOTE")}
              writable={writable}
              returnTo={returnTo}
              canUp={i > 0}
              canDown={i < notes.length - 1}
            />
          ))}
        </ul>
      )}
      {writable && (
        <div className={empty && !askTopic ? "" : "border-t border-slate-100 pt-4"}>
          <NoteForm meetingId={meetingId} agendaItemId={agendaItemId} topic={topic} askTopic={askTopic} scope={scope} />
        </div>
      )}
    </div>
  );
}

/** „Van dnevnog reda”: svaka tema je zaseban blok sa svojim zapisima, na kraju forma za novu temu. */
export function OffAgendaNotes({
  meetingId, topics, writable, returnTo,
}: { meetingId: string; topics: TopicView[]; writable: boolean; returnTo: string }) {
  return (
    <div className="space-y-5">
      {topics.map((tp) => (
        <section key={tp.topic} className="space-y-3 border-b border-slate-100 pb-5 last:border-b-0">
          <h3 className="text-[15px] font-semibold text-slate-900">{tp.topic}</h3>
          <NotesBlock
            meetingId={meetingId}
            topic={tp.topic}
            conclusions={tp.conclusions}
            notes={tp.notes}
            writable={writable}
            returnTo={returnTo}
            scope={`off:${tp.topic.toLowerCase()}`}
          />
        </section>
      ))}
      {writable && (
        <NotesBlock meetingId={meetingId} askTopic conclusions={[]} notes={[]} writable returnTo={returnTo} scope="off:new" />
      )}
      {!writable && topics.length === 0 && <p className="text-[13px] text-slate-500">{t("meetingNotes.empty")}</p>}
    </div>
  );
}
