// "Upozorenja prije izdavanja" nacrta serije (F5a.3). Čista funkcija nad `previewData` serije: ništa ne blokira
// izdavanje (kao potvrda iz F1), samo kaže računovođi šta da pogleda prije klika. Rečenice su iz rječnika.
import { dec, ZERO, type Decimal } from "@/lib/money";
import { isMaintenanceCharge, minMaintenancePerM2, belowMinimumFor, type PartyKindLike } from "@/lib/legalMinimum";
import { t, toZonedDateIso } from "@/lib/i18n";

/** Dio `UnitCalculation` (billing servis) koji upozorenja čitaju — namjerno strukturni tip da lib ne uvozi servis. */
export type PreviewUnit = {
  unitId: string;
  unitLabel: string;
  buildingName: string;
  debtorId: string | null;
  debtorName: string;
  total: string;
  lines: { chargeItemId?: string; name: string; method: string; amount: string; inputs: Record<string, string | number | null> }[];
};

export type WarningEntry = { unitId: string; unit: string; detail?: string };

export type BatchWarnings = {
  /** Dospijeće serije je prije današnjeg kalendarskog dana (Europe/Sarajevo). */
  duePast: boolean;
  noDebtor: WarningEntry[];
  zeroLines: WarningEntry[];
  zeroUnits: WarningEntry[];
  /** Jedinice čiji dužnik plaća redovno održavanje po m² ispod zakonskog minimuma za svoju vrstu lica (samo upozorenje). */
  belowMinimum: WarningEntry[];
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

/** Kontekst za provjeru zakonskog minimuma održavanja; bez njega se ta provjera preskače. */
export type MinimumContext = {
  /** Vrsta lica dužnika (Party.kind) po `debtorId`; nepoznat dužnik se ne provjerava. */
  debtorKinds: ReadonlyMap<string, PartyKindLike>;
  /** Id-evi stavki naknade označenih kao fond održavanja (`isReserveFund`). */
  reserveFundItemIds: ReadonlySet<string>;
};

const fmtKm = (v: string) => v.replace(".", ",");

export function batchWarnings(preview: PreviewUnit[], dueDate: Date, now: Date, minimum?: MinimumContext): BatchWarnings {
  const noDebtor: WarningEntry[] = [];
  const zeroLines: WarningEntry[] = [];
  const zeroUnits: WarningEntry[] = [];
  const belowMinimum: WarningEntry[] = [];
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
    // Zakonski minimum održavanja: zbir stopa (KM/m²) stavki održavanja jedinice naspram minimuma za vrstu lica dužnika.
    // Jedinica bez ijedne takve stavke (npr. izuzeta) se ne ocjenjuje — nema stope za poređenje.
    const kind = minimum && u.debtorId ? minimum.debtorKinds.get(u.debtorId) : undefined;
    if (minimum && kind) {
      const rates = u.lines
        .filter((l) => isMaintenanceCharge({ method: l.method, name: l.name, isReserveFund: l.chargeItemId ? minimum.reserveFundItemIds.has(l.chargeItemId) : false }))
        .map((l) => l.inputs.rate)
        .filter((r): r is string | number => r != null && r !== "");
      if (rates.length > 0) {
        const rate = rates.reduce<Decimal>((a, r) => a.plus(dec(r)), ZERO);
        if (belowMinimumFor(kind, rate)) {
          belowMinimum.push({
            unitId: u.unitId,
            unit,
            detail: `${u.debtorName}: ${fmtKm(rate.toFixed(2))} < ${fmtKm(minMaintenancePerM2(kind).toFixed(2))} KM/m²`,
          });
          flagged.add(u.unitId);
        }
      }
    }
  }
  // Isti kalendarski uslov kao potvrda izdavanja: na sam dan roka dospijeće još nije prošlo.
  const duePast = toZonedDateIso(dueDate) < toZonedDateIso(now);
  return {
    duePast,
    noDebtor,
    zeroLines,
    zeroUnits,
    belowMinimum,
    flaggedUnitIds: [...flagged],
    count: noDebtor.length + zeroLines.length + zeroUnits.length + belowMinimum.length + (duePast ? 1 : 0),
  };
}
