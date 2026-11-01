// Alat `get_import_format`: opis formata uvoza nacrta iz fajla (uputstvo, opis polja, primjer JSON-a, zaglavlje CSV-a). Samo
// čita statički sadržaj iz importFormat.ts (isti izvor kao stranica uvoza), pa asistent zna kakav fajl da napravi. Ne mijenja
// podatke; fajl korisnik sam uvozi u aplikaciji.
import type { McpToolDef } from "@/server/mcp/tools/registry";
import { toolJson } from "@/server/mcp/tools/onboarding/common";
import { CSV_COLUMNS, IMPORT_FORMAT_ID, IMPORT_FORMAT_VERSION, IMPORT_JSON_EXAMPLE, IMPORT_SCHEMA_DESCRIPTION, assistantInstructions } from "@/lib/onboarding/import/importFormat";

export const getImportFormatTool: McpToolDef = {
  name: "get_import_format",
  requires: "ONBOARDING_DRAFT",
  register(server) {
    server.registerTool(
      "get_import_format",
      {
        title: "Format fajla za uvoz",
        description:
          "Opis JSON/CSV fajla koji klijent može uvesti u nacrt novog ZEV-a: uputstvo, opis polja, primjer i zaglavlje CSV obrasca. Ne mijenja podatke; fajl klijent uvozi sam u aplikaciji (Uvoz iz fajla).",
        annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
      },
      async () =>
        toolJson({
          format: IMPORT_FORMAT_ID,
          formatVersion: IMPORT_FORMAT_VERSION,
          instructions: assistantInstructions(),
          fields: IMPORT_SCHEMA_DESCRIPTION,
          example: IMPORT_JSON_EXAMPLE,
          csvColumns: CSV_COLUMNS.map((c) => ({ name: c.name, aliases: c.aliases, required: Boolean(c.required) })),
        })
    );
  },
};
