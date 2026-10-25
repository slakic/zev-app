// Prikaz parametara korisniku (read-only pregled, poruka „Sačuvano: … → …”) i prenos spiska izmjena kroz URL nakon
// redirecta. Poruka se uvijek ponovo gradi iz poznatih ključeva i kanonski parsiranih vrijednosti — tekst iz URL-a se
// nikad ne prikazuje doslovno.
import { formatMoney } from "@/lib/money";
import { isFewForm, isOneForm } from "@/lib/plural";
import { SETTING_DEFINITIONS, isSettingKey, type SettingDefinition } from "@/lib/settings-defaults";
import { parseSettingValue, type SettingChange, type SettingIssue } from "@/lib/settings-form";
import { t, tf } from "@/lib/i18n";

export function settingName(def: SettingDefinition): string {
  return t(`settingsPage.param.${def.key}.name`);
}

/** Naziv u labeli polja: "Čuvanje finansijskih dokumenata (godina)". */
export function settingFieldLabel(def: SettingDefinition): string {
  if (!def.unit) return settingName(def);
  return tf("settingsPage.fieldLabel", { name: settingName(def), unit: t(`settingsPage.unit.${def.unit}.label`) });
}

export function formatSettingValue(def: SettingDefinition, value: string): string {
  // Vrijednost koja ne prolazi parsiranje (npr. stari zapis iz revizorskog traga, upisan slobodnim tekstom) se
  // prikazuje onakva kakva je — prikaz nikad ne smije srušiti stranicu.
  const parsed = parseSettingValue(def, value);
  if (!parsed.ok) return value;
  const v = parsed.value;
  if (def.type === "boolean") return t(`settingsPage.bool.${def.boolLabels ?? "onOff"}.${v === "true" ? "on" : "off"}`);
  if (def.type === "money") return formatMoney(v);
  if (!def.unit) return v;
  if (def.unit === "dayOfMonth") return `${v}.`;
  const n = Number(v);
  const form = isOneForm(n) ? "one" : isFewForm(n) ? "few" : "other";
  return `${v} ${t(`settingsPage.unit.${def.unit}.${form}`)}`;
}

/** "Prag za hitne radove: 500,00 KM → 600,00 KM; Zatezna kamata: Isključeno → Uključeno" */
export function describeSettingChanges(changes: SettingChange[]): string {
  return changes
    .flatMap((c) => {
      const def = SETTING_DEFINITIONS.find((d) => d.key === c.key);
      return def ? [`${settingName(def)}: ${formatSettingValue(def, c.before)} → ${formatSettingValue(def, c.after)}`] : [];
    })
    .join("; ");
}

/** Izmjene u query string: `ch=<ključ>~<staro>~<novo>` po izmjeni. */
export function encodeSettingChanges(changes: SettingChange[]): string[] {
  return changes.map((c) => [c.key, c.before, c.after].map(encodeURIComponent).join("~"));
}

/** Samo poznati ključevi i vrijednosti koje prolaze isto parsiranje kao unos; sve ostalo se tiho odbacuje. */
export function decodeSettingChanges(raw: string | string[] | undefined): SettingChange[] {
  const list = raw === undefined ? [] : Array.isArray(raw) ? raw : [raw];
  const out: SettingChange[] = [];
  for (const item of list) {
    const parts = item.split("~");
    if (parts.length !== 3) continue;
    let key: string, before: string, after: string;
    try {
      [key, before, after] = parts.map(decodeURIComponent);
    } catch {
      continue;
    }
    if (!isSettingKey(key)) continue;
    const def = SETTING_DEFINITIONS.find((d) => d.key === key)!;
    const b = parseSettingValue(def, before);
    const a = parseSettingValue(def, after);
    if (b.ok && a.ok) out.push({ key, before: b.value, after: a.value });
  }
  return out;
}

/** Poruka o neispravnim vrijednostima, jedna rečenica po polju: "Prag za hitne radove: unesite iznos u KM, …". */
export function describeSettingIssues(issues: SettingIssue[]): string {
  return issues
    .flatMap((i) => {
      const def = SETTING_DEFINITIONS.find((d) => d.key === i.key);
      if (!def) return [];
      const name = settingName(def);
      if (i.error === "empty") return [tf("settingsPage.error.empty", { name })];
      if (i.error === "range") return [tf("settingsPage.error.range", { name, min: def.min ?? 0, max: def.max ?? 0 })];
      return [tf(`settingsPage.error.${def.type === "money" ? "money" : def.type === "integer" ? "integer" : "boolean"}`, { name })];
    })
    .join(" ");
}
