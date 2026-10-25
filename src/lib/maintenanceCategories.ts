// F8.2 (F8-Q1 (a)): fiksna lista kategorija kvara u formi „Prijavi kvar” + „Drugo”. U bazi ostaje tekst kategorije
// (kolona je slobodan tekst), pa raniji unosi ("krov", "vodovod") ostaju vidljivi nepromijenjeni.
export const MAINTENANCE_CATEGORY_KEYS = ["plumbing", "electric", "lift", "roof", "heating", "common", "other"] as const;
export type MaintenanceCategoryKey = (typeof MAINTENANCE_CATEGORY_KEYS)[number];
