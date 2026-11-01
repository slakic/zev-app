// CSV „Posebni dijelovi i vlasnici” → isti međuoblik `ImportDoc` kao JSON (Plans/mcp-onboarding-asistent-plan.md §8),
// pa ga obrađuje isti planer. Jedan red je jedan posebni dio i jedan vlasnik; suvlasnici su ponovljeni redovi iste
// jedinice; red bez kolona o vlasniku je jedinica bez vlasnika. ČISTO: bez baze.
import { decodeText, detectDelimiter, parseCsv } from "@/lib/csv";
import { parseMoneyInput } from "@/lib/money";
import { t, tf } from "@/lib/i18n";
import { CSV_COLUMNS, normalizeHeader } from "@/lib/onboarding/import/importFormat";
import {
  checkLimits, normDate, normFloor, normPartyKind, normUnitType,
  type ImpBuilding, type ImpParty, type ImpStake, type ImpUnit, type ImportDoc, type ImportIssue, type ParsedImport,
} from "@/lib/onboarding/import/schema";

const lower = (s: string) => s.trim().toLowerCase();

/** Isti broj, pisan različito ("62,40" i "62.4"); neispravan broj se poredi kao tekst (planer ga svakako odbija). */
function sameNumber(a: string, b: string): boolean {
  const x = Number(parseMoneyInput(a)), y = Number(parseMoneyInput(b));
  return Number.isFinite(x) && Number.isFinite(y) ? x === y : a === b;
}

export function parseCsvImport(bytes: Uint8Array): ParsedImport {
  const errors: ImportIssue[] = [];
  const warnings: ImportIssue[] = [];
  const fail = (message: string): ParsedImport => ({ doc: null, errors: [{ section: "file", row: null, message }], warnings });

  const { text, windows1250 } = decodeText(bytes);
  if (windows1250) warnings.push({ section: "file", row: null, message: t("onboarding.import.msg.csvWindows1250") });
  const delimiter = detectDelimiter(text);
  const rows = parseCsv(text, delimiter);
  if (rows.length === 0) return fail(t("onboarding.import.msg.csvEmpty"));

  // Zaglavlje: naziv kolone → kanonski naziv.
  const header = rows[0];
  const colIndex = new Map<string, number>();
  header.cells.forEach((raw, i) => {
    const norm = normalizeHeader(raw);
    if (!norm) return;
    const col = CSV_COLUMNS.find((c) => c.name === norm || c.aliases.includes(norm));
    if (!col) {
      warnings.push({ section: "units", row: header.line, field: raw.trim(), message: tf("onboarding.import.msg.csvUnknownColumn", { kolona: raw.trim() }) });
      return;
    }
    if (colIndex.has(col.name)) {
      warnings.push({ section: "units", row: header.line, field: raw.trim(), message: tf("onboarding.import.msg.csvDuplicateColumn", { kolona: raw.trim() }) });
      return;
    }
    colIndex.set(col.name, i);
  });
  const missing = CSV_COLUMNS.filter((c) => c.required && !colIndex.has(c.name)).map((c) => c.name);
  if (missing.length > 0) return { doc: null, errors: [{ section: "units", row: header.line, message: tf("onboarding.import.msg.csvMissingColumns", { kolone: missing.join(", ") }) }], warnings };

  const buildings = new Map<string, ImpBuilding>();
  const units = new Map<string, ImpUnit>();
  const parties = new Map<string, ImpParty>();
  const stakes: ImpStake[] = [];
  const stakeSeen = new Map<string, number>();

  for (const r of rows.slice(1)) {
    const g = (name: string) => (colIndex.has(name) ? (r.cells[colIndex.get(name)!] ?? "").trim() : "");
    const err = (field: string, message: string) => errors.push({ section: "units", row: r.line, field, message });
    let bad = false;
    for (const f of ["zgrada", "oznaka", "vrsta", "povrsina_m2", "udio_u_troskovima"]) {
      if (!g(f)) {
        err(f, tf("onboarding.import.msg.fieldRequired", { polje: f }));
        bad = true;
      }
    }
    if (bad) continue;

    // Zgrada i ulaz.
    const bName = g("zgrada");
    let b = buildings.get(lower(bName));
    if (!b) {
      b = { row: r.line, key: `b${buildings.size + 1}`, name: bName, entrances: [] };
      buildings.set(lower(bName), b);
    }
    const addr = g("adresa_zgrade");
    if (addr) {
      if (!b.address) b.address = addr;
      else if (lower(b.address) !== lower(addr)) err("adresa_zgrade", tf("onboarding.import.msg.csvAddressConflict", { zgrada: bName, red: b.row }));
    }
    let entranceKey: string | undefined;
    const eName = g("ulaz");
    if (eName) {
      let e = b.entrances.find((x) => lower(x.name ?? "") === lower(eName));
      if (!e) {
        e = { row: r.line, key: `e${b.key}-${b.entrances.length + 1}`, name: eName };
        b.entrances.push(e);
      }
      entranceKey = e.key;
    }

    // Posebni dio: isti (zgrada, oznaka) u više redova (suvlasnici) mora imati iste podatke.
    const label = g("oznaka");
    const data = { type: normUnitType(g("vrsta")), floor: g("sprat") ? normFloor(g("sprat")) : undefined, usableArea: g("povrsina_m2"), ownershipShare: g("udio_u_troskovima") };
    const ident = `${b.key}|${lower(label)}`;
    let u = units.get(ident);
    if (!u) {
      u = { row: r.line, key: `s${units.size + 1}`, buildingKey: b.key, entranceKey, label, ...data };
      units.set(ident, u);
    } else {
      const conflict =
        (u.type !== data.type) ||
        (u.entranceKey !== entranceKey && !(u.entranceKey === undefined || entranceKey === undefined)) ||
        (u.floor !== undefined && data.floor !== undefined && u.floor !== data.floor) ||
        !sameNumber(u.usableArea ?? "", data.usableArea) || !sameNumber(u.ownershipShare ?? "", data.ownershipShare);
      if (conflict) {
        err("oznaka", tf("onboarding.import.msg.csvUnitConflict", { oznaka: label, zgrada: bName, red: u.row }));
        continue;
      }
      if (!u.entranceKey && entranceKey) u.entranceKey = entranceKey;
      if (u.floor === undefined && data.floor !== undefined) u.floor = data.floor;
    }

    // Vlasnik (opciono).
    const first = g("ime"), last = g("prezime"), org = g("naziv_pravnog_lica"), email = g("email"), jib = g("jib_jmbg"), share = g("udio_vlasnika");
    if (!(first || last || org || email || jib || share)) continue;
    const kindRaw = g("vlasnik_vrsta");
    const kind = kindRaw ? normPartyKind(kindRaw) : org && !first && !last ? "ORGANIZATION" : "PERSON";
    const pIdent = email ? `e:${lower(email)}` : jib ? `j:${lower(jib)}` : kind === "ORGANIZATION" ? `o:${lower(org)}` : `n:${lower(first)}|${lower(last)}`;
    let p = parties.get(pIdent);
    if (!p) {
      p = { row: r.line, key: `p${parties.size + 1}`, kind, firstName: first || undefined, lastName: last || undefined, orgName: org || undefined, orgIdNumber: jib || undefined, email: email || undefined, phone: g("telefon") || undefined };
      parties.set(pIdent, p);
    } else {
      p.phone ||= g("telefon") || undefined;
      p.email ||= email || undefined;
      p.orgIdNumber ||= jib || undefined;
    }
    if (!share) {
      err("udio_vlasnika", tf("onboarding.import.msg.fieldRequired", { polje: "udio_vlasnika" }));
      continue;
    }
    const since = g("vlasnik_od");
    if (!since) {
      err("vlasnik_od", tf("onboarding.import.msg.fieldRequired", { polje: "vlasnik_od" }));
      continue;
    }
    const sIdent = `${u.key}|${p.key}`;
    if (stakeSeen.has(sIdent)) {
      err("udio_vlasnika", tf("onboarding.import.msg.duplicateOwner", { oznaka: label, red: stakeSeen.get(sIdent)! }));
      continue;
    }
    stakeSeen.set(sIdent, r.line);
    stakes.push({ row: r.line, unitKey: u.key, partyKey: p.key, sharePercent: share, validFrom: normDate(since) });
  }

  const doc: ImportDoc = {
    kind: "csv",
    buildings: [...buildings.values()],
    units: [...units.values()],
    ...(parties.size > 0 ? { parties: [...parties.values()] } : {}),
    ...(stakes.length > 0 ? { stakes } : {}),
  };
  checkLimits(doc, { errors, warnings });
  return { doc, errors, warnings };
}
