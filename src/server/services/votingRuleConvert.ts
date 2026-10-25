// Jednokratna konverzija pravila glasanja na "jedan etazni vlasnik — jedan glas" (FR, K-03).
// Poziva je scripts/fr-convert-voting-rules.ts. Idempotentna: pravilo koje je vec u novom obliku se ne dira.
// Plans/fr-registar-i-glasanje-po-etaznim-vlasnicima-plan.md §3.5.
import { prisma } from "@/lib/prisma";
import { audit } from "@/server/audit";

const SUFFIX = " (jedan vlasnik — jedan glas)";

export type ConvertedRule = {
  ruleId: string;
  zevId: string;
  name: { before: string; after: string };
  weightMethod: { before: string; after: string };
  quorumType: { before: string; after: string };
};

/**
 * Za svako pravilo sa weightMethod != PER_OWNER: weightMethod -> PER_OWNER; quorumType PERCENT_OF_TOTAL_WEIGHT ->
 * PERCENT_OF_OWNER_COUNT (isti procenat); ime dobija sufiks. Audit `voting_rule.convert` po pravilu.
 * Prijedlozi koji su vec otvoreni/zatvoreni ostaju netaknuti (zamrznuti `ruleSnapshot`).
 */
export async function convertVotingRulesToPerOwner(opts: { zevId?: string; dryRun?: boolean } = {}): Promise<ConvertedRule[]> {
  const rules = await prisma.votingRule.findMany({
    where: { weightMethod: { not: "PER_OWNER" }, zevId: opts.zevId },
    orderBy: [{ zevId: "asc" }, { name: "asc" }],
  });
  const converted: ConvertedRule[] = [];
  for (const r of rules) {
    const quorumType = r.quorumType === "PERCENT_OF_TOTAL_WEIGHT" ? "PERCENT_OF_OWNER_COUNT" : r.quorumType;
    const name = r.name.endsWith(SUFFIX) ? r.name : `${r.name}${SUFFIX}`;
    if (!opts.dryRun) await prisma.$transaction(async (tx) => {
      await tx.votingRule.update({ where: { id: r.id }, data: { weightMethod: "PER_OWNER", quorumType, name } });
      await audit(
        // Sistemska radnja bez korisnika (kao reset-evote-prefetch-pending): tenant se prenosi izricito.
        { label: "system" },
        {
          action: "voting_rule.convert", targetType: "VotingRule", targetId: r.id, zevId: r.zevId,
          before: { name: r.name, weightMethod: r.weightMethod, quorumType: r.quorumType },
          after: { name, weightMethod: "PER_OWNER", quorumType },
          reason: "FR (K-03): jedan etažni vlasnik — jedan glas",
        },
        tx,
      );
    });
    converted.push({
      ruleId: r.id, zevId: r.zevId,
      name: { before: r.name, after: name },
      weightMethod: { before: r.weightMethod, after: "PER_OWNER" },
      quorumType: { before: r.quorumType, after: quorumType },
    });
  }
  return converted;
}
