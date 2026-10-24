// F1.5-F1.6 (Plans/f1-sigurnost-novca-i-pravnih-koraka-plan.md): the counts the confirmation
// panels show must be the counts the irreversible step then produces.
import { describe, it, expect } from "vitest";
import { prisma } from "@/lib/prisma";
import { createFixture, createProposalFixture, type Fixture } from "./helpers";
import {
  createMeeting, advanceMeetingStatus, listInvitationRecipients, queueMeetingInvitations,
  previewVotingDelivery, openVoting, revokeToken, reissueToken,
} from "@/server/services/meetings";
import { grantProxy, setOfficeTerm, addBoardMember } from "@/server/services/ownership";
import { ForbiddenError } from "@/server/auth/guards";

const outboxCount = (template: string, relatedType: string, relatedId: string) =>
  prisma.notificationMessage.count({ where: { template, relatedType, relatedId } });

describe("listInvitationRecipients / queueMeetingInvitations", () => {
  it("ASSEMBLY: owners with a current stake and an e-mail, each once; owners without e-mail are only counted", async () => {
    const f: Fixture = await createFixture("inv-asm");
    // Owner with a current stake but no e-mail address, one with an ended stake, one inactive.
    const noMail = await prisma.party.create({ data: { zevId: f.zev.id, kind: "PERSON", firstName: "Bez", lastName: `Adrese-${f.t}` } });
    const former = await prisma.party.create({ data: { zevId: f.zev.id, kind: "PERSON", firstName: "Raniji", lastName: `Vlasnik-${f.t}`, email: `${f.t}-former@example.com` } });
    const inactive = await prisma.party.create({ data: { zevId: f.zev.id, kind: "PERSON", firstName: "Neaktivan", lastName: `Vlasnik-${f.t}`, email: `${f.t}-inactive@example.com`, active: false } });
    const stake = (ownerId: string, validTo: Date | null) =>
      prisma.ownershipStake.create({ data: { zevId: f.zev.id, unitId: f.u4.id, ownerId, sharePercent: "1", validFrom: new Date("2020-01-01"), validTo } });
    await stake(noMail.id, null);
    await stake(former.id, new Date("2021-01-01"));
    await stake(inactive.id, null);
    // ownerB co-owns two units (u2 and u3) — must still be listed once.

    const meeting = await createMeeting(f.president, { title: `Skupština ${f.t}`, type: "REGULAR", body: "ASSEMBLY" });
    const r = await listInvitationRecipients(f.president, meeting.id);
    const ids = r.withEmail.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.sort()).toEqual([f.ownerA.id, f.ownerB.id, f.ownerC.id].sort());
    expect(r.withoutEmailCount).toBe(1);

    await advanceMeetingStatus(f.president, meeting.id, "INVITATIONS_SENT");
    const q = await queueMeetingInvitations(f.president, meeting.id);
    expect(q.queued).toBe(r.withEmail.length);
    expect(q.withoutEmailCount).toBe(1);
    expect(await outboxCount("meeting-invitation", "Meeting", meeting.id)).toBe(r.withEmail.length);
  });

  it("BOARD: the president and the board members, without duplicates", async () => {
    const f: Fixture = await createFixture("inv-board");
    await setOfficeTerm(f.president, { role: "PRESIDENT", partyId: f.presidentParty.id, validFrom: new Date("2024-01-01") });
    await addBoardMember(f.president, { partyId: f.ownerA.id, validFrom: new Date("2024-01-01") });
    await addBoardMember(f.president, { partyId: f.ownerB.id, validFrom: new Date("2024-01-01") });
    await addBoardMember(f.president, { partyId: f.presidentParty.id, validFrom: new Date("2024-01-01") }); // also board member
    const meeting = await createMeeting(f.president, { title: `Odbor ${f.t}`, type: "REGULAR", body: "BOARD" });

    const r = await listInvitationRecipients(f.president, meeting.id);
    expect(r.withEmail.map((p) => p.id).sort()).toEqual([f.presidentParty.id, f.ownerA.id, f.ownerB.id].sort());
    expect(r.withoutEmailCount).toBe(0);

    await advanceMeetingStatus(f.president, meeting.id, "INVITATIONS_SENT");
    await queueMeetingInvitations(f.president, meeting.id);
    expect(await outboxCount("meeting-invitation", "Meeting", meeting.id)).toBe(3);
  });

  it("is PRESIDENT/ACCOUNTANT-only and tenant-scoped", async () => {
    const f: Fixture = await createFixture("inv-guard");
    const other: Fixture = await createFixture("inv-guard2");
    const meeting = await createMeeting(f.president, { title: `S ${f.t}`, type: "REGULAR" });
    await expect(listInvitationRecipients(f.actorA, meeting.id)).rejects.toThrow(ForbiddenError);
    await expect(listInvitationRecipients(other.president, meeting.id)).rejects.toThrow();
  });
});

describe("previewVotingDelivery(…, \"ALL\")", () => {
  it("equals what openVoting then really creates (tokens, approval-link messages, proxy deliveries), and creates nothing itself", async () => {
    const f: Fixture = await createFixture("pvd");
    const { proposal } = await createProposalFixture(f);
    // ownerB has no e-mail; ownerA is represented by ownerC (who has one).
    await prisma.party.update({ where: { id: f.ownerB.id }, data: { email: null } });
    await grantProxy(f.president, { grantorId: f.ownerA.id, holderId: f.ownerC.id, scope: "ALL", validFrom: new Date("2020-01-01") });

    const preview = await previewVotingDelivery(f.president, proposal.id, "ALL");
    expect(await prisma.approvalToken.count({ where: { eligibleVoter: { proposalId: proposal.id } } })).toBe(0);
    expect(await outboxCount("approval-link", "Proposal", proposal.id)).toBe(0);
    expect(preview).toEqual({ voters: 3, byEmail: 2, viaProxy: 1, withoutEmail: 1 });

    const deliveries = await openVoting(f.president, proposal.id);
    const tokens = await prisma.approvalToken.count({ where: { eligibleVoter: { proposalId: proposal.id } } });
    const messages = await outboxCount("approval-link", "Proposal", proposal.id);
    expect(tokens).toBe(preview.voters);
    expect(messages).toBe(preview.byEmail);
    expect(deliveries.filter((d) => d.email && d.viaProxy)).toHaveLength(preview.viaProxy);
    expect(deliveries.filter((d) => !d.email)).toHaveLength(preview.withoutEmail);

    // After opening it is no longer a preview-able draft.
    await expect(previewVotingDelivery(f.president, proposal.id, "ALL")).rejects.toThrow();
  });

  it("\"LIVE\" still delegates to previewLiveDelivery", async () => {
    const f: Fixture = await createFixture("pvd-live");
    const { proposal } = await createProposalFixture(f);
    const live = await previewVotingDelivery(f.president, proposal.id, "LIVE");
    expect(live.presentCount + live.deliverCount + live.noChannelCount).toBe(3);
  });

  it("is PRESIDENT/ACCOUNTANT-only", async () => {
    const f: Fixture = await createFixture("pvd-guard");
    const { proposal } = await createProposalFixture(f);
    await expect(previewVotingDelivery(f.actorA, proposal.id, "ALL")).rejects.toThrow(ForbiddenError);
  });
});

describe("revokeToken / reissueToken require a reason", () => {
  it("an empty or blank reason throws and leaves the token active; a real reason works", async () => {
    const f: Fixture = await createFixture("tok-reason");
    const { proposal } = await createProposalFixture(f);
    await openVoting(f.president, proposal.id);
    const [t1, t2] = await prisma.approvalToken.findMany({ where: { eligibleVoter: { proposalId: proposal.id } }, orderBy: { id: "asc" } });

    await expect(revokeToken(f.president, t1.id, "")).rejects.toThrow(/razlog/);
    await expect(reissueToken(f.president, t1.id, "   ")).rejects.toThrow(/razlog/);
    expect((await prisma.approvalToken.findUniqueOrThrow({ where: { id: t1.id } })).status).toBe("ACTIVE");

    await revokeToken(f.president, t1.id, "pogrešna adresa");
    expect((await prisma.approvalToken.findUniqueOrThrow({ where: { id: t1.id } })).status).toBe("REVOKED");
    const re = await reissueToken(f.president, t2.id, "izgubljen link");
    expect(re.newTokenId).toBeTruthy();
  });
});
