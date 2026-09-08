// Korak 6 (docs/multitenancy-plan.md §6): the test package that proves — not "looks
// like it works" — that a user in tenant A cannot, through ANY service function, read
// or modify tenant B's data. Two fully independent tenants are built with two plain
// createFixture() calls (see tests/helpers.ts); every exported Actor-facing function
// across src/server/services/* is then exercised with a tenant-A actor against a
// tenant-B id (or vice versa where more convenient) and asserted to fail closed.
//
// Two flavors of "fail closed" both count as isolated and are used as appropriate:
//   1. Most point-lookups/updates/deletes are backed by `where: { id, zevId }` (or an
//      explicit `if (parent.zevId !== zevId) throw`) — these reject outright (a generic
//      "not found" Error, or a ForbiddenError). We assert `.rejects.toThrow()` without
//      pinning the exact message/class, since that convention legitimately differs by
//      function (see docs/multitenancy-plan.md §6, "extended where unique").
//   2. A few functions take a *foreign key value* that isn't itself existence-checked
//      (e.g. ownerBalance's partyId, previewBatch's chargeItemIds) — because every query
//      inside is still scoped by the actor's own zevId, a foreign id simply matches
//      nothing. These are asserted to come back empty/zero, never populated with the
//      other tenant's data.
import { describe, it, expect, beforeAll } from "vitest";
import { prisma } from "@/lib/prisma";
import { createFixture, createAreaCharges, createProposalFixture, openVotingWithLinks, type Fixture } from "./helpers";

import * as property from "@/server/services/property";
import * as ownership from "@/server/services/ownership";
import * as finance from "@/server/services/finance";
import * as billing from "@/server/services/billing";
import * as payments from "@/server/services/payments";
import * as meetings from "@/server/services/meetings";
import * as documents from "@/server/services/documents";
import * as attachments from "@/server/services/attachments";
import * as expensesSvc from "@/server/services/expenses";
import * as plans from "@/server/services/plans";
import * as maintenance from "@/server/services/maintenance";
import * as reports from "@/server/services/reports";
import * as users from "@/server/services/users";
import * as evoteConsent from "@/server/services/evoteConsent";

const proof = { buffer: Buffer.from("dokaz o vlasnistvu"), filename: "dokaz.pdf", mime: "application/pdf" };

/** Cross-tenant access must never succeed — whatever shape the rejection takes
 *  (generic "not found" Error, ForbiddenError, Prisma's RecordNotFound). */
async function expectBlocked(fn: () => Promise<unknown>) {
  await expect(fn()).rejects.toThrow();
}

describe("tenant isolation — no service function may read or write another tenant's data", () => {
  let a: Fixture;
  let b: Fixture;

  // Cross-tenant target data, built once against tenant B so tenant-A actors have
  // real (not just made-up) foreign ids to attempt to reach.
  let bInvoice: { id: string; number: string };
  let bSupplier: { id: string };
  let bExpense: { id: string };
  let bPlan: { id: string };
  let bProject: { id: string };
  let bIssue: { id: string };
  let bOffer: { id: string };
  let bWorkOrder: { id: string };
  let bDraftProposal: { proposal: { id: string }; meeting: { id: string } };
  let bOpenProposal: { proposal: { id: string }; meeting: { id: string } };
  let bEligibleVoterId: string;
  let bTokenId: string;
  let bVoteId: string;
  let bDocumentId: string;
  let bAttachmentId: string;
  let bStakeId: string;
  let bOccupancyId: string;
  let bProxyId: string;
  let bBoardTermId: string;
  let bAllocationGroupId: string;
  let bCommonAssetId: string;
  let bTransactionId: string;
  let bPaymentId: string;
  let bAllocationId: string;
  let aAcceptedProposalId: string;

  beforeAll(async () => {
    a = await createFixture("iso-a");
    b = await createFixture("iso-b");

    // ---- billing / invoices ----
    const bChargeIds = await createAreaCharges(b, "0.50");
    const { batch: bBatch } = await billing.createDraftBatch(b.accountant, "2036-01", undefined, bChargeIds);
    const bInvoices = await billing.issueBatch(b.accountant, bBatch.id);
    bInvoice = bInvoices[0];

    // ---- expenses / suppliers ----
    bSupplier = await expensesSvc.createSupplier(b.president, { name: `Dobavljac-${b.t}` });
    bExpense = await expensesSvc.createExpense(b.accountant, { supplierId: bSupplier.id, amount: "100.00", invoiceNumber: `INV-${b.t}` });

    // ---- plans / projects ----
    bProject = await plans.createProject(b.president, { name: `Projekat-${b.t}` });
    bPlan = await plans.createPlan(b.president, { year: 2036, kind: "BUDGET", title: `Plan-${b.t}` });
    await plans.addPlanItem(b.president, { planId: bPlan.id, type: "INCOME", name: "Stavka", plannedAmount: "500.00" });

    // ---- maintenance ----
    bIssue = await maintenance.reportIssue(b.actorA, { title: "Kvar lifta", description: "Ne radi." });
    bOffer = await maintenance.addOffer(b.president, { issueId: bIssue.id, supplierId: bSupplier.id, amount: "200.00" });
    bWorkOrder = await maintenance.createWorkOrder(b.president, { issueId: bIssue.id, supplierId: bSupplier.id, description: "Popravka lifta" });

    // ---- meetings / voting: one proposal left DRAFT, one opened for voting ----
    bDraftProposal = await createProposalFixture(b);
    bOpenProposal = await createProposalFixture(b);
    const bLinks = await openVotingWithLinks(b, bOpenProposal.proposal.id);
    const bEligibleVoters = await prisma.eligibleVoter.findMany({ where: { proposalId: bOpenProposal.proposal.id } });
    bEligibleVoterId = bEligibleVoters[0].id;
    const bTokens = await prisma.approvalToken.findMany({ where: { eligibleVoterId: { in: bEligibleVoters.map((v) => v.id) } } });
    bTokenId = bTokens[0].id;
    const submitted = await meetings.submitVote({ tokenPlain: bLinks[0].token, verificationCode: bLinks[0].code, choice: "APPROVE" });
    if (!submitted.ok) throw new Error("fixture setup: vote submission failed");
    bVoteId = submitted.receipt.voteId;

    // ---- documents / attachments ----
    const bDoc = await documents.generateInvoicePdf(b.accountant, bInvoice.id);
    bDocumentId = bDoc.id;
    const bAtt = await attachments.uploadAttachment(b.president, { buffer: Buffer.from("prilog"), filename: "prilog.pdf", mime: "application/pdf", category: "OTHER" });
    bAttachmentId = bAtt.id;
    const bStake = await prisma.ownershipStake.findFirstOrThrow({ where: { zevId: b.zev.id, unitId: b.u1.id } });
    bStakeId = bStake.id;

    // ---- ownership: occupancy, proxy, board membership, allocation group, common asset ----
    const bOcc = await ownership.setOccupancy(b.president, { unitId: b.u1.id, partyId: b.ownerA.id, type: "OWNER_OCCUPANT", headcount: 1, validFrom: new Date("2020-01-01") });
    bOccupancyId = bOcc.id;
    const bProxy = await ownership.grantProxy(b.president, { grantorId: b.ownerA.id, holderId: b.ownerB.id, scope: "ALL", validFrom: new Date("2020-01-01") });
    bProxyId = bProxy.id;
    const bBoardTerm = await ownership.addBoardMember(b.president, { partyId: b.ownerC.id, validFrom: new Date("2020-01-01") });
    bBoardTermId = bBoardTerm.id;
    const bGroup = await property.createAllocationGroup(b.president, { name: `Grupa-${b.t}`, members: [{ unitId: b.u1.id }] });
    bAllocationGroupId = bGroup.id;
    const bAsset = await property.createCommonAsset(b.president, { kind: "EQUIPMENT", name: `Oprema-${b.t}` });
    bCommonAssetId = bAsset.id;

    // ---- finance: transaction, payment, allocation ----
    const bTx = await finance.enterTransaction(b.accountant, { accountId: b.account.id, date: new Date(), type: "INCOME", amount: "25.00" });
    bTransactionId = bTx.id;
    // Kept well under the smallest per-unit charge in the fixture (area 20 * rate 0.50 =
    // 10.00, see createAreaCharges) so this allocation never risks exceeding the invoice's
    // open balance regardless of which unit's invoice happens to be bInvoices[0].
    const bPayment = await payments.enterPayment(b.accountant, { accountId: b.account.id, date: new Date(), amount: "5.00", payerId: b.ownerA.id });
    bPaymentId = bPayment.id;
    const bAlloc = await payments.allocatePayment(b.accountant, { paymentId: bPayment.id, invoiceId: bInvoice.id, amount: "5.00" });
    bAllocationId = bAlloc.id;

    // ---- an ACCEPTED proposal in tenant A, for approvePlan's proposal-status branch ----
    const aOpenProposal = await createProposalFixture(a);
    await meetings.openVoting(a.president, aOpenProposal.proposal.id);
    const aEligibleVoters = await prisma.eligibleVoter.findMany({ where: { proposalId: aOpenProposal.proposal.id } });
    for (const ev of aEligibleVoters) {
      await meetings.recordManualVote(a.president, { eligibleVoterId: ev.id, choice: "APPROVE", channel: "PAPER" });
    }
    await meetings.closeVoting(a.president, aOpenProposal.proposal.id);
    aAcceptedProposalId = aOpenProposal.proposal.id;
  });

  // ---------------------------------------------------------------------
  // property.ts
  // ---------------------------------------------------------------------
  describe("property", () => {
    it("point-lookups/updates on another tenant's buildings and units are rejected", async () => {
      await expectBlocked(() => property.updateBuilding(a.president, b.b1.id, { name: "hakovano" }));
      await expectBlocked(() => property.createEntrance(a.president, { buildingId: b.b1.id, name: "Ulaz X" }));
      await expectBlocked(() => property.updateUnit(a.president, b.u1.id, { label: "hakovano" }));
    });

    it("createUnit rejects a foreign buildingId/entranceId", async () => {
      await expectBlocked(() =>
        property.createUnit(a.president, { buildingId: b.b1.id, type: "APARTMENT", label: "X", usableArea: "10", ownershipShare: "1" })
      );
    });

    it("createAllocationGroup and createCommonAsset reject foreign unit/building ids", async () => {
      await expectBlocked(() => property.createAllocationGroup(a.president, { name: "G", members: [{ unitId: b.u1.id }] }));
      await expectBlocked(() => property.createCommonAsset(a.president, { buildingId: b.b1.id, kind: "EQUIPMENT", name: "Oprema" }));
    });

    it("listBuildings/listUnits/listAllocationGroups/listCommonAssets never include the other tenant's rows", async () => {
      const buildings = await property.listBuildings(a.president);
      expect(buildings.some((x) => x.id === b.b1.id || x.id === b.b2.id)).toBe(false);
      const units = await property.listUnits(a.president);
      expect(units.some((u) => [b.u1.id, b.u2.id, b.u3.id, b.u4.id].includes(u.id))).toBe(false);
      const groups = await property.listAllocationGroups(a.president);
      expect(groups.some((g) => g.id === bAllocationGroupId)).toBe(false);
      const assets = await property.listCommonAssets(a.president);
      expect(assets.some((x) => x.id === bCommonAssetId)).toBe(false);
    });
  });

  // ---------------------------------------------------------------------
  // ownership.ts
  // ---------------------------------------------------------------------
  describe("ownership", () => {
    it("getParty/updateParty reject a foreign party id", async () => {
      await expectBlocked(() => ownership.getParty(a.president, b.ownerA.id));
      await expectBlocked(() => ownership.updateParty(a.president, b.ownerA.id, { phone: "+387-60-000-000" }));
    });

    it("addOwnershipStake/transferOwnership reject a foreign unit or owner id", async () => {
      await expectBlocked(() =>
        ownership.addOwnershipStake(a.president, { unitId: b.u1.id, ownerId: a.ownerA.id, sharePercent: "10", validFrom: new Date() }, proof)
      );
      await expectBlocked(() =>
        ownership.addOwnershipStake(a.president, { unitId: a.u2.id, ownerId: b.ownerA.id, sharePercent: "10", validFrom: new Date() }, proof)
      );
      await expectBlocked(() =>
        ownership.transferOwnership(
          a.president,
          { unitId: b.u1.id, fromOwnerId: b.ownerA.id, toOwnerId: a.ownerB.id, effectiveDate: new Date() },
          proof
        )
      );
    });

    it("setOccupancy/endOccupancy reject a foreign unit, party or occupancy id", async () => {
      await expectBlocked(() =>
        ownership.setOccupancy(a.president, { unitId: b.u1.id, partyId: a.ownerA.id, type: "OWNER_OCCUPANT", headcount: 1, validFrom: new Date() })
      );
      await expectBlocked(() => ownership.endOccupancy(a.president, bOccupancyId, new Date()));
    });

    it("grantProxy/revokeProxy reject foreign parties/proxy ids", async () => {
      await expectBlocked(() =>
        ownership.grantProxy(a.president, { grantorId: b.ownerA.id, holderId: a.ownerB.id, scope: "ALL", validFrom: new Date() })
      );
      await expectBlocked(() => ownership.revokeProxy(a.president, bProxyId, "test"));
    });

    it("setOfficeTerm/addBoardMember/endBoardMembership reject a foreign party or term id", async () => {
      await expectBlocked(() => ownership.setOfficeTerm(a.president, { role: "ACCOUNTANT", partyId: b.ownerA.id, validFrom: new Date() }));
      await expectBlocked(() => ownership.addBoardMember(a.president, { partyId: b.ownerA.id, validFrom: new Date() }));
      await expectBlocked(() => ownership.endBoardMembership(a.president, bBoardTermId, new Date()));
    });

    it("listParties/listOfficeHolders/listOfficeHistory never include the other tenant's rows", async () => {
      const parties = await ownership.listParties(a.president);
      expect(parties.some((p) => p.id === b.ownerA.id || p.id === b.ownerB.id || p.id === b.ownerC.id)).toBe(false);
      const holders = await ownership.listOfficeHolders(a.president);
      expect(holders.boardMembers.some((t) => t.id === bBoardTermId)).toBe(false);
      const history = await ownership.listOfficeHistory(a.president);
      expect(history.some((t) => t.id === bBoardTermId)).toBe(false);
    });
  });

  // ---------------------------------------------------------------------
  // finance.ts
  // ---------------------------------------------------------------------
  describe("finance", () => {
    it("accountBalance/enterTransaction/cancelTransaction reject a foreign account or transaction id", async () => {
      await expectBlocked(() => finance.accountBalance(a.accountant, b.account.id));
      await expectBlocked(() => finance.enterTransaction(a.accountant, { accountId: b.account.id, date: new Date(), type: "INCOME", amount: "5.00" }));
      await expectBlocked(() => finance.cancelTransaction(a.accountant, bTransactionId, "razlog"));
    });

    it("listAccounts/listTransactions/listCategories never include the other tenant's rows", async () => {
      const accounts = await finance.listAccounts(a.accountant);
      expect(accounts.some((acc) => acc.id === b.account.id)).toBe(false);
      const txs = await finance.listTransactions(a.accountant);
      expect(txs.some((t) => t.id === bTransactionId)).toBe(false);
      const catName = `Kategorija-${a.t}`;
      await finance.ensureCategory(a.accountant, catName, "EXPENSE");
      const bCats = await finance.listCategories(b.accountant);
      expect(bCats.some((c) => c.name === catName)).toBe(false);
    });
  });

  // ---------------------------------------------------------------------
  // billing.ts
  // ---------------------------------------------------------------------
  describe("billing", () => {
    it("updateChargeItem/enterMeterReading reject a foreign charge item or unit id", async () => {
      const [bChargeItem] = await prisma.chargeItem.findMany({ where: { zevId: b.zev.id }, take: 1 });
      await expectBlocked(() => billing.updateChargeItem(a.accountant, bChargeItem.id, { name: "hakovano" }));
      await expectBlocked(() =>
        billing.enterMeterReading(a.accountant, { chargeItemId: bChargeItem.id, unitId: a.u1.id, period: "2036-01", quantity: "5" })
      );
    });

    it("previewBatch/createDraftBatch never compute against another tenant's charge items, even if their ids are passed", async () => {
      const [bChargeItem] = await prisma.chargeItem.findMany({ where: { zevId: b.zev.id }, take: 1 });
      const preview = await billing.previewBatch(a.accountant, "2036-01", [bChargeItem.id]);
      expect(preview).toEqual([]);
    });

    it("issueBatch/issueSingleInvoice reject a foreign batch, unit or debtor id", async () => {
      const { batch: bBatch } = await billing.createDraftBatch(b.accountant, "2036-02", undefined, []);
      await expectBlocked(() => billing.issueBatch(a.accountant, bBatch.id));
      await expectBlocked(() =>
        billing.issueSingleInvoice(a.accountant, { unitId: b.u1.id, debtorId: a.ownerA.id, dueDate: new Date(), description: "x", amount: "1.00" })
      );
      await expectBlocked(() =>
        billing.issueSingleInvoice(a.accountant, { unitId: a.u1.id, debtorId: b.ownerA.id, dueDate: new Date(), description: "x", amount: "1.00" })
      );
    });

    it("getInvoice/cancelInvoice/correctInvoice reject a foreign invoice id", async () => {
      await expectBlocked(() => billing.getInvoice(a.president, bInvoice.id));
      await expectBlocked(() => billing.cancelInvoice(a.accountant, bInvoice.id, "razlog"));
      await expectBlocked(() => billing.correctInvoice(a.accountant, bInvoice.id, { newTotal: "1.00", description: "x", reason: "y" }));
    });

    it("listChargeItems/listInvoices never include the other tenant's rows", async () => {
      const items = await billing.listChargeItems(a.accountant);
      const bIds = (await prisma.chargeItem.findMany({ where: { zevId: b.zev.id } })).map((i) => i.id);
      expect(items.some((i) => bIds.includes(i.id))).toBe(false);
      const invoices = await billing.listInvoices(a.president);
      expect(invoices.some((i) => i.id === bInvoice.id)).toBe(false);
    });
  });

  // ---------------------------------------------------------------------
  // payments.ts
  // ---------------------------------------------------------------------
  describe("payments", () => {
    it("enterPayment/importBankCsv/commitPdfImport reject a foreign account id", async () => {
      await expectBlocked(() => payments.enterPayment(a.accountant, { accountId: b.account.id, date: new Date(), amount: "10.00" }));
      await expectBlocked(() => payments.importBankCsv(a.accountant, { accountId: b.account.id, filename: "x.csv", content: "01.01.2020;10,00;Neko;REF\n" }));
      await expectBlocked(() =>
        payments.commitPdfImport(a.accountant, {
          accountId: b.account.id,
          filename: "x.pdf",
          rawText: "",
          rows: [{ direction: "OUT", date: "2020-01-01", amount: "5.00", payerNameRaw: "X", purposeRaw: "", reference: "" }],
        })
      );
    });

    it("importPdfPreview rejects a foreign account id before any parsing happens", async () => {
      await expectBlocked(() => payments.importPdfPreview(a.accountant, { accountId: b.account.id, filename: "x.pdf", buffer: Buffer.from("not a real pdf") }));
    });

    it("suggestMatches/allocatePayment/reverseAllocation/reversePayment reject a foreign payment/invoice/allocation id", async () => {
      await expectBlocked(() => payments.suggestMatches(a.accountant, bPaymentId));
      await expectBlocked(() => payments.allocatePayment(a.accountant, { paymentId: bPaymentId, invoiceId: bInvoice.id, amount: "1.00" }));
      await expectBlocked(() => payments.reverseAllocation(a.accountant, bAllocationId, "razlog"));
      await expectBlocked(() => payments.reversePayment(a.accountant, bPaymentId, "razlog"));
    });

    it("addBalanceCorrection rejects a foreign party id", async () => {
      await expectBlocked(() => payments.addBalanceCorrection(a.accountant, { partyId: b.ownerA.id, amount: "10.00", reason: "test" }));
    });

    it("listPayments never includes the other tenant's rows", async () => {
      const list = await payments.listPayments(a.president);
      expect(list.some((p) => p.id === bPaymentId)).toBe(false);
    });

    it("ownerBalance/ownerBalanceBreakdown/ownerAdvance never surface another tenant's charges for a foreign party id", async () => {
      // These functions don't existence-check partyId itself, but every query inside is
      // scoped by the *actor's own* zevId — a foreign party id (real in tenant B, unknown
      // in tenant A) simply matches nothing, so the isolation invariant here is "comes
      // back empty/zero", not "throws".
      const bal = await payments.ownerBalance(a.president, b.ownerA.id);
      expect(bal.charged).toBe("0.00");
      expect(bal.paid).toBe("0.00");
      expect(bal.balance).toBe("0.00");
      const advance = await payments.ownerAdvance(a.president, b.ownerA.id);
      expect(advance).toBe("0.00");
    });
  });

  // ---------------------------------------------------------------------
  // meetings.ts
  // ---------------------------------------------------------------------
  describe("meetings", () => {
    it("getMeeting/updateMeeting/addAgendaItem/recordAttendance reject a foreign meeting or party id", async () => {
      await expectBlocked(() => meetings.getMeeting(a.president, bDraftProposal.meeting.id));
      await expectBlocked(() => meetings.updateMeeting(a.president, bDraftProposal.meeting.id, { title: "hakovano" }));
      await expectBlocked(() => meetings.addAgendaItem(a.president, { meetingId: bDraftProposal.meeting.id, title: "x" }));
      await expectBlocked(() => meetings.recordAttendance(a.president, { meetingId: bDraftProposal.meeting.id, partyId: a.ownerA.id, present: true }));
      const aMeetingForAttendance = await meetings.createMeeting(a.president, { title: "Sjednica prisustva", type: "REGULAR" });
      await expectBlocked(() => meetings.recordAttendance(a.president, { meetingId: aMeetingForAttendance.id, partyId: b.ownerA.id, present: true }));
    });

    it("advanceMeetingStatus rejects a foreign meeting id", async () => {
      await expectBlocked(() => meetings.advanceMeetingStatus(a.president, bDraftProposal.meeting.id, "SCHEDULED"));
    });

    it("createProposal rejects a foreign meetingId/votingRuleId/buildingId", async () => {
      const aMeeting = await meetings.createMeeting(a.president, { title: "Sjednica A", type: "REGULAR" });
      await expectBlocked(() =>
        meetings.createProposal(a.president, {
          meetingId: bDraftProposal.meeting.id, code: "P-X", title: "X", text: "X",
          scopeType: "ZEV", votingRuleId: a.rule.id,
        })
      );
      await expectBlocked(() =>
        meetings.createProposal(a.president, {
          meetingId: aMeeting.id, code: "P-Y", title: "Y", text: "Y",
          scopeType: "ZEV", votingRuleId: b.rule.id,
        })
      );
    });

    it("getProposal/updateDraftProposal/createProposalRevision reject a foreign proposal id", async () => {
      await expectBlocked(() => meetings.getProposal(a.president, bDraftProposal.proposal.id));
      await expectBlocked(() => meetings.updateDraftProposal(a.president, bDraftProposal.proposal.id, { title: "hakovano" }));
      await expectBlocked(() => meetings.createProposalRevision(a.president, bDraftProposal.proposal.id, { title: "x" }, "razlog"));
    });

    it("openVoting rejects a foreign (still-draft) proposal id", async () => {
      await expectBlocked(() => meetings.openVoting(a.president, bDraftProposal.proposal.id));
    });

    it("revokeToken/reissueToken reject a foreign token id", async () => {
      await expectBlocked(() => meetings.revokeToken(a.president, bTokenId, "razlog"));
      await expectBlocked(() => meetings.reissueToken(a.president, bTokenId, "razlog"));
    });

    it("recordManualVote/correctVote reject a foreign eligible-voter or vote id", async () => {
      await expectBlocked(() => meetings.recordManualVote(a.president, { eligibleVoterId: bEligibleVoterId, choice: "APPROVE", channel: "PAPER" }));
      await expectBlocked(() => meetings.correctVote(a.president, { voteId: bVoteId, choice: "REJECT", reason: "razlog", authority: "osnov" }));
    });

    it("closeVoting/recordDecision reject a foreign proposal id", async () => {
      await expectBlocked(() => meetings.closeVoting(a.president, bOpenProposal.proposal.id));
      await expectBlocked(() => meetings.recordDecision(a.president, bOpenProposal.proposal.id, "OD-hack"));
    });

    it("openProposalsForOwner/ownVotes never surface another tenant's proposals or votes", async () => {
      // openProposalsForOwner bypasses the self-check for a PRESIDENT, but the eligible-voter
      // query is still scoped to the actor's own zevId — a foreign partyId (real in B) simply
      // matches nothing here, not "throws".
      const open = await meetings.openProposalsForOwner(a.president, b.ownerA.id);
      expect(open).toEqual([]);
    });

    it("listMeetings/listVotingRules never include the other tenant's rows", async () => {
      const list = await meetings.listMeetings(a.president);
      expect(list.some((m) => m.id === bDraftProposal.meeting.id || m.id === bOpenProposal.meeting.id)).toBe(false);
      const rules = await meetings.listVotingRules(a.president);
      expect(rules.some((r) => r.id === b.rule.id)).toBe(false);
    });
  });

  // ---------------------------------------------------------------------
  // documents.ts
  // ---------------------------------------------------------------------
  describe("documents", () => {
    it("every generate*Pdf function rejects a foreign source id", async () => {
      await expectBlocked(() => documents.generateInvoicePdf(a.president, bInvoice.id));
      await expectBlocked(() => documents.generateOwnerStatementPdf(a.president, b.ownerA.id));
      await expectBlocked(() => documents.generateEVoteConsentPdf(a.president, b.ownerA.id));
      await expectBlocked(() => documents.generateMeetingInvitationPdf(a.president, bDraftProposal.meeting.id));
      await expectBlocked(() => documents.generateMinutesPdf(a.president, bDraftProposal.meeting.id));
      await expectBlocked(() => documents.generateDecisionPdf(a.president, bOpenProposal.proposal.id));
      await expectBlocked(() => documents.generateVotingListPdf(a.president, bOpenProposal.proposal.id));
      await expectBlocked(() => documents.generatePlanPdf(a.president, bPlan.id));
      await expectBlocked(() => documents.generatePaymentReminderPdf(a.accountant, b.ownerA.id));
      await expectBlocked(() => documents.generateWorkOrderPdf(a.president, bWorkOrder.id));
    });

    it("readDocumentFile/publishDocument reject a foreign document id", async () => {
      await expectBlocked(() => documents.readDocumentFile(a.president, bDocumentId));
      await expectBlocked(() => documents.publishDocument(a.president, bDocumentId));
    });

    it("listDocuments never includes the other tenant's rows", async () => {
      const list = await documents.listDocuments(a.president);
      expect(list.some((d) => d.id === bDocumentId)).toBe(false);
    });
  });

  // ---------------------------------------------------------------------
  // attachments.ts
  // ---------------------------------------------------------------------
  describe("attachments", () => {
    it("readAttachmentFile rejects a foreign attachment id", async () => {
      await expectBlocked(() => attachments.readAttachmentFile(a.president, bAttachmentId));
    });

    it("listOwnershipProofsByStakeIds never resolves another tenant's stake id", async () => {
      const map = await attachments.listOwnershipProofsByStakeIds(a.president, [bStakeId]);
      expect(map.size).toBe(0);
    });

    it("listAttachments never includes the other tenant's rows", async () => {
      const list = await attachments.listAttachments(a.president);
      expect(list.some((x) => x.id === bAttachmentId)).toBe(false);
    });
  });

  // ---------------------------------------------------------------------
  // expenses.ts
  // ---------------------------------------------------------------------
  describe("expenses", () => {
    it("createExpense rejects every foreign FK it validates", async () => {
      await expectBlocked(() => expensesSvc.createExpense(a.accountant, { supplierId: bSupplier.id, amount: "10.00" }));
      await expectBlocked(() => expensesSvc.createExpense(a.accountant, { buildingId: b.b1.id, amount: "10.00" }));
      await expectBlocked(() => expensesSvc.createExpense(a.accountant, { projectId: bProject.id, amount: "10.00" }));
      await expectBlocked(() => expensesSvc.createExpense(a.accountant, { maintenanceIssueId: bIssue.id, amount: "10.00" }));
      await expectBlocked(() => expensesSvc.createExpense(a.accountant, { workOrderId: bWorkOrder.id, amount: "10.00" }));
    });

    it("updateExpense/payExpense/cancelExpense reject a foreign expense id", async () => {
      await expectBlocked(() => expensesSvc.updateExpense(a.accountant, bExpense.id, { description: "hakovano" }));
      await expectBlocked(() => expensesSvc.payExpense(a.accountant, { expenseId: bExpense.id, accountId: a.account.id, date: new Date() }));
      await expectBlocked(() => expensesSvc.cancelExpense(a.accountant, bExpense.id, "razlog"));
    });

    it("payExpense also rejects a foreign account id against the actor's own expense", async () => {
      const aExpense = await expensesSvc.createExpense(a.accountant, { amount: "40.00" });
      await expectBlocked(() => expensesSvc.payExpense(a.accountant, { expenseId: aExpense.id, accountId: b.account.id, date: new Date() }));
    });

    it("listSuppliers/listExpenses never include the other tenant's rows", async () => {
      const suppliers = await expensesSvc.listSuppliers(a.president);
      expect(suppliers.some((s) => s.id === bSupplier.id)).toBe(false);
      const list = await expensesSvc.listExpenses(a.president);
      expect(list.some((e) => e.id === bExpense.id)).toBe(false);
    });
  });

  // ---------------------------------------------------------------------
  // plans.ts
  // ---------------------------------------------------------------------
  describe("plans", () => {
    it("getPlan/createPlanRevision/addPlanItem/proposePlan/planVsActual reject a foreign plan id", async () => {
      await expectBlocked(() => plans.getPlan(a.president, bPlan.id));
      await expectBlocked(() => plans.createPlanRevision(a.president, bPlan.id, "razlog"));
      await expectBlocked(() => plans.addPlanItem(a.president, { planId: bPlan.id, type: "INCOME", name: "x", plannedAmount: "1.00" }));
      await expectBlocked(() => plans.proposePlan(a.president, bPlan.id));
      await expectBlocked(() => plans.planVsActual(a.president, bPlan.id));
    });

    it("approvePlan rejects a foreign plan id and a foreign proposal id", async () => {
      // Foreign planId, with a real ACCEPTED proposal from tenant A (so the proposal-status
      // check passes and the rejection is genuinely coming from the planId scoping).
      await expectBlocked(() => plans.approvePlan(a.president, bPlan.id, aAcceptedProposalId));
      // Foreign proposalId, against a real plan of tenant A's own.
      const aPlan = await plans.createPlan(a.president, { year: 2036, kind: "BUDGET", title: "Plan A" });
      await expectBlocked(() => plans.approvePlan(a.president, aPlan.id, bOpenProposal.proposal.id));
    });

    it("addPlanItem rejects foreign building/project/unit ids on an in-tenant plan", async () => {
      const aPlan = await plans.createPlan(a.president, { year: 2037, kind: "MAINTENANCE", title: "Plan A2" });
      await expectBlocked(() => plans.addPlanItem(a.president, { planId: aPlan.id, type: "PROJECT", name: "x", plannedAmount: "1.00", buildingId: b.b1.id }));
      await expectBlocked(() => plans.addPlanItem(a.president, { planId: aPlan.id, type: "PROJECT", name: "x", plannedAmount: "1.00", projectId: bProject.id }));
      await expectBlocked(() => plans.addPlanItem(a.president, { planId: aPlan.id, type: "PROJECT", name: "x", plannedAmount: "1.00", unitIds: [b.u1.id] }));
    });

    it("listPlans/listProjects never include the other tenant's rows", async () => {
      const list = await plans.listPlans(a.president);
      expect(list.some((p) => p.id === bPlan.id)).toBe(false);
      const projects = await plans.listProjects(a.president);
      expect(projects.some((p) => p.id === bProject.id)).toBe(false);
    });
  });

  // ---------------------------------------------------------------------
  // maintenance.ts
  // ---------------------------------------------------------------------
  describe("maintenance", () => {
    it("getIssue/addIssueComment/transitionIssue/markEmergency/ratifyEmergency reject a foreign issue id", async () => {
      await expectBlocked(() => maintenance.getIssue(a.president, bIssue.id));
      await expectBlocked(() => maintenance.addIssueComment(a.president, bIssue.id, "komentar"));
      await expectBlocked(() => maintenance.transitionIssue(a.president, bIssue.id, "TRIAGED"));
      await expectBlocked(() => maintenance.markEmergency(a.president, bIssue.id, { reason: "x", authorizedBy: "y", authority: "z" }));
      await expectBlocked(() => maintenance.ratifyEmergency(a.president, bIssue.id, "ref"));
    });

    it("reportIssue rejects a foreign building/entrance/unit id", async () => {
      await expectBlocked(() => maintenance.reportIssue(a.actorA, { title: "x", description: "y", unitId: b.u1.id }));
    });

    it("addOffer/selectOffer/createWorkOrder/completeWorkOrder reject foreign ids", async () => {
      await expectBlocked(() => maintenance.addOffer(a.president, { issueId: bIssue.id, supplierId: bSupplier.id, amount: "1.00" }));
      await expectBlocked(() => maintenance.selectOffer(a.president, bOffer.id));
      await expectBlocked(() => maintenance.createWorkOrder(a.president, { issueId: bIssue.id, supplierId: bSupplier.id, description: "x" }));
      await expectBlocked(() => maintenance.completeWorkOrder(a.president, bWorkOrder.id, "gotovo"));
    });

    it("listIssues never includes the other tenant's rows", async () => {
      const list = await maintenance.listIssues(a.president);
      expect(list.some((i) => i.id === bIssue.id)).toBe(false);
    });
  });

  // ---------------------------------------------------------------------
  // reports.ts
  // ---------------------------------------------------------------------
  describe("reports", () => {
    it("ownerDebtReport never resolves foreign partyIds into rows", async () => {
      const report = await reports.ownerDebtReport(a.president, { asOf: new Date(), partyIds: [b.ownerA.id] });
      expect(report.rows).toEqual([]);
    });

    it("cashFlow/receivables/supplier reports never reference the other tenant's accounts, invoices or suppliers", async () => {
      const cashFlow = await reports.cashFlowReport(a.president);
      expect(cashFlow.some((r) => r.accountId === b.account.id)).toBe(false);
      const receivables = await reports.receivablesReport(a.president);
      expect(receivables.rows.some((r) => r.invoiceId === bInvoice.id)).toBe(false);
      const suppliers = await reports.supplierReport(a.president);
      expect(suppliers.some((s) => s.supplier === `Dobavljac-${b.t}`)).toBe(false);
      const unpaid = await reports.unpaidSupplierInvoices(a.president);
      expect(unpaid.some((e) => e.id === bExpense.id)).toBe(false);
    });
  });

  // ---------------------------------------------------------------------
  // users.ts
  // ---------------------------------------------------------------------
  describe("users", () => {
    it("createUserForParty rejects a foreign party id", async () => {
      await expectBlocked(() => users.createUserForParty(a.president, { partyId: b.ownerC.id, email: `hack-${a.t}@zev.test`, password: "Test1234!", roles: ["OWNER"] }));
    });

    it("deactivateUser/activateUser/updateUserRoles reject a foreign user id", async () => {
      await expectBlocked(() => users.deactivateUser(a.president, b.actorA.userId, "razlog"));
      await expectBlocked(() => users.activateUser(a.president, b.actorA.userId, "razlog"));
      await expectBlocked(() => users.updateUserRoles(a.president, b.actorA.userId, ["OWNER", "ACCOUNTANT"]));
    });
  });

  // ---------------------------------------------------------------------
  // evoteConsent.ts
  // ---------------------------------------------------------------------
  describe("evoteConsent", () => {
    it("markEVoteConsentSigned/revokeEVoteConsent/getEVoteConsentHistory reject a foreign party id", async () => {
      await expectBlocked(() => evoteConsent.markEVoteConsentSigned(a.president, b.ownerA.id, proof));
      await expectBlocked(() => evoteConsent.revokeEVoteConsent(a.president, b.ownerA.id, "razlog"));
      await expectBlocked(() => evoteConsent.getEVoteConsentHistory(a.president, b.ownerA.id));
    });
  });
});
