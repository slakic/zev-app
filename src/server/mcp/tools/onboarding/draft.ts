// Alat `get_draft`: sadržaj nacrta za čitanje. Samo čita; šta se šalje određuje draftForAssistant (bez hasheva lozinki,
// bajtova fajlova i internih id-jeva). `version` asistent šalje uz svaku buduću izmjenu (optimistička brava, O-B).
import { z } from "zod";
import type { McpToolDef } from "@/server/mcp/tools/registry";
import { accessLabel, draftIdInput, toolJson, withDraft } from "@/server/mcp/tools/onboarding/common";
import { DRAFT_SECTIONS, draftForAssistant } from "@/lib/onboarding/draftForAssistant";
import { prisma } from "@/lib/prisma";

export const getDraftTool: McpToolDef = {
  name: "get_draft",
  requires: "ONBOARDING_DRAFT",
  register(server, ctx) {
    server.registerTool(
      "get_draft",
      {
        title: "Sadržaj nacrta",
        description:
          "Sadržaj nacrta za čitanje: podaci o ZEV-u, računi, zgrade i ulazi, posebni i zajednički dijelovi, lica, udjeli (dokaz samo kao naziv fajla), organi. Bez fajlova i lozinki. `version` se šalje uz svaku buduću izmjenu. Za velike nacrte tražite pojedine sekcije (`sections`).",
        inputSchema: z.object({ draft_id: draftIdInput, sections: z.array(z.enum(DRAFT_SECTIONS)).max(7).optional() }),
        annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
      },
      async ({ draft_id, sections }) =>
        withDraft(ctx, draft_id, async (draft, access) => {
          // Samo metapodaci fajlova dokaza; kolona `bytes` se nikad ne bira.
          const files = await prisma.onboardingDraftFile.findMany({
            where: { draftId: draft.id },
            select: { id: true, filename: true, mime: true, size: true },
          });
          return toolJson({
            draftId: draft.id,
            label: draft.label,
            tier: draft.tier,
            version: draft.version,
            access: accessLabel(access),
            ...draftForAssistant(draft.data, files, sections),
          });
        })
    );
  },
};
