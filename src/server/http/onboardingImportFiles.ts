// Fajlovi za preuzimanje uz uvoz nacrta: CSV obrazac, JSON primjer i izvoz nacrta (nacrt.json). Zajedničko za rutu
// vlasnika i rutu administratora; pravo pristupa je već dokazano (`DraftAccess`) prije poziva. Izvoz sadrži lične podatke,
// pa je uvijek `no-store`.
import { draftExportDoc } from "@/server/services/onboardingImport";
import type { DraftAccess } from "@/server/services/draftAccess";
import { IMPORT_JSON_EXAMPLE, csvTemplate } from "@/lib/onboarding/import/importFormat";

export const IMPORT_FILE_NAMES = ["obrazac.csv", "primjer.json", "nacrt.json"] as const;

export async function importFileResponse(fajl: string, access: DraftAccess): Promise<Response> {
  const headers = (type: string, name: string) => ({
    "Content-Type": type,
    "Content-Disposition": `attachment; filename="${name}"`,
    "Cache-Control": "private, no-store",
  });
  switch (fajl) {
    case "obrazac.csv":
      return new Response(csvTemplate(), { headers: headers("text/csv; charset=utf-8", "zev-posebni-dijelovi-obrazac.csv") });
    case "primjer.json":
      return new Response(JSON.stringify(IMPORT_JSON_EXAMPLE, null, 2), { headers: headers("application/json; charset=utf-8", "zev-nacrt-primjer.json") });
    case "nacrt.json":
      return new Response(JSON.stringify(await draftExportDoc(access), null, 2), { headers: headers("application/json; charset=utf-8", "zev-nacrt.json") });
    default:
      return new Response("Nepoznat fajl.", { status: 404 });
  }
}
