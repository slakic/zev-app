// One-time conversion of voting rules to "jedan etazni vlasnik — jedan glas" (FR, K-03;
// Plans/fr-registar-i-glasanje-po-etaznim-vlasnicima-plan.md §3.5, §10.3).
//   - weightMethod OWNERSHIP_SHARE / USABLE_AREA  -> PER_OWNER
//   - quorumType PERCENT_OF_TOTAL_WEIGHT          -> PERCENT_OF_OWNER_COUNT (same percent)
//   - the rule name gets the suffix " (jedan vlasnik — jedan glas)"
// Idempotent (a second run changes nothing) and audited per rule (`voting_rule.convert`). Proposals that are
// already open or closed keep their frozen ruleSnapshot and are never recalculated.
//
// Run right after deploying v2.43.0 (the assembly weight is forced to 1 by openVoting regardless, so
// nothing is miscounted in between). Pass --dry-run to only list what would change.
//
// Usage (against production, with its direct connection string):
//   DATABASE_URL="postgresql://…" npx tsx scripts/fr-convert-voting-rules.ts             # write
//   DATABASE_URL="postgresql://…" npx tsx scripts/fr-convert-voting-rules.ts --dry-run   # list only
import "dotenv/config";
import { prisma } from "../src/lib/prisma";
import { convertVotingRulesToPerOwner } from "../src/server/services/votingRuleConvert";

async function main() {
  const dryRun = process.argv.includes("--dry-run");
  const converted = await convertVotingRulesToPerOwner({ dryRun });
  console.log(`${dryRun ? "[proba] Preračunao bih" : "Preračunato"} pravila glasanja: ${converted.length}.`);
  for (const c of converted) {
    console.log(
      `  ${c.ruleId} (ZEV ${c.zevId}): „${c.name.before}" → „${c.name.after}"; težina ${c.weightMethod.before} → ${c.weightMethod.after}; kvorum ${c.quorumType.before} → ${c.quorumType.after}`
    );
  }
}

main().finally(() => prisma.$disconnect());
