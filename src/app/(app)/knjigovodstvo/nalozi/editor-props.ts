// Šifarnici i tekstovi za JournalEditor (client) — pripremljeni na serveru, da u klijentski bundle ide samo ono što treba.
import { editorOptions } from "@/server/services/journal";
import { partyDisplayName } from "@/server/services/ownership";
import { t } from "@/lib/i18n";
import type { EditorLabels, JournalEditorOptions } from "@/components/journal-editor";
import type { Actor } from "@/server/auth/guards";

const L = (k: string) => t(`ledger.journal.editor.${k}`);

export const editorLabels: EditorLabels = {
  documentDate: L("documentDate"), postingDate: L("postingDate"), description: L("description"),
  colAccount: L("colAccount"), colDebit: L("colDebit"), colCredit: L("colCredit"), colDetails: L("colDetails"), colActions: L("colActions"),
  pickAccount: L("pickAccount"), analytics: L("analytics"), party: L("party"), unit: L("unit"), supplier: L("supplier"),
  project: L("project"), purpose: L("purpose"), none: L("none"), lineDescription: L("lineDescription"), addLine: L("addLine"),
  removeLine: L("removeLine"), total: L("total"), difference: L("difference"), balanced: L("balanced"), save: L("save"),
  caption: L("caption"), emptyTitle: L("emptyTitle"),
};

export async function editorOptionsFor(actor: Actor): Promise<JournalEditorOptions & { hasActiveChart: boolean }> {
  const o = await editorOptions(actor);
  return {
    hasActiveChart: o.hasActiveChart,
    accounts: o.accounts.map((a) => ({ id: a.id, label: `${a.code} ${a.name}` })),
    parties: o.parties.map((p) => ({ id: p.id, label: partyDisplayName(p) })),
    units: o.units.map((u) => ({ id: u.id, label: u.label })),
    suppliers: o.suppliers.map((s) => ({ id: s.id, label: s.name })),
    projects: o.projects.map((p) => ({ id: p.id, label: p.name })),
    purposes: o.purposes.map((p) => ({ id: p.id, label: `${p.code} ${p.name}` })),
  };
}
