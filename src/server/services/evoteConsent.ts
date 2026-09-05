// Per-owner consent status for electronic voting — formalizes the hybrid physical + electronic
// voting flow described in the "Izjava o saglasnosti" declaration (see generateEVoteConsentPdf
// in documents.ts for the personalized, print-and-sign form itself).
//
// Signed/revoked timestamps and the revoke reason are NOT stored as dedicated Party columns —
// they're derived from the append-only AuditEvent trail (tamper-proof by DB trigger), which
// already carries createdAt/reason/before/after for free.
import { prisma } from "@/lib/prisma";
import { audit } from "@/server/audit";
import { requireRole, requireSelfOrRole, type Actor } from "@/server/auth/guards";
import { createLinkedAttachmentTx, type UploadInput } from "@/server/services/attachments";

export const EVOTE_CONSENT_STATUSES = ["NONE", "PENDING", "SIGNED", "REVOKED"] as const;
export type EVoteConsentStatus = (typeof EVOTE_CONSENT_STATUSES)[number];

export function isEVoteConsentStatus(v: string): v is EVoteConsentStatus {
  return (EVOTE_CONSENT_STATUSES as readonly string[]).includes(v);
}

export type ScannedConsentInput = Pick<UploadInput, "buffer" | "filename" | "mime">;

/**
 * President/accountant records that the physically signed declaration was received, attaching
 * the scanned copy as a CONSENT-category Attachment linked back to this Party.
 */
export async function markEVoteConsentSigned(actor: Actor, partyId: string, scan: ScannedConsentInput) {
  requireRole(actor, "PRESIDENT", "ACCOUNTANT");
  const before = await prisma.party.findUniqueOrThrow({
    where: { id: partyId },
    select: { eVoteConsentStatus: true },
  });

  const result = await prisma.$transaction(async (tx) => {
    const attachment = await createLinkedAttachmentTx(tx, actor, {
      buffer: scan.buffer,
      filename: scan.filename,
      mime: scan.mime,
      category: "CONSENT",
      linkedType: "Party",
      linkedId: partyId,
    });
    const party = await tx.party.update({
      where: { id: partyId },
      data: { eVoteConsentStatus: "SIGNED", eVoteConsentDocumentId: attachment.id },
    });
    return { attachment, party };
  });

  await audit(actor, {
    action: "party.evote_consent.sign",
    targetType: "Party",
    targetId: partyId,
    before: { status: before.eVoteConsentStatus },
    after: { status: "SIGNED", attachmentId: result.attachment.id },
  });

  return result.party;
}

/**
 * Revoke consent for electronic voting. The owner may revoke their own consent through the app
 * at any time, without giving a reason; the president may also record a revocation (e.g. on a
 * written request). Historical email/attachment references are preserved — only the status
 * changes — so a later re-signing (markEVoteConsentSigned) still has the prior scan on record.
 */
export async function revokeEVoteConsent(actor: Actor, partyId: string, reason?: string | null) {
  requireSelfOrRole(actor, partyId, "PRESIDENT");
  const before = await prisma.party.findUniqueOrThrow({
    where: { id: partyId },
    select: { eVoteConsentStatus: true },
  });
  if (before.eVoteConsentStatus === "NONE") {
    throw new Error("Saglasnost nije ni data — nema šta da se povuče.");
  }
  const party = await prisma.party.update({
    where: { id: partyId },
    data: { eVoteConsentStatus: "REVOKED" },
  });
  await audit(actor, {
    action: "party.evote_consent.revoke",
    targetType: "Party",
    targetId: partyId,
    before: { status: before.eVoteConsentStatus },
    after: { status: "REVOKED" },
    reason: reason || null,
  });
  return party;
}

/** Signed-on / revoked-on / revoke-reason, read back from the audit trail for display. */
export async function getEVoteConsentHistory(actor: Actor, partyId: string) {
  requireSelfOrRole(actor, partyId, "PRESIDENT", "ACCOUNTANT");
  const events = await prisma.auditEvent.findMany({
    where: {
      targetType: "Party",
      targetId: partyId,
      action: { in: ["party.evote_consent.sign", "party.evote_consent.revoke"] },
    },
    orderBy: { createdAt: "desc" },
  });
  const lastSign = events.find((e) => e.action === "party.evote_consent.sign");
  const lastRevoke = events.find((e) => e.action === "party.evote_consent.revoke");
  return {
    signedAt: lastSign?.createdAt ?? null,
    revokedAt: lastRevoke?.createdAt ?? null,
    revokeReason: lastRevoke?.reason ?? null,
  };
}
