// Pure voting engine: quorum, voting weight and majority calculation.
// No hard-coded legal rule — every proposal carries a frozen RuleSnapshot.
import { Decimal, dec, ZERO } from "@/lib/money";
import type { QuorumType, MajorityType, WeightMethod, VoteChoice } from "@/generated/prisma/client";

export type RuleSnapshot = {
  ruleName: string | null;
  quorumType: QuorumType;
  quorumPercent: string | null; // decimal string
  majorityType: MajorityType;
  majorityPercent: string | null;
  weightMethod: WeightMethod;
  /** Total weight of the eligible voting base at freeze time. */
  totalEligibleWeight: string;
  /** Number of eligible owners at freeze time. */
  totalEligibleOwners: number;
};

export type CountedVote = {
  eligibleVoterId: string;
  choice: VoteChoice;
  weight: Decimal;
  countsForQuorum: boolean;
  invalid: boolean;
};

export type VotingResult = {
  totalEligibleWeight: Decimal;
  totalEligibleOwners: number;
  votesCast: number;
  weightCast: Decimal;
  quorumRequiredWeight: Decimal | null;
  quorumRequiredOwners: number | null;
  quorumReached: boolean;
  approveWeight: Decimal;
  rejectWeight: Decimal;
  abstainWeight: Decimal;
  invalidCount: number;
  majorityThreshold: Decimal;
  accepted: boolean;
};

/** Weight of one owner under a weight method, from their eligible-voter basis. */
export function computeVoterWeight(
  method: WeightMethod,
  basis: { ownershipShareSum: Decimal; areaSum: Decimal }
): Decimal {
  switch (method) {
    case "PER_OWNER":
      return dec(1);
    case "OWNERSHIP_SHARE":
      return basis.ownershipShareSum;
    case "USABLE_AREA":
      return basis.areaSum;
  }
}

/**
 * Compute the outcome of a proposal from its rule snapshot and valid votes.
 * Corrected votes must already be excluded by the caller (a corrected vote is
 * superseded by its correction row).
 */
export function computeVotingResult(rule: RuleSnapshot, votes: CountedVote[]): VotingResult {
  const valid = votes.filter((v) => !v.invalid);
  const totalWeight = dec(rule.totalEligibleWeight);
  const totalOwners = rule.totalEligibleOwners;

  const weightCast = valid.reduce((a, v) => a.plus(v.weight), ZERO);
  const quorumWeight = valid
    .filter((v) => v.countsForQuorum)
    .reduce((a, v) => a.plus(v.weight), ZERO);
  const quorumVoterCount = valid.filter((v) => v.countsForQuorum).length;

  let quorumReached = true;
  let quorumRequiredWeight: Decimal | null = null;
  let quorumRequiredOwners: number | null = null;
  if (rule.quorumType === "PERCENT_OF_TOTAL_WEIGHT") {
    const pct = dec(rule.quorumPercent ?? "0").div(100);
    quorumRequiredWeight = totalWeight.mul(pct);
    quorumReached = quorumWeight.greaterThanOrEqualTo(quorumRequiredWeight);
  } else if (rule.quorumType === "PERCENT_OF_OWNER_COUNT") {
    const pct = dec(rule.quorumPercent ?? "0").div(100);
    quorumRequiredOwners = dec(totalOwners).mul(pct).toDecimalPlaces(6).ceil().toNumber();
    quorumReached = quorumVoterCount >= quorumRequiredOwners;
  }

  const approveWeight = valid
    .filter((v) => v.choice === "APPROVE")
    .reduce((a, v) => a.plus(v.weight), ZERO);
  const rejectWeight = valid
    .filter((v) => v.choice === "REJECT")
    .reduce((a, v) => a.plus(v.weight), ZERO);
  const abstainWeight = valid
    .filter((v) => v.choice === "ABSTAIN")
    .reduce((a, v) => a.plus(v.weight), ZERO);

  let majorityThreshold: Decimal;
  switch (rule.majorityType) {
    case "SIMPLE_OF_VOTES_CAST": {
      // strictly more approve than reject (abstentions do not count either way)
      majorityThreshold = rejectWeight;
      break;
    }
    case "PERCENT_OF_VOTES_CAST": {
      const pct = dec(rule.majorityPercent ?? "50").div(100);
      const decisive = approveWeight.plus(rejectWeight).plus(abstainWeight);
      majorityThreshold = decisive.mul(pct);
      break;
    }
    case "PERCENT_OF_ELIGIBLE_WEIGHT": {
      const pct = dec(rule.majorityPercent ?? "50").div(100);
      majorityThreshold = totalWeight.mul(pct);
      break;
    }
  }

  let accepted: boolean;
  if (rule.majorityType === "SIMPLE_OF_VOTES_CAST") {
    accepted = approveWeight.greaterThan(rejectWeight);
  } else {
    accepted = approveWeight.greaterThan(majorityThreshold);
  }
  if (!quorumReached) accepted = false;

  return {
    totalEligibleWeight: totalWeight,
    totalEligibleOwners: totalOwners,
    votesCast: valid.length,
    weightCast,
    quorumRequiredWeight,
    quorumRequiredOwners,
    quorumReached,
    approveWeight,
    rejectWeight,
    abstainWeight,
    invalidCount: votes.length - valid.length,
    majorityThreshold,
    accepted,
  };
}

export function serializeResult(r: VotingResult) {
  return {
    totalEligibleWeight: r.totalEligibleWeight.toFixed(6),
    totalEligibleOwners: r.totalEligibleOwners,
    votesCast: r.votesCast,
    weightCast: r.weightCast.toFixed(6),
    quorumRequiredWeight: r.quorumRequiredWeight?.toFixed(6) ?? null,
    quorumRequiredOwners: r.quorumRequiredOwners,
    quorumReached: r.quorumReached,
    approveWeight: r.approveWeight.toFixed(6),
    rejectWeight: r.rejectWeight.toFixed(6),
    abstainWeight: r.abstainWeight.toFixed(6),
    invalidCount: r.invalidCount,
    majorityThreshold: r.majorityThreshold.toFixed(6),
    accepted: r.accepted,
  };
}
