// Izvoz nacrta u format uvoza (nacrt.json): isti oblik kao izlaz alata get_draft (draftForAssistant) uz `format` i
// `formatVersion`, ali SA ključevima stavki, da se izvezeni fajl može ponovo uvesti bez promjena. NIKAD: hash lozinke,
// e-adresa za prijavu računovođe, id-jevi i bajtovi fajlova dokaza. Vlasnički udjeli i prijedlozi idu zajedno u `stakes`
// (uvoz ih svakako tretira kao prijedloge). ČISTO: bez baze.
import type { OnboardingDraftData } from "@/lib/onboarding/draft";
import { IMPORT_FORMAT_ID, IMPORT_FORMAT_VERSION } from "@/lib/onboarding/import/importFormat";

const nullIfEmpty = (v: string | null | undefined) => (v && v.trim() ? v : null);

export function draftToImportDoc(data: OnboardingDraftData): Record<string, unknown> {
  const seen = new Set<string>();
  const stakes = [...data.stakes, ...data.stakeProposals].flatMap((s) => {
    const id = `${s.unitKey}|${s.partyKey}`;
    if (seen.has(id)) return [];
    seen.add(id);
    return [{ key: s.key, unitKey: s.unitKey, partyKey: s.partyKey, sharePercent: s.sharePercent, validFrom: s.validFrom }];
  });
  const acc = data.offices.accountant;
  return {
    format: IMPORT_FORMAT_ID,
    formatVersion: IMPORT_FORMAT_VERSION,
    zev: { ...data.zev, foundingDate: nullIfEmpty(data.zev.foundingDate), registrationDate: nullIfEmpty(data.zev.registrationDate) },
    president: { ...data.president },
    accounts: data.accounts.map((a) => ({
      key: a.key, type: a.type, name: a.name, bankName: a.bankName, number: a.number, openingBalance: a.openingBalance, openingDate: a.openingDate,
    })),
    buildings: data.buildings.map((b) => ({
      key: b.key, name: b.name, address: b.address, cadastralRef: b.cadastralRef, yearBuilt: b.yearBuilt, floorsCount: b.floorsCount,
      entrances: b.entrances.map((e) => ({ key: e.key, name: e.name })),
    })),
    units: data.units.map((u) => ({
      key: u.key, buildingKey: u.buildingKey, entranceKey: u.entranceKey, type: u.type, label: u.label, floor: u.floor,
      usableArea: u.usableArea, ownershipShare: u.ownershipShare,
    })),
    commonAssets: data.commonAssets.map((c) => ({ key: c.key, buildingKey: c.buildingKey, kind: c.kind, name: c.name, description: c.description })),
    parties: data.parties.map((p) => ({
      key: p.key, kind: p.kind, firstName: p.firstName, lastName: p.lastName, orgName: p.orgName, orgIdNumber: p.orgIdNumber, email: p.email, phone: p.phone,
    })),
    stakes,
    disputedUnits: [...data.disputedUnits],
    offices: {
      accountant: acc === null || acc === "LATER" ? acc : { partyKey: acc.partyKey, validFrom: acc.validFrom },
      board: data.offices.board.map((b) => ({ key: b.key, partyKey: b.partyKey, validFrom: b.validFrom })),
    },
  };
}
