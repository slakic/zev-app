// "Upozorenja prije izdavanja" nacrta serije (F5a.3). Čista funkcija nad `previewData` serije: ništa ne blokira
// izdavanje (kao potvrda iz F1), samo kaže računovođi šta da pogleda prije klika. Rečenice su iz rječnika.
import { dec } from "@/lib/money";
import { t, toZonedDateIso } from "@/lib/i18n";

/** Dio `UnitCalculation` (billing servis) koji upozorenja čitaju — namjerno strukturni tip da lib ne uvozi servis. */
export type PreviewUnit = {
  unitId: string;
  unitLabel: string;
  buildingName: string;
  debtorId: string | null;
  debtorName: string;
  total: string;
  lines: { name: string; method: string; amount: string; inputs: Record<string, string | number | null> }[];
};

export type WarningEntry = { unitId: string; unit: string; detail?: string };

export type BatchWarnings = {
  /** Dospijeće serije je prije današnjeg kalendarskog dana (Europe/Sarajevo). */
  duePast: boolean;
  noDebtor: WarningEntry[];
  zeroLines: WarningEntry[];
  zeroUnits: WarningEntry[];
  /** Jedinice koje imaju bar jedno upozorenje (za chip u tabeli). */
  flaggedUnitIds: string[];
  /** Ukupan broj upozorenja (grupa „dospijeće” se računa jednom). */
  count: number;
};

const isZero = (v: string | number | null | undefined): boolean => {
  if (v == null || v === "") return true;
  try {
    return dec(v).isZero();
  } catch {
    return false;
  }
};

/** Razlog nule u stavci, iz ulaza obračuna; bez prepoznatog razloga samo „iznos je 0,00”. */
function zeroReason(line: PreviewUnit["lines"][number]): string {
  const i = line.inputs;
  switch (line.method) {
    case "PER_OCCUPANT":
      if (isZero(i.occupantCount)) return t("batchWarnings.reason.noOccupants");
      break;
    case "CONSUMPTION":
      if (isZero(i.consumption)) return t("batchWarnings.reason.noConsumption");
      break;
    case "PER_AREA":
      if (isZero(i.usableArea)) return t("batchWarnings.reason.noArea");
      break;
    case "PER_OWNERSHIP_SHARE":
      if (isZero(i.ownershipShare)) return t("batchWarnings.reason.noShare");
      break;
  }
  if ("rate" in i && isZero(i.rate)) return t("batchWarnings.reason.noRate");
  return t("batchWarnings.reason.zero");
}

export function batchWarnings(preview: PreviewUnit[], dueDate: Date, now: Date): BatchWarnings {
  const noDebtor: WarningEntry[] = [];
  const zeroLines: WarningEntry[] = [];
  const zeroUnits: WarningEntry[] = [];
  const flagged = new Set<string>();
  for (const u of preview) {
    const unit = `${u.buildingName} / ${u.unitLabel}`;
    if (!u.debtorId) {
      noDebtor.push({ unitId: u.unitId, unit });
      flagged.add(u.unitId);
    }
    for (const l of u.lines) {
      if (isZero(l.amount)) {
        zeroLines.push({ unitId: u.unitId, unit, detail: `${l.name} (${zeroReason(l)})` });
        flagged.add(u.unitId);
      }
    }
    if (isZero(u.total)) {
      zeroUnits.push({ unitId: u.unitId, unit });
      flagged.add(u.unitId);
    }
  }
  // Isti kalendarski uslov kao potvrda izdavanja: na sam dan roka dospijeće još nije prošlo.
  const duePast = toZonedDateIso(dueDate) < toZonedDateIso(now);
  return {
    duePast,
    noDebtor,
    zeroLines,
    zeroUnits,
    flaggedUnitIds: [...flagged],
    count: noDebtor.length + zeroLines.length + zeroUnits.length + (duePast ? 1 : 0),
  };
}
