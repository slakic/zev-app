// F6.4 — an issue is approved by a decision (or explicitly within the president's authority); the link lives in the
// existing MaintenanceIssue.approvalProposalId column. Approving before the decision is adopted is allowed (P-Q2 (b)).
import { describe, it, expect } from "vitest";
import { prisma } from "@/lib/prisma";
import { createFixture, createProposalFixture, type Fixture } from "./helpers";
import { reportIssue, transitionIssue, getIssue, listApprovalProposals } from "@/server/services/maintenance";
import { openVoting, closeVoting } from "@/server/services/meetings";

async function triagedIssue(f: Fixture) {
  const issue = await reportIssue(f.president, { title: `Lift ${f.t}`, description: "Ne radi" });
  await transitionIssue(f.president, issue.id, "TRIAGED");
  return issue;
}

describe("maintenance approval ↔ decision (F6.4)", () => {
  it("a proposal of another ZEV is refused", async () => {
    const a: Fixture = await createFixture("ma-a");
    const b: Fixture = await createFixture("ma-b");
    const { proposal: foreign } = await createProposalFixture(b);
    const issue = await triagedIssue(a);
    await expect(transitionIssue(a.president, issue.id, "AUTHORIZATION_REQUIRED", { approvalProposalId: foreign.id })).rejects.toThrow();
    const after = await prisma.maintenanceIssue.findUniqueOrThrow({ where: { id: issue.id } });
    expect(after.status).toBe("TRIAGED");
    expect(after.approvalProposalId).toBeNull();
  });

  it("APPROVED without a decision or the authority option is refused", async () => {
    const f: Fixture = await createFixture("ma-none");
    const issue = await triagedIssue(f);
    await expect(transitionIssue(f.president, issue.id, "APPROVED")).rejects.toThrow(/odluku ili ovlašćenje/);
    expect((await prisma.maintenanceIssue.findUniqueOrThrow({ where: { id: issue.id } })).status).toBe("TRIAGED");
  });

  it("'within the president's authority' approves without a decision and says so in the status note", async () => {
    const f: Fixture = await createFixture("ma-auth");
    const issue = await triagedIssue(f);
    await transitionIssue(f.president, issue.id, "APPROVED", { withinAuthority: true });
    const events = await prisma.issueStatusEvent.findMany({ where: { issueId: issue.id, to: "APPROVED" } });
    expect(events[0].note).toContain("ovlašćenja");
    const audit = await prisma.auditEvent.findFirstOrThrow({ where: { action: "issue.transition", targetId: issue.id, after: { path: ["status"], equals: "APPROVED" } } });
    expect((audit.after as { approvalProposalId: string | null; withinAuthority?: boolean }).approvalProposalId).toBeNull();
    expect((audit.after as { withinAuthority?: boolean }).withinAuthority).toBe(true);
  });

  it("approving with a proposal that is still being voted on is allowed, is marked 'prije odluke', and the audit carries the proposal", async () => {
    const f: Fixture = await createFixture("ma-before");
    const { proposal } = await createProposalFixture(f);
    await openVoting(f.president, proposal.id);
    const issue = await triagedIssue(f);
    await transitionIssue(f.president, issue.id, "AUTHORIZATION_REQUIRED", { approvalProposalId: proposal.id });
    await transitionIssue(f.president, issue.id, "APPROVED");
    const after = await prisma.maintenanceIssue.findUniqueOrThrow({ where: { id: issue.id } });
    expect(after.status).toBe("APPROVED");
    expect(after.approvalProposalId).toBe(proposal.id);
    const ev = await prisma.issueStatusEvent.findFirstOrThrow({ where: { issueId: issue.id, to: "APPROVED" } });
    expect(ev.note).toContain("prije odluke");
    const audit = await prisma.auditEvent.findFirstOrThrow({ where: { action: "issue.transition", targetId: issue.id, after: { path: ["status"], equals: "APPROVED" } } });
    expect((audit.after as { approvalProposalId: string }).approvalProposalId).toBe(proposal.id);

    const detail = await getIssue(f.president, issue.id);
    expect(detail.approvalProposal).toMatchObject({ id: proposal.id, status: "VOTING_OPEN" });
  });

  it("an adopted decision approves without the 'before the decision' mark", async () => {
    const f: Fixture = await createFixture("ma-adopted");
    const { proposal } = await createProposalFixture(f);
    await openVoting(f.president, proposal.id);
    await closeVoting(f.president, proposal.id); // no votes -> no quorum -> REJECTED: cannot be used
    const issue = await triagedIssue(f);
    await expect(transitionIssue(f.president, issue.id, "APPROVED", { approvalProposalId: proposal.id })).rejects.toThrow();
    await prisma.proposal.update({ where: { id: proposal.id }, data: { status: "ACCEPTED" } });
    await transitionIssue(f.president, issue.id, "APPROVED", { approvalProposalId: proposal.id });
    const ev = await prisma.issueStatusEvent.findFirstOrThrow({ where: { issueId: issue.id, to: "APPROVED" } });
    expect(ev.note ?? "").not.toContain("prije odluke");
  });

  it("listApprovalProposals offers only open or adopted proposals of this ZEV", async () => {
    const f: Fixture = await createFixture("ma-list");
    const g: Fixture = await createFixture("ma-list-other");
    const { proposal: draft } = await createProposalFixture(f);
    const { proposal: open } = await createProposalFixture(f);
    await openVoting(f.president, open.id);
    const { proposal: foreign } = await createProposalFixture(g);
    await openVoting(g.president, foreign.id);
    const ids = (await listApprovalProposals(f.president)).map((p) => p.id);
    expect(ids).toContain(open.id);
    expect(ids).not.toContain(draft.id);
    expect(ids).not.toContain(foreign.id);
  });
});
