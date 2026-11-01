// Alat `whoami`: ko je povezan i koje dozvole veza ima. Ne čita i ne mijenja podatke ZEV-a, pa ga ima svaka
// veza, i ona „samo provjera veze" bez opsega. U odgovoru nikad nema tokena, hasha, e-pošte ni internih id-jeva.
import type { McpToolDef } from "@/server/mcp/tools/registry";
import { describeScopes } from "@/server/mcp/access";
import { t } from "@/lib/i18n";
import { displayNameFor } from "@/server/auth/displayName";

export const whoamiTool: McpToolDef = {
  name: "whoami",
  requires: null,
  register(server, ctx) {
    server.registerTool(
      "whoami",
      {
        title: "Ko je povezan",
        description: "Ko je povezan i koje dozvole ova veza ima. Ne čita niti mijenja podatke.",
        annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
      },
      async () => {
        const [displayName, scopes] = await Promise.all([displayNameFor(ctx.userId, { withEmail: false }), describeScopes(ctx.userId, ctx.scopes)]);
        const payload = {
          // Bez Party-ja nema imena, a e-pošta se ne daje asistentu.
          user: { displayName: displayName || t("assistants.whoami.unnamed") },
          connection: { name: ctx.connectionName, client: ctx.client, expiresAt: ctx.expiresAt.toISOString() },
          scopes: scopes.map((s) => ({ kind: s.scope.kind, draftId: s.scope.draftId, label: s.label, active: s.active })),
        };
        return { content: [{ type: "text", text: JSON.stringify(payload) }], structuredContent: payload };
      }
    );
  },
};
