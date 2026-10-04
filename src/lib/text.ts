/**
 * Strips Serbian/Bosnian diacritics so text a bank prints in plain ASCII ("ZELJKO GALIC",
 * "DJURIC", "DZAJIC") can be compared with names as stored in the app ("Željko Galić",
 * "Đurić", "Džajić"). Banks differ on how they flatten "đ": most print "DJ", some just "D", so
 * callers that compare names try both (`dj` and `d`). Everything else (č ć š ž and the "ž" in
 * "dž") decomposes via NFD and loses its mark. The result is lower-cased.
 */
export function foldDiacritics(s: string, dj: "dj" | "d" = "dj"): string {
  const repl = dj === "dj" ? "dj" : "d";
  return s
    .toLowerCase()
    .replace(/đ/g, repl)
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "");
}
