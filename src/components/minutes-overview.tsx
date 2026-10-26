// Pregled svega što ulazi u zapisnik (Plans/sjednica-uzivo-biljeske-i-zapisnik-plan.md §2.3/§2.4): tačke dnevnog reda
// redom (rezultat prijedloga + zaključci + bilješke), pa teme van dnevnog reda. Isti sadržaj kao PDF (loadMinutesContent).
// `editable` = detalj sjednice: svaka tačka nosi NotesBlock (uređivanje, redoslijed, nova bilješka); inače je pregled
// samo za čitanje (tab „Zapisnik” u režimu uživo, i detalj sjednice poslije finalizacije).
import { StatusBadge, RowLink } from "@/components/ui";
import { NotesBlock, OffAgendaNotes, type NoteView } from "@/components/meeting-notes";
import { formatWeight } from "@/lib/money";
import { t, tf, tEnum } from "@/lib/i18n";
import type { MeetingNoteRow, MinutesContent, MinutesProposal } from "@/server/services/meetingNotes";

const view = (n: MeetingNoteRow): NoteView => ({ id: n.id, kind: n.kind, text: n.text, version: n.version, position: n.position });

function ReadList({ conclusions, notes }: { conclusions: MeetingNoteRow[]; notes: MeetingNoteRow[] }) {
  if (conclusions.length === 0 && notes.length === 0) {
    return <p className="text-[13px] text-slate-500">{t("live.minutes.noNotesYet")}</p>;
  }
  return (
    <div className="space-y-3">
      {conclusions.length > 0 && (
        <ul className="space-y-2">
          {conclusions.map((n, i) => (
            <li key={n.id} className="rounded-lg border border-slate-200/80 p-3">
              <p className="text-[13px] font-medium text-slate-500">{tf("meetingNotes.conclusionN", { broj: i + 1 })}</p>
              <p className="mt-0.5 whitespace-pre-wrap break-words text-[15px] text-slate-900">{n.text}</p>
            </li>
          ))}
        </ul>
      )}
      {notes.length > 0 && (
        <ul className="space-y-2">
          {notes.map((n) => (
            <li key={n.id} className="rounded-lg border border-slate-200/80 p-3">
              <p className="text-[13px] font-medium text-slate-500">{t("meetingNotes.kind.NOTE")}</p>
              <p className="mt-0.5 whitespace-pre-wrap break-words text-[15px] text-slate-900">{n.text}</p>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function ProposalLine({ p }: { p: MinutesProposal }) {
  const r = p.result;
  return (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[13px] text-slate-600">
      <span className="font-medium text-slate-500">{p.code}</span>
      <StatusBadge status={p.status} label={tEnum("proposalStatus", p.status)} />
      {r ? (
        <span>
          {tf("live.minutes.resultLine", {
            za: formatWeight(r.approveWeight), protiv: formatWeight(r.rejectWeight), uzdrzani: formatWeight(r.abstainWeight),
            ishod: r.accepted ? t("live.resultAccepted") : t("live.resultNotAccepted"),
          })}
        </span>
      ) : (
        <span>{t("live.minutes.noResultYet")}</span>
      )}
    </div>
  );
}

export function MinutesOverview({
  content, editable, returnTo, itemHref,
}: {
  content: MinutesContent;
  editable: boolean;
  returnTo: string;
  /** Veza na tačku u režimu uživo („Otvori tačku”); bez nje (detalj sjednice) se ne prikazuje. */
  itemHref?: (agendaItemId: string) => string;
}) {
  const meetingId = content.meeting.id;
  return (
    <div>
      {content.items.map((it) => (
        <section key={it.id} className="space-y-3 border-t border-slate-100 py-4 first:border-t-0 first:pt-0">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <h3 className="text-[15px] font-semibold text-slate-900">{it.order}. {it.title}</h3>
            <span className="text-[13px] text-slate-500">
              {tf("meetingNotes.countsLine", { zakljucaka: it.conclusions.length, biljeski: it.notes.length })}
            </span>
          </div>
          {it.proposals.map((p) => <ProposalLine key={p.id} p={p} />)}
          {editable ? (
            <NotesBlock
              meetingId={meetingId}
              agendaItemId={it.id}
              conclusions={it.conclusions.map(view)}
              notes={it.notes.map(view)}
              writable
              returnTo={returnTo}
              scope={it.id}
            />
          ) : (
            <ReadList conclusions={it.conclusions} notes={it.notes} />
          )}
          {itemHref && (
            <div><RowLink href={itemHref(it.id)}>{t("live.minutes.openItem")}</RowLink></div>
          )}
        </section>
      ))}
      {(content.topics.length > 0 || editable) && (
        <section className="space-y-3 border-t border-slate-100 py-4">
          <h3 className="text-[15px] font-semibold text-slate-900">{t("live.minutes.topicsHeading")}</h3>
          <p className="text-[13px] text-slate-500">{t("live.offAgendaNote")}</p>
          {editable ? (
            <OffAgendaNotes
              meetingId={meetingId}
              topics={content.topics.map((tp) => ({ topic: tp.topic, conclusions: tp.conclusions.map(view), notes: tp.notes.map(view) }))}
              writable
              returnTo={returnTo}
            />
          ) : (
            content.topics.map((tp) => (
              <div key={tp.topic} className="space-y-2">
                <h4 className="text-[15px] font-medium text-slate-900">{tp.topic}</h4>
                <ReadList conclusions={tp.conclusions} notes={tp.notes} />
              </div>
            ))
          )}
          {itemHref && (
            <div><RowLink href={itemHref("van")}>{t("live.minutes.openItem")}</RowLink></div>
          )}
        </section>
      )}
    </div>
  );
}
