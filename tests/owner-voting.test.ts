// F4.5 — vlasnik u aplikaciji: gdje stoji na prijedlogu (`ownerVoteStates`, `getOwnerProposalView`) i kome da se obrati
// (`getVotingContact`). Izbor se vidi samo za sopstveni glas i glas punomoćnika u njegovo ime (F4-Q1 a); za zajednicu
// koja glasa preko predstavnika objekat uopšte nema ključ `choice` (K-03a).
import { describe, it, expect } from "vitest";
import { prisma } from "@/lib/prisma";
import type { Actor } from "@/server/auth/guards";
import {
  createFixture, createProposalFixture, openVotingWithLinks, createSessionFixture, openSessionBallots, ballotFor, uid,
  type Fixture,
} from "./helpers";
import {
  ownerVoteStates, getOwnerProposalView, getVotingContact, submitBallot, submitVote, correctVote, createProposal, createMeeting,
  type OwnerVoteState,
} from "@/server/services/meetings";
import { grantProxy, setOfficeTerm } from "@/server/services/ownership";

const actorFor = (f: Fixture, partyId: string | null): Actor => ({ userId: `u-${partyId ?? "none"}`, roles: ["OWNER"], partyId, zevId: f.zev.id });
const only = async (actor: Actor, proposalId: string): Promise<OwnerVoteState> => (await ownerVoteStates(actor, [proposalId])).get(proposalId)!;
const all = async (actor: Actor, proposalId: string) => (await getOwnerProposalView(actor, proposalId)).participations;

describe("ownerVoteStates — kinds", () => {
  it("draft, boardOnly, notInBase and closedNotVoted", async () => {
    const f = await createFixture("ov-kinds");
    // draft: voting not opened yet
    const draft = await createProposalFixture(f);
    expect(await only(f.actorA, draft.proposal.id)).toEqual({ kind: "draft" });
    // boardOnly: an owner who is not a board member on a board proposal
    const board = await createProposalFixture(f, { body: "BOARD" });
    expect(await only(f.actorA, board.proposal.id)).toEqual({ kind: "boardOnly" });
    // notInBase: B is outside the scope of the second proposal (only A's unit)
    const { meeting, proposals } = await createSessionFixture(f, 2, ["ALL", "A"]);
    await openSessionBallots(f, meeting.id);
    expect(await only(f.actorB, proposals[1].id)).toEqual({ kind: "notInBase" });
    expect((await only(f.actorB, proposals[0].id)).kind).toBe("canVote");
    // closedNotVoted: the proposal closed before B voted
    await prisma.proposal.update({ where: { id: proposals[0].id }, data: { status: "VOTING_CLOSED" } });
    expect(await only(f.actorB, proposals[0].id)).toEqual({ kind: "closedNotVoted" });
  });

  it("an account without a party is notInBase on an open proposal", async () => {
    const f = await createFixture("ov-nobody");
    const { meeting, proposals } = await createSessionFixture(f, 1);
    await openSessionBallots(f, meeting.id);
    expect(await only(actorFor(f, null), proposals[0].id)).toEqual({ kind: "notInBase" });
  });

  it("canVote with a ballot link, with a single link, and without a link when the ZEV has no e-mail for the owner", async () => {
    const f = await createFixture("ov-link");
    await prisma.party.update({ where: { id: f.ownerA.id }, data: { email: null } });
    const { meeting, proposals } = await createSessionFixture(f, 2);
    await openSessionBallots(f, meeting.id);
    const b = await only(f.actorB, proposals[0].id);
    expect(b).toMatchObject({ kind: "canVote", link: "ballot", linkActive: true, proxyName: null, forOwnerName: null });
    if (b.kind === "canVote") expect(b.closesAt).toBeInstanceOf(Date);
    expect(await only(f.actorA, proposals[0].id)).toMatchObject({ kind: "canVote", link: "none" });

    const g = await createFixture("ov-link-single");
    const { proposal } = await createProposalFixture(g);
    await openVotingWithLinks(g, proposal.id);
    expect(await only(g.actorA, proposal.id)).toMatchObject({ kind: "canVote", link: "single", linkActive: true });
    // a revoked token keeps its kind but is no longer active
    await prisma.approvalToken.updateMany({ where: { eligibleVoter: { proposalId: proposal.id, ownerId: g.ownerA.id } }, data: { status: "REVOKED" } });
    expect(await only(g.actorA, proposal.id)).toMatchObject({ kind: "canVote", link: "single", linkActive: false });
  });
});

describe("ownerVoteStates — voted", () => {
  it("shows the date, the receipt number (the vote id), the channel and, for his own vote, the choice", async () => {
    const f = await createFixture("ov-voted");
    const { meeting, proposals } = await createSessionFixture(f, 2);
    const a = ballotFor(await openSessionBallots(f, meeting.id), f.ownerA.email!);
    const res = await submitBallot({ tokenPlain: a.token, verificationCode: a.code, ack: true, choices: { [proposals[0].id]: "REJECT", [proposals[1].id]: "APPROVE" } });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const s = await only(f.actorA, proposals[0].id);
    expect(s).toMatchObject({ kind: "voted", choice: "REJECT", channel: "ELECTRONIC", viaProxyName: null, forOwnerName: null });
    if (s.kind === "voted") {
      expect(s.receiptNo).toBe(res.receipt.items.find((i) => i.proposalId === proposals[0].id)!.voteId);
      expect(s.at).toBeInstanceOf(Date);
    }
  });

  it("a corrected vote shows the effective vote", async () => {
    const f = await createFixture("ov-corrected");
    const { proposal } = await createProposalFixture(f);
    const links = await openVotingWithLinks(f, proposal.id);
    const a = links.find((l) => l.toAddress === f.ownerA.email)!;
    const sent = await submitVote({ tokenPlain: a.token, verificationCode: a.code, choice: "APPROVE" });
    if (!sent.ok) throw new Error("vote failed");
    await correctVote(f.president, { voteId: sent.receipt.voteId, choice: "REJECT", reason: "Greška u evidenciji", authority: "Odluka skupštine" });
    const s = await only(f.actorA, proposal.id);
    expect(s).toMatchObject({ kind: "voted", choice: "REJECT" });
    if (s.kind === "voted") expect(s.receiptNo).not.toBe(sent.receipt.voteId);
  });
});

describe("ownerVoteStates — proxy and community", () => {
  it("the grantor sees who votes for him; the proxy holder sees whom he votes for; after the vote both see it", async () => {
    const f = await createFixture("ov-proxy");
    await grantProxy(f.president, { grantorId: f.ownerA.id, holderId: f.ownerC.id, scope: "ALL", validFrom: new Date("2020-01-01") });
    const { meeting, proposals } = await createSessionFixture(f, 1);
    const links = await openSessionBallots(f, meeting.id);
    const actorC = actorFor(f, f.ownerC.id);

    const a = await only(f.actorA, proposals[0].id);
    expect(a).toMatchObject({ kind: "canVote", proxyName: expect.stringContaining("Cvijeta") });
    const c = await all(actorC, proposals[0].id);
    expect(c.some((s) => s.kind === "canVote" && s.forOwnerName?.includes("Ana"))).toBe(true);

    const cb = ballotFor(links, f.ownerC.email!);
    const res = await submitBallot({ tokenPlain: cb.token, verificationCode: cb.code, ack: true, choices: { [proposals[0].id]: "APPROVE" } });
    expect(res.ok).toBe(true);
    expect(await only(f.actorA, proposals[0].id)).toMatchObject({ kind: "voted", choice: "APPROVE", viaProxyName: expect.stringContaining("Cvijeta") });
    expect((await all(actorC, proposals[0].id)).some((s) => s.kind === "voted" && s.forOwnerName?.includes("Ana"))).toBe(true);
  });

  it("a co-owner who is not the representative sees viaRepresentative, and the state has no choice key", async () => {
    const f = await createFixture("ov-community");
    const closes = new Date(Date.now() + 7 * 86_400_000);
    const meeting = await createMeeting(f.president, { title: `Zajednica ${f.t}`, type: "REGULAR", eVoteClosesAt: closes });
    const proposal = await createProposal(f.president, {
      meetingId: meeting.id, code: uid("PZ"), title: "Samo u3", text: "Tekst.", scopeType: "UNITS", unitIds: [f.u3.id],
      votingRuleId: f.rule.id, votingClosesAt: closes,
    });
    const links = await openSessionBallots(f, meeting.id); // u3's community votes through C
    // B co-owns u3 but is not the representative
    const before = await only(f.actorB, proposal.id);
    expect(before).toMatchObject({ kind: "viaRepresentative", communityVoted: false, at: null });
    expect(before).not.toHaveProperty("choice");
    if (before.kind === "viaRepresentative") expect(before.representativeName).toContain("Cvijeta");

    const c = ballotFor(links, f.ownerC.email!);
    const res = await submitBallot({ tokenPlain: c.token, verificationCode: c.code, ack: true, choices: { [proposal.id]: "REJECT" } });
    expect(res.ok).toBe(true);
    const after = await only(f.actorB, proposal.id);
    expect(after).toMatchObject({ kind: "viaRepresentative", communityVoted: true });
    expect(after).not.toHaveProperty("choice");
    expect(JSON.stringify(after)).not.toContain("REJECT");
  });

  it("a session of three proposals is answered from one call (three entries, no per-proposal calls)", async () => {
    const f = await createFixture("ov-many");
    const { meeting, proposals } = await createSessionFixture(f, 3);
    await openSessionBallots(f, meeting.id);
    const states = await ownerVoteStates(f.actorB, proposals.map((p) => p.id));
    expect(states.size).toBe(3);
    expect([...states.values()].every((s) => s.kind === "canVote")).toBe(true);
    expect((await ownerVoteStates(f.actorB, [])).size).toBe(0);
  });
});

describe("getOwnerProposalView", () => {
  it("returns the proposal and only the viewer's own participation, never other voters or votes", async () => {
    const f = await createFixture("ov-view");
    const { meeting, proposals } = await createSessionFixture(f, 1);
    await openSessionBallots(f, meeting.id);
    const view = await getOwnerProposalView(f.actorB, proposals[0].id);
    expect(Object.keys(view).sort()).toEqual(["contact", "participations", "proposal"]);
    expect(view.proposal).not.toHaveProperty("eligibleVoters");
    expect(view.proposal).not.toHaveProperty("votes");
    expect(view.proposal.meeting.title).toBe(meeting.title);
    expect(view.participations.length).toBeGreaterThan(0);
    expect(JSON.stringify(view)).not.toContain(f.ownerA.email ?? "@@");
  });

  it("a proposal of another ZEV throws", async () => {
    const f = await createFixture("ov-view-a");
    const g = await createFixture("ov-view-b");
    const { proposal } = await createProposalFixture(g);
    await expect(getOwnerProposalView(f.actorA, proposal.id)).rejects.toThrow();
  });
});

describe("getVotingContact", () => {
  it("name, e-mail and phone of the current president; a closed term is not shown; no term gives null", async () => {
    const f = await createFixture("ov-contact");
    expect(await getVotingContact(f.actorA)).toBeNull();
    await prisma.party.update({ where: { id: f.presidentParty.id }, data: { phone: "+387 65 111 222" } });
    await setOfficeTerm(f.president, { role: "PRESIDENT", partyId: f.presidentParty.id, validFrom: new Date("2020-01-01") });
    const c = await getVotingContact(f.actorA);
    expect(c).toEqual({ name: expect.stringContaining("Predsjednik"), email: f.presidentParty.email, phone: "+387 65 111 222" });

    const g = await createFixture("ov-contact-closed");
    await prisma.officeTerm.create({ data: { zevId: g.zev.id, role: "PRESIDENT", partyId: g.presidentParty.id, validFrom: new Date("2019-01-01"), validTo: new Date("2020-01-01") } });
    expect(await getVotingContact(g.actorA)).toBeNull();
  });
});
