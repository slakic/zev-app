// Šifre konta i hijerarhija kontnog plana (Plans/kontni-plan-i-knjizenje-plan.md §3.4).
// Čiste funkcije, bez Prisme: koristi ih servis (provjera), uvoz CSV-a i stranica (prikaz stabla).
//
// Šifra je uvijek TEKST. Nijedna funkcija ovdje je ne pretvara u broj — "0100" i "100" su dva
// različita konta, a sortiranje je leksičko, kao u kontnom planu na papiru.

export const ACCOUNT_NATURES = ["ASSET", "LIABILITY", "EQUITY", "INCOME", "EXPENSE", "OFF_BALANCE"] as const;
export type AccountNatureCode = (typeof ACCOUNT_NATURES)[number];

/** Pravila šifara vezana za predložak, ne univerzalna pretpostavka (§3.4). Sva su opciona. */
export type CodeRules = {
  /** Šifra smije sadržati samo cifre. */
  digitsOnly: boolean;
  /** Dozvoljene dužine šifre; prazno = bilo koja dužina. */
  allowedLengths: number[];
  /** Šifra podkonta mora počinjati šifrom nadređenog konta i biti duža od nje. */
  childExtendsParent: boolean;
  /** Najveća dubina hijerarhije (1 = samo konta bez nadređenog); null = bez ograničenja. */
  maxDepth: number | null;
};

export const EMPTY_CODE_RULES: CodeRules = { digitsOnly: false, allowedLengths: [], childExtendsParent: false, maxDepth: null };

/** Čita `codeRules` iz baze (Json) ili forme; nepoznata ili pogrešna polja padaju na „bez pravila”. */
export function parseCodeRules(raw: unknown): CodeRules {
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const lengths = Array.isArray(r.allowedLengths)
    ? [...new Set(r.allowedLengths.map(Number).filter((n) => Number.isInteger(n) && n > 0))].sort((a, b) => a - b)
    : [];
  const maxDepth = Number(r.maxDepth);
  return {
    digitsOnly: r.digitsOnly === true,
    allowedLengths: lengths,
    childExtendsParent: r.childExtendsParent === true,
    maxDepth: Number.isInteger(maxDepth) && maxDepth > 0 ? maxDepth : null,
  };
}

/** „1, 3, 4” → [1, 3, 4]; prazno → []. Vraća null kad unos nije lista pozitivnih cijelih brojeva. */
export function parseLengthList(text: string): number[] | null {
  const parts = text.split(/[,;\s]+/).map((p) => p.trim()).filter(Boolean);
  const nums = parts.map(Number);
  if (nums.some((n) => !Number.isInteger(n) || n <= 0)) return null;
  return [...new Set(nums)].sort((a, b) => a - b);
}

/**
 * Provjera jedne šifre prema pravilima predloška. `parentCode`/`depth` opisuju mjesto u stablu
 * (depth 1 = konto bez nadređenog). Vraća poruku greške ili null.
 */
export function validateAccountCode(
  code: string,
  rules: CodeRules,
  place: { parentCode: string | null; depth: number }
): string | null {
  if (code.length === 0) return "Šifra konta je obavezna.";
  if (/\s/.test(code)) return `Šifra „${code}” ne smije sadržati razmake.`;
  if (rules.digitsOnly && !/^\d+$/.test(code)) return `Šifra „${code}” smije sadržati samo cifre.`;
  if (rules.allowedLengths.length > 0 && !rules.allowedLengths.includes(code.length)) {
    return `Šifra „${code}” ima ${code.length} znak(ova); dozvoljene dužine su ${rules.allowedLengths.join(", ")}.`;
  }
  if (rules.maxDepth !== null && place.depth > rules.maxDepth) {
    return `Konto „${code}” bi bio na nivou ${place.depth}; predložak dozvoljava najviše ${rules.maxDepth} nivoa.`;
  }
  if (rules.childExtendsParent && place.parentCode !== null) {
    if (!code.startsWith(place.parentCode) || code.length <= place.parentCode.length) {
      return `Šifra podkonta „${code}” mora počinjati šifrom nadređenog konta „${place.parentCode}” i biti duža od nje.`;
    }
  }
  return null;
}

/** Normalizacija unosa šifre: samo uklanja razmake na krajevima, nikad vodeće nule. */
export function normalizeCode(raw: string): string {
  return raw.trim();
}

export type TreeNode = { id: string; code: string; parentId: string | null };

/** Leksičko poređenje šifri (bez locale-a, da "0100" < "100" < "1000" uvijek isto). */
export function compareCodes(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * Stablo u redoslijedu za prikaz: roditelj pa njegova djeca (po šifri), sa dubinom (0 = vrh).
 * Konto čiji roditelj nije u listi (npr. filtriran pretragom) ide na vrh, sa dubinom 0.
 */
export function flattenTree<T extends TreeNode>(nodes: T[]): (T & { depth: number; hasChildren: boolean })[] {
  const ids = new Set(nodes.map((n) => n.id));
  const byParent = new Map<string | null, T[]>();
  for (const n of nodes) {
    const key = n.parentId && ids.has(n.parentId) ? n.parentId : null;
    const list = byParent.get(key) ?? [];
    list.push(n);
    byParent.set(key, list);
  }
  for (const list of byParent.values()) list.sort((a, b) => compareCodes(a.code, b.code));
  const out: (T & { depth: number; hasChildren: boolean })[] = [];
  const seen = new Set<string>();
  const walk = (parent: string | null, depth: number) => {
    for (const n of byParent.get(parent) ?? []) {
      if (seen.has(n.id)) continue;
      seen.add(n.id);
      out.push({ ...n, depth, hasChildren: (byParent.get(n.id) ?? []).length > 0 });
      walk(n.id, depth + 1);
    }
  };
  walk(null, 0);
  return out;
}

/** Da li bi postavljanje `newParentId` kao roditelja konta `id` napravilo ciklus. */
export function wouldCreateCycle(nodes: TreeNode[], id: string, newParentId: string | null): boolean {
  const parentOf = new Map(nodes.map((n) => [n.id, n.parentId]));
  let cur = newParentId;
  let guard = 0;
  while (cur !== null && cur !== undefined) {
    if (cur === id) return true;
    cur = parentOf.get(cur) ?? null;
    if (++guard > 10_000) return true;
  }
  return false;
}

export type ChartCsvRow = {
  line: number;
  code: string;
  name: string;
  parentCode: string | null;
  nature: AccountNatureCode;
  postable: boolean;
  description: string | null;
};

const NATURE_ALIASES: Record<string, AccountNatureCode> = Object.fromEntries(
  ACCOUNT_NATURES.map((n) => [n.toLowerCase(), n])
);

function parseBool(raw: string): boolean | null {
  const v = raw.trim().toLowerCase();
  if (["da", "d", "1", "true", "yes", "x"].includes(v)) return true;
  if (["ne", "n", "0", "false", "no", ""].includes(v)) return false;
  return null;
}

/**
 * Uvoz konta u predložak iz CSV-a (redovi već razdvojeni kroz `parseCsv`). Kolone, tim redom:
 * šifra; naziv; nadređena šifra; vrsta (ASSET…OFF_BALANCE); knjižno (da/ne); opis.
 * Prvi red je zaglavlje ako mu prva ćelija nije šifra koja se ponavlja niže — prepoznaje se po
 * tekstu „šifra”/„sifra”/„code”. Vraća redove ili listu grešaka po broju reda.
 */
export function parseChartCsv(
  rows: { line: number; cells: string[] }[],
  rules: CodeRules
): { rows: ChartCsvRow[]; errors: string[] } {
  const errors: string[] = [];
  const data = rows.filter((r) => r.cells.some((c) => c.trim() !== ""));
  if (data.length > 0 && /^(šifra|sifra|code|konto)$/i.test(data[0].cells[0]?.trim() ?? "")) data.shift();

  const parsed: ChartCsvRow[] = [];
  const seen = new Map<string, number>();
  for (const r of data) {
    const [codeRaw = "", nameRaw = "", parentRaw = "", natureRaw = "", postableRaw = "", descRaw = ""] = r.cells;
    const code = normalizeCode(codeRaw);
    const name = nameRaw.trim();
    const parentCode = normalizeCode(parentRaw) || null;
    const nature = NATURE_ALIASES[natureRaw.trim().toLowerCase()];
    const postable = parseBool(postableRaw);
    if (!code) { errors.push(`Red ${r.line}: šifra je obavezna.`); continue; }
    if (!name) errors.push(`Red ${r.line}: naziv konta „${code}” je obavezan.`);
    if (!nature) errors.push(`Red ${r.line}: nepoznata vrsta „${natureRaw.trim()}” (dozvoljeno: ${ACCOUNT_NATURES.join(", ")}).`);
    if (postable === null) errors.push(`Red ${r.line}: kolona „knjižno” mora biti da ili ne.`);
    if (seen.has(code)) errors.push(`Red ${r.line}: šifra „${code}” se ponavlja (prvi put u redu ${seen.get(code)}).`);
    else seen.set(code, r.line);
    if (parentCode === code) errors.push(`Red ${r.line}: konto „${code}” ne može biti sam sebi nadređen.`);
    parsed.push({ line: r.line, code, name, parentCode, nature: nature ?? "ASSET", postable: postable ?? false, description: descRaw.trim() || null });
  }

  const byCode = new Map(parsed.map((p) => [p.code, p]));
  const hasChildren = new Set(parsed.map((p) => p.parentCode).filter((c): c is string => c !== null));
  for (const p of parsed) {
    if (p.parentCode && !byCode.has(p.parentCode)) {
      errors.push(`Red ${p.line}: nadređena šifra „${p.parentCode}” ne postoji u fajlu.`);
      continue;
    }
    // Dubina i ciklus: šetnja naviše kroz šifre iz fajla.
    let depth = 1;
    let cur = p.parentCode;
    let cyclic = false;
    while (cur) {
      if (cur === p.code || depth > parsed.length) { cyclic = true; break; }
      depth += 1;
      cur = byCode.get(cur)?.parentCode ?? null;
    }
    if (cyclic) { errors.push(`Red ${p.line}: hijerarhija konta „${p.code}” ima ciklus.`); continue; }
    const codeErr = validateAccountCode(p.code, rules, { parentCode: p.parentCode, depth });
    if (codeErr) errors.push(`Red ${p.line}: ${codeErr}`);
    if (p.postable && hasChildren.has(p.code)) errors.push(`Red ${p.line}: konto „${p.code}” ima podkonta, pa ne može biti knjižno.`);
  }
  return { rows: parsed, errors };
}

/** Redoslijed upisa: svaki roditelj prije svoje djece (za insert sa FK na roditelja). */
export function parentsFirst<T extends { code: string; parentCode: string | null }>(rows: T[]): T[] {
  const byCode = new Map(rows.map((r) => [r.code, r]));
  const depthOf = (r: T): number => {
    let d = 0;
    let cur = r.parentCode;
    while (cur && d <= rows.length) { d += 1; cur = byCode.get(cur)?.parentCode ?? null; }
    return d;
  };
  return [...rows].sort((a, b) => depthOf(a) - depthOf(b) || compareCodes(a.code, b.code));
}
