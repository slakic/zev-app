// Parsiranje i poređenje parametara (F7, X-R10): parametri utiču na obračun i pravila glasanja, pa se granični unosi
// (decimalni zarez, prazno polje, dvosmislena tačka, tekst umjesto broja) testiraju do detalja.
import { describe, it, expect } from "vitest";
import { SETTING_DEFINITIONS, DEFAULT_SETTINGS, type SettingKey } from "@/lib/settings-defaults";
import { diffSettings, parseSettingValue, canonicalSettingValue } from "@/lib/settings-form";
import {
  decodeSettingChanges,
  describeSettingChanges,
  describeSettingIssues,
  encodeSettingChanges,
  formatSettingValue,
  settingFieldLabel,
} from "@/lib/settings-display";

const def = (key: SettingKey) => SETTING_DEFINITIONS.find((d) => d.key === key)!;
const money = def("emergency.costThreshold");
const int = def("invoice.dueDay");
const bool = def("interest.enabled");

describe("parseSettingValue", () => {
  it("boolean: samo true/false, ništa drugo", () => {
    expect(parseSettingValue(bool, "true")).toEqual({ ok: true, value: "true" });
    expect(parseSettingValue(bool, " false ")).toEqual({ ok: true, value: "false" });
    for (const bad of ["da", "ne", "1", "True", "uključeno"]) {
      expect(parseSettingValue(bool, bad)).toEqual({ ok: false, error: "invalid" });
    }
  });

  it("integer: cijeli broj u opsegu; decimale, tekst i izvan opsega su greška", () => {
    expect(parseSettingValue(int, "15")).toEqual({ ok: true, value: "15" });
    expect(parseSettingValue(int, " 07 ")).toEqual({ ok: true, value: "7" });
    expect(parseSettingValue(int, "11,5")).toEqual({ ok: false, error: "invalid" });
    expect(parseSettingValue(int, "11.0")).toEqual({ ok: false, error: "invalid" });
    expect(parseSettingValue(int, "-3")).toEqual({ ok: false, error: "invalid" });
    expect(parseSettingValue(int, "petnaest")).toEqual({ ok: false, error: "invalid" });
    expect(parseSettingValue(int, "0")).toEqual({ ok: false, error: "range" });
    expect(parseSettingValue(int, "29")).toEqual({ ok: false, error: "range" });
    expect(parseSettingValue(int, "28")).toEqual({ ok: true, value: "28" });
  });

  it("money: decimalni zarez, tačka kao hiljade, sufiks KM; kanonski oblik bez nula", () => {
    expect(parseSettingValue(money, "600")).toEqual({ ok: true, value: "600" });
    expect(parseSettingValue(money, "600,00")).toEqual({ ok: true, value: "600" });
    expect(parseSettingValue(money, "600.00")).toEqual({ ok: true, value: "600" });
    expect(parseSettingValue(money, "1.234,56")).toEqual({ ok: true, value: "1234.56" });
    expect(parseSettingValue(money, "1234,5")).toEqual({ ok: true, value: "1234.5" });
    expect(parseSettingValue(money, "  750,00 KM ")).toEqual({ ok: true, value: "750" });
    expect(parseSettingValue(money, "0")).toEqual({ ok: true, value: "0" });
  });

  it("money: dvosmislen ili pogrešan unos se odbija umjesto da se pogodi", () => {
    // "1.500" bi neko mogao pročitati kao 1,5 KM ili 1500 KM — odbija se.
    expect(parseSettingValue(money, "1.500")).toEqual({ ok: false, error: "invalid" });
    expect(parseSettingValue(money, "1,234.56")).toEqual({ ok: false, error: "invalid" });
    expect(parseSettingValue(money, "12,345")).toEqual({ ok: false, error: "invalid" });
    expect(parseSettingValue(money, "-5")).toEqual({ ok: false, error: "invalid" });
    expect(parseSettingValue(money, "abc")).toEqual({ ok: false, error: "invalid" });
    expect(parseSettingValue(money, "5e3")).toEqual({ ok: false, error: "invalid" });
    expect(parseSettingValue(money, "20.000.000,00")).toEqual({ ok: false, error: "range" });
  });

  it("prazno ili samo razmaci je greška, ne nula", () => {
    for (const d of SETTING_DEFINITIONS) {
      expect(parseSettingValue(d, "")).toEqual({ ok: false, error: "empty" });
      expect(parseSettingValue(d, "   ")).toEqual({ ok: false, error: "empty" });
      expect(parseSettingValue(d, null)).toEqual({ ok: false, error: "empty" });
    }
  });

  it("canonicalSettingValue: sačuvano \"500.00\" je isto što i \"500\"; neispravno ostaje kakvo jeste", () => {
    expect(canonicalSettingValue(money, "500.00")).toBe("500");
    expect(canonicalSettingValue(money, "oko 500")).toBe("oko 500");
  });
});

describe("diffSettings", () => {
  const current = { ...DEFAULT_SETTINGS };

  it("vraća samo promijenjene vrijednosti, sa starom i novom", () => {
    const r = diffSettings(current, {
      "retention.financialYears": "11", // isto
      "emergency.costThreshold": "600,00", // promijenjeno
      "interest.enabled": "false", // isto
      "board.size": "5", // promijenjeno
    });
    expect(r).toEqual({
      ok: true,
      changes: [
        { key: "emergency.costThreshold", before: "500", after: "600" },
        { key: "board.size", before: "3", after: "5" },
      ],
    });
  });

  it("zapis u drugom obliku ali iste vrijednosti nije izmjena (\"500,00\" naspram sačuvanog \"500\")", () => {
    expect(diffSettings(current, { "emergency.costThreshold": "500,00" })).toEqual({ ok: true, changes: [] });
    expect(diffSettings({ ...current, "emergency.costThreshold": "500.00" }, { "emergency.costThreshold": "500" })).toEqual({ ok: true, changes: [] });
  });

  it("sve-ili-ništa: jedna neispravna vrijednost poništava i ispravne izmjene", () => {
    const r = diffSettings(current, { "emergency.costThreshold": "600", "invoice.dueDay": "", "board.size": "abc" });
    expect(r).toEqual({
      ok: false,
      issues: [
        { key: "invoice.dueDay", error: "empty" },
        { key: "board.size", error: "invalid" },
      ],
    });
  });

  it("ključ koji nije poslat se ne dira; poslato prazno je greška", () => {
    expect(diffSettings(current, {})).toEqual({ ok: true, changes: [] });
    expect(diffSettings(current, { "board.size": null, "board.termYears": undefined })).toEqual({ ok: true, changes: [] });
    expect(diffSettings(current, { "board.size": "" }).ok).toBe(false);
  });

  it("bulov parametar se mijenja samo izborom true/false", () => {
    expect(diffSettings(current, { "interest.enabled": "true" })).toEqual({
      ok: true,
      changes: [{ key: "interest.enabled", before: "false", after: "true" }],
    });
    expect(diffSettings(current, { "interest.enabled": "uključeno" }).ok).toBe(false);
  });
});

describe("prikaz i prenos izmjena", () => {
  it("poruka navodi naziv: staro → novo, sa jedinicom i oblikom množine", () => {
    const text = describeSettingChanges([
      { key: "emergency.costThreshold", before: "500", after: "600" },
      { key: "interest.enabled", before: "false", after: "true" },
      { key: "retention.financialYears", before: "11", after: "12" },
      { key: "board.termYears", before: "4", after: "2" },
      { key: "invoice.dueDay", before: "15", after: "1" },
    ]);
    expect(text).toBe(
      "Prag za hitne radove bez skupštine: 500,00 KM → 600,00 KM; " +
        "Zatezna kamata: Isključeno → Uključeno; " +
        "Čuvanje finansijskih dokumenata: 11 godina → 12 godina; " +
        "Trajanje mandata organa: 4 godine → 2 godine; " +
        "Podrazumijevani dan dospijeća fakture: 15. → 1.",
    );
  });

  it("Da/Ne za parametar koji to traži; neispravna stara vrijednost se prikazuje kakva jeste", () => {
    expect(formatSettingValue(def("board.presidentIsBoardPresident"), "true")).toBe("Da");
    expect(formatSettingValue(money, "oko 500")).toBe("oko 500");
  });

  it("label polja ima jedinicu u zagradi samo kad je ima", () => {
    expect(settingFieldLabel(def("retention.voteIpDays"))).toBe("Čuvanje IP podataka glasanja (dana)");
    expect(settingFieldLabel(def("board.size"))).toBe("Broj članova upravnog odbora");
  });

  it("encode/decode: vraća iste izmjene, a ono što nije poznato ili ispravno tiho odbacuje", () => {
    const changes = [{ key: "emergency.costThreshold" as const, before: "500", after: "600" }];
    expect(decodeSettingChanges(encodeSettingChanges(changes))).toEqual(changes);
    expect(decodeSettingChanges(["evil.key~1~2", "board.size~abc~5", "bez-tildi", "board.size~%E0%A4%A~5"])).toEqual([]);
    expect(decodeSettingChanges(undefined)).toEqual([]);
  });

  it("poruka o greškama imenuje polje i šta se očekuje", () => {
    expect(describeSettingIssues([{ key: "emergency.costThreshold", error: "invalid" }])).toContain("Prag za hitne radove bez skupštine: unesite iznos u KM");
    expect(describeSettingIssues([{ key: "invoice.dueDay", error: "range" }])).toContain("od 1 do 28");
    expect(describeSettingIssues([{ key: "board.size", error: "empty" }])).toContain("ne smije biti prazno");
  });
});
