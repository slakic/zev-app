// Opcije izbora opsega (ChoiceCards) za vezu asistenta — dijele ih forma „Poveži asistenta" (/nalog/asistenti) i
// ekran saglasnosti OAuth-a (/oauth/authorize), da obje stranice kažu tačno isto šta asistent smije. Vrijednosti
// (`value`) su ključevi koje server ponovo izvodi iz baze; tekst je samo prikaz.
import { t, tf } from "@/lib/i18n";

export type ScopeChoice = { value: string; title: string; allowed?: string; denied?: string; note?: string };

/** „Samo provjera veze" je uvijek posljednja opcija i unaprijed izabrana tek kad nema nacrta koji se nudi. */
export function buildScopeOptions(offered: { key: string; label: string; via?: "OWNER" | "ADMIN" }[]): ScopeChoice[] {
  return [
    ...offered.map((o) => ({
      value: o.key,
      title: tf(o.via === "ADMIN" ? "assistants.scope.draftAdmin.title" : "assistants.scope.draft.title", { naziv: o.label }),
      allowed: t("assistants.scope.draft.allowed"),
      denied: t("assistants.scope.draft.denied"),
      note: t("assistants.scope.draft.note"),
    })),
    {
      value: "none",
      title: t("assistants.scope.none.title"),
      allowed: t("assistants.scope.none.allowed"),
      denied: t("assistants.scope.none.denied"),
      note: undefined,
    },
  ];
}

/** Unaprijed izabran opseg: onaj iz adrese (`preselect`) ako je među ponuđenima, inače prvi nacrt ili „samo provjera veze". */
export function defaultScopeKey(offered: { key: string }[], preselect?: string): string {
  if (preselect && offered.some((o) => o.key === preselect)) return preselect;
  return offered[0]?.key ?? "none";
}
