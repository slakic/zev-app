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
  /** FR (K-03): "ASSEMBLY_SUBJECTS" = one vote per voting subject (etazni vlasnik / suvlasnicka zajednica). */
  basisKind?: "ASSEMBLY_SUBJECTS";
  /** FR: the version of the unit register the base was taken from. */
  unitRegisterVersion?: number | null;
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
 * The quorum threshold of a rule against a voting base — the ONE formula shared by the voting result
 * (`computeVotingResult`) and the live-meeting presence bar (`presenceQuorum`, F6.3), so the two can never
 * disagree about what "quorum" requires. `requiredWeight` is set for a weight quorum, `requiredOwners` (rounded
 * up) for an owner-count quorum, both null for `NONE`.
 */
export function quorumRequirement(
  rule: { quorumType: QuorumType; quorumPercent: string | null },
  totals: { totalEligibleWeight: Decimal | string; totalEligibleOwners: number }
): { requiredWeight: Decimal | null; requiredOwners: number | null } {
  if (rule.quorumType === "PERCENT_OF_TOTAL_WEIGHT") {
    const pct = dec(rule.quorumPercent ?? "0").div(100);
    return { requiredWeight: dec(totals.totalEligibleWeight).mul(pct), requiredOwners: null };
  }
  if (rule.quorumType === "PERCENT_OF_OWNER_COUNT") {
    const pct = dec(rule.quorumPercent ?? "0").div(100);
    return { requiredWeight: null, requiredOwners: dec(totals.totalEligibleOwners).mul(pct).toDecimalPlaces(6).ceil().toNumber() };
  }
  return { requiredWeight: null, requiredOwners: null };
}

/** How the live bar reads the quorum: by presence in the room (not by cast votes — e-votes of people who are
 *  not in the room are counted by the voting result, not here). */
export type PresenceQuorum =
  | { kind: "NONE" }
  | { kind: "COUNT"; present: number; required: number; total: number; reached: boolean; missing: number }
  | { kind: "WEIGHT"; presentWeight: Decimal; requiredWeight: Decimal; totalWeight: Decimal; reached: boolean; missingWeight: Decimal };

/** Presence-based quorum for the live bar: owner-count quorum compares the number of present subjects with the
 *  (rounded-up) requirement; weight quorum compares the weight of the present subjects. */
export function presenceQuorum(
  rule: { quorumType: QuorumType; quorumPercent: string | null },
  totals: { totalEligibleWeight: Decimal | string; totalEligibleOwners: number },
  present: { count: number; weight: Decimal }
): PresenceQuorum {
  const req = quorumRequirement(rule, totals);
  if (req.requiredWeight) {
    const missing = req.requiredWeight.minus(present.weight);
    return {
      kind: "WEIGHT",
      presentWeight: present.weight,
      requiredWeight: req.requiredWeight,
      totalWeight: dec(totals.totalEligibleWeight),
      reached: present.weight.greaterThanOrEqualTo(req.requiredWeight),
      missingWeight: missing.isNegative() ? ZERO : missing,
    };
  }
  if (req.requiredOwners !== null) {
    return {
      kind: "COUNT",
      present: present.count,
      required: req.requiredOwners,
      total: totals.totalEligibleOwners,
      reached: present.count >= req.requiredOwners,
      missing: Math.max(0, req.requiredOwners - present.count),
    };
  }
  return { kind: "NONE" };
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

  const req = quorumRequirement(rule, { totalEligibleWeight: totalWeight, totalEligibleOwners: totalOwners });
  const quorumRequiredWeight = req.requiredWeight;
  const quorumRequiredOwners = req.requiredOwners;
  let quorumReached = true;
  if (quorumRequiredWeight) quorumReached = quorumWeight.greaterThanOrEqualTo(quorumRequiredWeight);
  else if (quorumRequiredOwners !== null) quorumReached = quorumVoterCount >= quorumRequiredOwners;

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
