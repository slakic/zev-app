// Oblik kvoruma prisustva koji servis `getLiveMeetingState` vraća traci uživo (F6.3). Samo tip — izračunavanje je u
// `presenceQuorum` (src/server/engines/voting.ts), a prag u `quorumRequirement`, istom formulom kao rezultat glasanja.
type Head = { proposalId: string; proposalCode: string; acceptsEVotes: boolean };

export type LiveQuorum = Head &
  (
    | { kind: "NONE" }
    | { kind: "COUNT"; present: number; required: number; total: number; reached: boolean; missing: number }
    | { kind: "WEIGHT"; present: string; required: string; total: string; reached: boolean; missing: string }
  );
