// Alati za vlasnike, Faza O-C (Plans/mcp-onboarding-asistent-plan.md §2, M4): udio sa dokazom, uklanjanje udjela,
// sporno vlasništvo i prijedlozi udjela bez dokaza. Pravilo „nema udjela bez dokaza” ostaje: `add_owner_stake` traži fajl
// (base64, isti formati i ista veličina kao prilog u aplikaciji), a vlasnik bez dokaza ide kao prijedlog
// (`add_stake_proposals`) kome klijent u koraku „Vlasnici” prilaže dokaz.
import { z } from "zod";
import { DraftAccessError } from "@/server/services/draftAccess";
import { DRAFT_BATCH_MAX, addDraftStake, addDraftStakeProposals, removeDraftStake, setUnitDisputed } from "@/server/services/onboarding";
import { t } from "@/lib/i18n";
import { partyChoice, partyInput } from "@/server/mcp/tools/onboarding/common";
import { writeTool } from "@/server/mcp/tools/onboarding/write";
import type { McpToolDef } from "@/server/mcp/tools/registry";

const key = z.string().min(1).max(100);
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Datum u obliku yyyy-mm-dd.");
const decimal = z.union([z.string().max(30), z.number()]).transform(String);
const one = () => 1;

/** Standardni base64 (sa ili bez `=` dopune); razmaci i prelomi redova se odbacuju prije provjere. */
function decodeProof(raw: string): Buffer {
  const s = raw.replace(/\s+/g, "");
  if (!s || !/^[A-Za-z0-9+/]+={0,2}$/.test(s)) throw new DraftAccessError(t("assistants.errors.proofInvalid"));
  return Buffer.from(s, "base64");
}

export const addOwnerStakeTool = writeTool({
  name: "add_owner_stake",
  title: "Dodaj vlasnika sa dokazom",
  description:
    "Upisuje vlasnika posebnog dijela (korak 8) sa dokazom o vlasništvu (izvod iz katastra, ugovor…): `proof.content_base64` je sadržaj fajla u base64 (PDF, JPG, PNG ili WEBP, najviše koliko i prilog u aplikaciji). Lice je postojeće (`party_key`) ili novo (`new_party`). Bez dokaza koristite add_stake_proposals.",
  input: {
    unit_key: key,
    ...partyInput,
    share_percent: decimal,
    valid_from: date,
    proof: z.object({
      filename: z.string().min(1).max(200),
      mime: z.enum(["application/pdf", "image/jpeg", "image/png", "image/webp"]),
      content_base64: z.string().min(1),
    }),
  },
  spec: {
    items: one,
    created: (d) => d.stakes.map((s) => ({ key: s.key, unitKey: s.unitKey, partyKey: s.partyKey })),
    run: async (access, _d, a) => ({
      version: await addDraftStake(
        access,
        a.expected_version,
        { ...partyChoice(a), unitKey: a.unit_key, sharePercent: a.share_percent, validFrom: a.valid_from },
        { buffer: decodeProof(a.proof.content_base64), filename: a.proof.filename, mime: a.proof.mime }
      ),
    }),
  },
});

export const removeOwnerStakeTool = writeTool({
  name: "remove_owner_stake",
  title: "Ukloni vlasnika",
  description: "Uklanja udio vlasnika iz nacrta (korak 8) zajedno sa njegovim dokazom. `key` je ključ udjela iz get_draft (`stakes`).",
  input: { key },
  destructive: true,
  spec: { items: one, run: async (access, _d, a) => ({ version: await removeDraftStake(access, a.expected_version, a.key) }) },
});

export const setUnitDisputedTool = writeTool({
  name: "set_unit_disputed",
  title: "Sporno vlasništvo",
  description:
    "Označava da je vlasništvo posebnog dijela u sporu i da će vlasnici biti upisani kasnije (`disputed: true`), ili skida tu oznaku (`false`). Korak 8.",
  input: { unit_key: key, disputed: z.boolean() },
  spec: { items: one, run: async (access, _d, a) => ({ version: await setUnitDisputed(access, a.expected_version, a.unit_key, a.disputed) }) },
});

export const addStakeProposalsTool = writeTool({
  name: "add_stake_proposals",
  title: "Prijedlozi vlasnika bez dokaza",
  description: `Upisuje vlasnike koje ste pročitali iz dokumenata, BEZ fajla dokaza, kao prijedloge (korak 8), do ${DRAFT_BATCH_MAX} u jednom pozivu. Prijedlog ne ulazi u zbirove ni u objavu: klijent u koraku „Vlasnici” prilaže dokaz i tek tada nastaje udio. Sve ili ništa, greške po rednom broju (\`issues\`).`,
  input: {
    proposals: z
      .array(z.object({ unit_key: key, ...partyInput, share_percent: decimal, valid_from: date }))
      .min(1)
      .max(DRAFT_BATCH_MAX),
  },
  spec: {
    items: (a) => a.proposals.length,
    created: (d) => d.stakeProposals.map((p) => ({ key: p.key, unitKey: p.unitKey, partyKey: p.partyKey })),
    run: async (access, _d, a) => ({
      version: await addDraftStakeProposals(
        access,
        a.expected_version,
        a.proposals.map((p) => ({ ...partyChoice(p), unitKey: p.unit_key, sharePercent: p.share_percent, validFrom: p.valid_from }))
      ),
    }),
  },
});

export const OWNER_TOOLS: McpToolDef[] = [addOwnerStakeTool, removeOwnerStakeTool, setUnitDisputedTool, addStakeProposalsTool];
