-- AlterTable: per-owner consent state for electronic voting (formalizes the hybrid
-- physical + electronic voting flow — see the "Izjava o saglasnosti" declaration).
-- Kept as a plain String status (like Attachment.category) rather than a DB enum so
-- the set of statuses can evolve without a further migration; the service layer
-- (EVOTE_CONSENT_STATUSES in evoteConsent.ts) is the primary gate on valid values.
ALTER TABLE "Party" ADD COLUMN "eVoteConsentStatus" TEXT NOT NULL DEFAULT 'NONE';
ALTER TABLE "Party" ADD COLUMN "eVoteConsentEmail" TEXT;
ALTER TABLE "Party" ADD COLUMN "eVoteConsentDocumentId" TEXT;

ALTER TABLE "Party" ADD CONSTRAINT "Party_eVoteConsentStatus_check"
  CHECK ("eVoteConsentStatus" IN ('NONE', 'PENDING', 'SIGNED', 'REVOKED'));

CREATE INDEX "Party_eVoteConsentStatus_idx" ON "Party"("eVoteConsentStatus");

-- New Attachment category for scanned, signed consent/authorization forms (the signed
-- copy of the e-vote consent declaration lives here, linked back to the Party via
-- linkedType/linkedId, same pattern as OWNERSHIP_PROOF <-> OwnershipStake).
ALTER TABLE "Attachment" DROP CONSTRAINT "Attachment_category_check";
ALTER TABLE "Attachment" ADD CONSTRAINT "Attachment_category_check"
  CHECK ("category" IN ('OWNERSHIP_PROOF', 'INVOICE', 'REPORT', 'MINUTES', 'CONTRACT', 'CORRESPONDENCE', 'PHOTO', 'CONSENT', 'OTHER'));
