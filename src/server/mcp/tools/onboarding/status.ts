// Alat `get_onboarding_status`: koraci čarobnjaka za nacrt (šta je urađeno, šta nedostaje, trenutni korak). Samo čita.
// Isti izvor kao ekrani čarobnjaka (onboardingProgress, isStepReachable, isStepReadOnly), pa asistent vidi što i klijent.
import { z } from "zod";
import type { McpToolDef } from "@/server/mcp/tools/registry";
import { accessLabel, draftIdInput, toolJson, withDraft } from "@/server/mcp/tools/onboarding/common";
import { isStepReachable, isStepReadOnly } from "@/lib/onboarding/progress";
import { t } from "@/lib/i18n";

export const onboardingStatusTool: McpToolDef = {
  name: "get_onboarding_status",
  requires: "ONBOARDING_DRAFT",
  register(server, ctx) {
    server.registerTool(
      "get_onboarding_status",
      {
        title: "Stanje podešavanja ZEV-a",
        description:
          "Koraci čarobnjaka za ovaj nacrt: šta je urađeno (✓), šta nedostaje (⚠), trenutni korak i verzija nacrta. Ne mijenja podatke. Objavu i potvrdu registra radi klijent u aplikaciji.",
        inputSchema: z.object({ draft_id: draftIdInput }),
        annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
      },
      async ({ draft_id }) =>
        withDraft(ctx, draft_id, async (draft, access) => {
          const p = draft.progress;
          const current = p.steps.find((s) => s.key === p.currentStep)!;
          return toolJson({
            draft: { id: draft.id, label: draft.label, tier: draft.tier, version: draft.version },
            access: accessLabel(access),
            currentStep: { key: current.key, number: current.number, label: current.label },
            steps: p.steps.map((s) => ({
              key: s.key, number: s.number, label: s.label, optional: s.optional, complete: s.complete,
              reachable: isStepReachable(p, s.key), readOnly: isStepReadOnly(draft.data, s.key),
              checks: s.checks.map((c) => ({ ok: c.ok, text: c.text })),
            })),
            registerConfirmed: Boolean(draft.data.registerConfirmedAt),
            readyToPublish: p.steps.filter((s) => s.key !== "review").every((s) => s.complete),
            note: t("assistants.tools.statusNote"),
          });
        })
    );
  },
};
