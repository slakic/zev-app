// Oznaka stanja knjiženja dokumenta (B2, plan §5): za svaki događaj dokumenta broj naloga kojim je proknjižen ili
// razlog čekanja. Prikazuje se samo ulogama sa pregledom knjige i kad je knjiženje aktivno (servis `postingNotes`
// tada vraća null, pa se ne crta ništa). Dokument bez događaja (npr. prije datuma početka, pa sadržan u početnom
// stanju) nema oznaku. `compact` (red tabele): samo broj naloga, odnosno stanje — vrsta i razlog su u opisu.
import { StatusBadge, RowLink } from "@/components/ui";
import { t, tEnum } from "@/lib/i18n";
import type { PostingNote } from "@/server/services/ledgerEvents";

export function PostingNotes({ notes, compact }: { notes: PostingNote[] | null | undefined; compact?: boolean }) {
  if (!notes || notes.length === 0) return null;
  return (
    <span className="inline-flex flex-wrap items-center gap-x-2 gap-y-1">
      {!compact && <span className="text-sm text-slate-500">{t("ledger.notes.label")}</span>}
      {notes.map((n, i) => {
        const kind = tEnum("eventKind", n.kind);
        if (n.entryId) {
          return (
            <span key={i} title={compact ? kind : undefined} className="whitespace-nowrap text-sm">
              <RowLink href={`/knjigovodstvo/nalozi/${n.entryId}`}>{compact ? n.entryNumber : `${kind} ${n.entryNumber}`}</RowLink>
            </span>
          );
        }
        const status = tEnum("eventStatus", n.status);
        return compact ? (
          <span key={i} title={`${kind}: ${n.detail ?? status}`}>
            <StatusBadge status={n.status} label={status} />
          </span>
        ) : (
          <span key={i} className="inline-flex flex-wrap items-center gap-2">
            <StatusBadge status={n.status} label={`${kind}: ${status}`} />
            {n.detail && <span className="text-hint text-slate-600">{n.detail}</span>}
          </span>
        );
      })}
    </span>
  );
}
