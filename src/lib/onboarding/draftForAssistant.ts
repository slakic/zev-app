// Sadržaj nacrta u obliku za asistenta (MCP alat get_draft, Plans/mcp-onboarding-asistent-plan.md O-A; izvor stavke od O-B). Čista funkcija
// bez baze: bira šta asistent smije da vidi. NIKAD: hash lozinke (samo `hasPassword`), bajtovi fajlova, id fajla dokaza
// (samo naziv, tip i veličina), e-pošta iz poziva ni id vlasnika. Lična polja lica (ime, e-pošta, telefon, JMBG/ID
// organizacije) i udjeli se šalju jer su upravo ono što se u čarobnjaku popunjava.
import { isValidBankAccount, isValidJib } from "@/lib/identifiers";
import type { OnboardingDraftData } from "@/lib/onboarding/draft";

export const DRAFT_SECTIONS = ["zev", "accounts", "buildings", "units", "commonAssets", "owners", "offices"] as const;
export type DraftSection = (typeof DRAFT_SECTIONS)[number];

/** Metapodaci fajla dokaza (OnboardingDraftFile bez `bytes`). */
export type DraftFileMeta = { id: string; filename: string; mime: string; size: number };

const nullIfEmpty = (v: string | null | undefined) => (v && v.trim() ? v : null);

/** Izvor stavke (M6) samo kad postoji: ručno unesene stavke ga nemaju. */
const src = (x: { source?: string }) => (x.source ? { source: x.source } : {});

export function draftForAssistant(data: OnboardingDraftData, files: DraftFileMeta[], sections?: readonly DraftSection[]): Record<string, unknown> {
  const want = (s: DraftSection) => !sections || sections.length === 0 || sections.includes(s);
  const out: Record<string, unknown> = {};

  if (want("zev")) {
    const z = data.zev;
    out.zev = {
      legalName: z.legalName, shortName: z.shortName, registrationNumber: z.registrationNumber,
      jib: z.jib, jibValid: z.jib.trim() ? isValidJib(z.jib) : false,
      registeredAddress: z.registeredAddress, city: z.city, municipality: z.municipality,
      foundingDate: nullIfEmpty(z.foundingDate), registrationDate: nullIfEmpty(z.registrationDate),
    };
    out.president = { firstName: data.president.firstName, lastName: data.president.lastName, phone: data.president.phone };
  }
  if (want("accounts")) {
    out.accounts = data.accounts.map((a) => ({
      key: a.key, type: a.type, name: a.name, bankName: a.bankName, number: a.number,
      numberValid: a.type === "BANK" ? Boolean(a.number && isValidBankAccount(a.number)) : null,
      openingBalance: a.openingBalance, openingDate: a.openingDate, ...src(a),
    }));
    out.noAccounts = data.acks.noAccounts;
  }
  if (want("buildings")) {
    out.buildings = data.buildings.map((b) => ({
      key: b.key, name: b.name, address: b.address, cadastralRef: b.cadastralRef, yearBuilt: b.yearBuilt, floorsCount: b.floorsCount,
      entrances: b.entrances.map((e) => ({ key: e.key, name: e.name, ...src(e) })), ...src(b),
    }));
  }
  if (want("units")) {
    out.units = data.units.map((u) => ({
      key: u.key, buildingKey: u.buildingKey, entranceKey: u.entranceKey, type: u.type, label: u.label, floor: u.floor,
      usableArea: u.usableArea, ownershipShare: u.ownershipShare, ...src(u),
    }));
  }
  if (want("commonAssets")) {
    out.commonAssets = data.commonAssets.map((c) => ({ key: c.key, buildingKey: c.buildingKey, kind: c.kind, name: c.name, description: c.description, ...src(c) }));
    out.registerConfirmedAt = data.registerConfirmedAt;
  }
  if (want("owners")) {
    const byId = new Map(files.map((f) => [f.id, f]));
    out.parties = data.parties.map((p) => ({
      key: p.key, kind: p.kind, firstName: p.firstName, lastName: p.lastName, orgName: p.orgName, orgIdNumber: p.orgIdNumber, email: p.email, phone: p.phone, ...src(p),
    }));
    out.stakes = data.stakes.map((s) => {
      const f = byId.get(s.proofFileId);
      return {
        key: s.key, unitKey: s.unitKey, partyKey: s.partyKey, sharePercent: s.sharePercent, validFrom: s.validFrom,
        // Dokaz samo kao metapodaci; sadržaj fajla asistent ne dobija.
        proof: f ? { filename: f.filename, mime: f.mime, size: f.size } : s.proofFilename ? { filename: s.proofFilename, mime: null, size: null } : null,
        ...src(s),
      };
    });
    // Prijedlozi iz uvoza (bez dokaza): isti oblik kao `stakes` bez `proof`; uvoz ih ponovo čita kao prijedloge.
    out.stakeProposals = data.stakeProposals.map((s) => ({ key: s.key, unitKey: s.unitKey, partyKey: s.partyKey, sharePercent: s.sharePercent, validFrom: s.validFrom, ...src(s) }));
    out.disputedUnits = [...data.disputedUnits];
  }
  if (want("offices")) {
    const acc = data.offices.accountant;
    out.offices = {
      accountant:
        acc === null || acc === "LATER"
          ? acc
          : { key: acc.key, partyKey: acc.partyKey, validFrom: acc.validFrom, loginEmail: acc.loginEmail, hasPassword: Boolean(acc.passwordHash), ...src(acc) },
      board: data.offices.board.map((b) => ({ key: b.key, partyKey: b.partyKey, validFrom: b.validFrom, ...src(b) })),
    };
  }
  return out;
}
