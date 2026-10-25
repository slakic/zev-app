// v2.43.2: "Označi glasanje otvorenim" na sjednici otvara i glasanje za prijedloge u nacrtu
// (simetrično sa zatvaranjem). Režim uživo (bez opcije) ostaje kakav jeste.
import { describe, it, expect } from "vitest";
import { prisma } from "@/lib/prisma";
import { createFixture, createProposalFixture } from "./helpers";
import { advanceMeetingStatus, previewSessionVotingOpen } from "@/server/services/meetings";

describe("advanceMeetingStatus(VOTING_OPEN, { openDraftProposals })", () => {
  it("opens e-voting on every draft proposal of the session, then moves the session", async () => {
    const f = await createFixture("sess-open");
    const { meeting, proposal } = await createProposalFixture(f);

    const pre = await previewSessionVotingOpen(f.president, meeting.id);
    expect(pre.blocked).toBe(false);
    expect(pre.proposals.map((p) => p.id)).toEqual([proposal.id]);
    expect(pre.proposals[0].preview?.voters).toBeGreaterThan(0);

    await advanceMeetingStatus(f.president, meeting.id, "VOTING_OPEN", undefined, { openDraftProposals: true });

    expect((await prisma.meeting.findUniqueOrThrow({ where: { id: meeting.id } })).status).toBe("VOTING_OPEN");
    const p = await prisma.proposal.findUniqueOrThrow({ where: { id: proposal.id } });
    expect(p.status).toBe("VOTING_OPEN");
    expect(await prisma.eligibleVoter.count({ where: { proposalId: proposal.id } })).toBe(pre.proposals[0].preview!.voters);
    const ev = await prisma.auditEvent.findFirstOrThrow({ where: { action: "meeting.status", targetId: meeting.id }, orderBy: { createdAt: "desc" } });
    expect((ev.after as { autoOpenedProposalIds: string[] }).autoOpenedProposalIds).toEqual([proposal.id]);
  });

  it("without the option (live mode) only the session status changes", async () => {
    const f = await createFixture("sess-open-live");
    const { meeting, proposal } = await createProposalFixture(f);
    await advanceMeetingStatus(f.president, meeting.id, "VOTING_OPEN");
    expect((await prisma.meeting.findUniqueOrThrow({ where: { id: meeting.id } })).status).toBe("VOTING_OPEN");
    expect((await prisma.proposal.findUniqueOrThrow({ where: { id: proposal.id } })).status).toBe("DRAFT");
  });

  it("is blocked as a whole when a draft cannot be opened (register not established): nothing changes", async () => {
    const f = await createFixture("sess-open-blocked", { registerStatus: "REVIEW" });
    const { meeting, proposal } = await createProposalFixture(f);
    const pre = await previewSessionVotingOpen(f.president, meeting.id);
    expect(pre.blocked).toBe(true);
    expect(pre.proposals[0].errors.length).toBeGreaterThan(0);

    await expect(
      advanceMeetingStatus(f.president, meeting.id, "VOTING_OPEN", undefined, { openDraftProposals: true })
    ).rejects.toThrow(/Glasanje nije otvoreno/);
    expect((await prisma.meeting.findUniqueOrThrow({ where: { id: meeting.id } })).status).toBe("DRAFT");
    expect((await prisma.proposal.findUniqueOrThrow({ where: { id: proposal.id } })).status).toBe("DRAFT");
  });
});
