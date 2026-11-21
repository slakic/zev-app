import { requireActor } from "@/server/actor";
import { t, toZonedDateIso } from "@/lib/i18n";
import { Card, Flash, PageHeader } from "@/components/ui";
import { JournalEditor } from "@/components/journal-editor";
import { saveJournalDraftAction } from "@/server/actions/journal";
import { editorLabels, editorOptionsFor } from "../editor-props";

/** Novi ručni nalog (B1a): nacrt se čuva, knjiži se sa stranice naloga. */
export default async function NewJournalPage({ searchParams }: { searchParams: Promise<{ err?: string }> }) {
  const actor = await requireActor("ACCOUNTANT");
  const sp = await searchParams;
  const options = await editorOptionsFor(actor);
  const today = toZonedDateIso(new Date());
  return (
    <div>
      <PageHeader title={t("ledger.journal.editor.title")} backHref="/knjigovodstvo?tab=nalozi" backLabel={t("ledger.journal.editor.back")} />
      <Flash err={sp.err} />
      <Card hint={t("ledger.journal.editor.controlNote")}>
        {options.hasActiveChart ? (
          <JournalEditor action={saveJournalDraftAction} options={options} labels={editorLabels} initial={{ documentDate: today, postingDate: today, description: "", lines: [] }} />
        ) : (
          <p className="text-sm text-slate-600">{t("ledger.rules.needsActive")}</p>
        )}
      </Card>
    </div>
  );
}
