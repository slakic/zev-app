// FR (K-03) — scripts/fr-convert-voting-rules.ts (plan §3.5): pravila glasanja po udjelu postaju
// "jedan etazni vlasnik — jedan glas"; zamrznuti prijedlozi se ne diraju.
import { describe, it, expect } from "vitest";
import { prisma } from "@/lib/prisma";
import { createFixture, createProposalFixture } from "./helpers";
import { convertVotingRulesToPerOwner } from "@/server/services/votingRuleConvert";
import { openVoting, recordManualVote, closeVoting, computeProposalResult } from "@/server/services/meetings";

async function legacyRule(zevId: string, name: string, over: Partial<{ weightMethod: "OWNERSHIP_SHARE" | "USABLE_AREA" | "PER_OWNER"; quorumType: "PERCENT_OF_TOTAL_WEIGHT" | "PERCENT_OF_OWNER_COUNT" | "NONE" }> = {}) {
  return prisma.votingRule.create({
    data: {
      zevId, name, quorumType: over.quorumType ?? "PERCENT_OF_TOTAL_WEIGHT", quorumPercent: "50",
      majorityType: "SIMPLE_OF_VOTES_CAST", weightMethod: over.weightMethod ?? "OWNERSHIP_SHARE",
    },
  });
}

describe("convertVotingRulesToPerOwner", () => {
  it("translates share/area rules to PER_OWNER and the quorum to a head count (same percent), auditing each rule", async () => {
    const f = await createFixture("conv-basic");
    const byShare = await legacyRule(f.zev.id, `Po udjelu ${f.t}`);
    const byArea = await legacyRule(f.zev.id, `Po površini ${f.t}`, { weightMethod: "USABLE_AREA", quorumType: "NONE" });
    const already = await legacyRule(f.zev.id, `Već ${f.t}`, { weightMethod: "PER_OWNER", quorumType: "PERCENT_OF_OWNER_COUNT" });

    const done = await convertVotingRulesToPerOwner({ zevId: f.zev.id });
    expect(done.map((d) => d.ruleId).sort()).toEqual([byShare.id, byArea.id].sort());

    const a = await prisma.votingRule.findUniqueOrThrow({ where: { id: byShare.id } });
    expect(a.weightMethod).toBe("PER_OWNER");
    expect(a.quorumType).toBe("PERCENT_OF_OWNER_COUNT");
    expect(a.quorumPercent?.toString()).toBe("50");
    expect(a.name).toBe(`Po udjelu ${f.t} (jedan vlasnik — jedan glas)`);
    const b = await prisma.votingRule.findUniqueOrThrow({ where: { id: byArea.id } });
    expect(b.weightMethod).toBe("PER_OWNER");
    expect(b.quorumType).toBe("NONE"); // untouched
    const untouched = await prisma.votingRule.findUniqueOrThrow({ where: { id: already.id } });
    expect(untouched.name).toBe(`Već ${f.t}`);

    const audits = await prisma.auditEvent.findMany({ where: { action: "voting_rule.convert", zevId: f.zev.id } });
    expect(audits).toHaveLength(2);
    const forA = audits.find((e) => e.targetId === byShare.id)!;
    expect((forA.before as { weightMethod: string }).weightMethod).toBe("OWNERSHIP_SHARE");
    expect((forA.after as { weightMethod: string }).weightMethod).toBe("PER_OWNER");
  });

  it("is idempotent: a second run changes nothing and writes no audit", async () => {
    const f = await createFixture("conv-idem");
    await legacyRule(f.zev.id, `Jednom ${f.t}`);
    expect(await convertVotingRulesToPerOwner({ zevId: f.zev.id })).toHaveLength(1);
    const snapshot = await prisma.votingRule.findMany({ where: { zevId: f.zev.id }, orderBy: { id: "asc" } });
    expect(await convertVotingRulesToPerOwner({ zevId: f.zev.id })).toHaveLength(0);
    expect(await prisma.votingRule.findMany({ where: { zevId: f.zev.id }, orderBy: { id: "asc" } })).toEqual(snapshot);
    expect(await prisma.auditEvent.count({ where: { action: "voting_rule.convert", zevId: f.zev.id } })).toBe(1);
  });

  it("--dry-run lists the rules but writes nothing", async () => {
    const f = await createFixture("conv-dry");
    const r = await legacyRule(f.zev.id, `Proba ${f.t}`);
    const listed = await convertVotingRulesToPerOwner({ zevId: f.zev.id, dryRun: true });
    expect(listed).toHaveLength(1);
    expect((await prisma.votingRule.findUniqueOrThrow({ where: { id: r.id } })).weightMethod).toBe("OWNERSHIP_SHARE");
    expect(await prisma.auditEvent.count({ where: { action: "voting_rule.convert", zevId: f.zev.id } })).toBe(0);
  });

  it("a closed proposal frozen with a pre-FR (share-weighted) snapshot gives the SAME result before and after the conversion", async () => {
    const f = await createFixture("conv-closed");
    const rule = await legacyRule(f.zev.id, `Zatvoreno ${f.t}`);
    const { proposal } = await createProposalFixture(f, { ruleId: rule.id });
    await openVoting(f.president, proposal.id);

    // Rewrite the freshly opened voting into what v2.42.0 would have frozen: weights by share (A 35 / B 50 / C 15)
    // and a share-weighted snapshot — emulating a proposal that was opened and closed before this version.
    const evs = await prisma.eligibleVoter.findMany({ where: { proposalId: proposal.id } });
    const share: Record<string, string> = { [f.ownerA.id]: "35", [f.ownerB.id]: "50", [f.ownerC.id]: "15" };
    for (const ev of evs) await prisma.eligibleVoter.update({ where: { id: ev.id }, data: { weight: share[ev.ownerId] } });
    await prisma.proposal.update({
      where: { id: proposal.id },
      data: {
        ruleSnapshot: {
          ruleName: rule.name, quorumType: "PERCENT_OF_TOTAL_WEIGHT", quorumPercent: "50",
          majorityType: "SIMPLE_OF_VOTES_CAST", majorityPercent: null, weightMethod: "OWNERSHIP_SHARE",
          totalEligibleWeight: "100.000000", totalEligibleOwners: 3,
        },
      },
    });
    for (const ev of evs) {
      await recordManualVote(f.president, { eligibleVoterId: ev.id, choice: ev.ownerId === f.ownerA.id ? "APPROVE" : "REJECT", channel: "PAPER" });
    }
    const { result: closed } = await closeVoting(f.president, proposal.id);
    const before = await computeProposalResult(f.zev.id, proposal.id);
    expect(closed.accepted).toBe(false); // 35 vs 65

    await convertVotingRulesToPerOwner({ zevId: f.zev.id });

    const after = await computeProposalResult(f.zev.id, proposal.id);
    expect(after.approveWeight.toFixed(6)).toBe(before.approveWeight.toFixed(6));
    expect(after.rejectWeight.toFixed(6)).toBe(before.rejectWeight.toFixed(6));
    expect(after.accepted).toBe(before.accepted);
    expect(after.quorumReached).toBe(before.quorumReached);
    const stored = await prisma.proposal.findUniqueOrThrow({ where: { id: proposal.id } });
    expect(stored.resultSummary).toMatchObject({ approveWeight: "35.000000", rejectWeight: "65.000000", accepted: false });
    expect((stored.ruleSnapshot as { weightMethod: string }).weightMethod).toBe("OWNERSHIP_SHARE"); // frozen, untouched
  });
});
