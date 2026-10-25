-- Plans/glasacki-listic-po-sjednici-plan.md (v2.44.0): glasacki listic po sjednici.
-- Aditivno: nova tabela Ballot i nullable ApprovalToken.ballotId; stari kod ignorise novu kolonu.
CREATE TYPE "BallotStatus" AS ENUM ('ACTIVE', 'USED', 'REVOKED', 'SUPERSEDED');

CREATE TABLE "Ballot" (
    "id" TEXT NOT NULL,
    "zevId" TEXT NOT NULL,
    "meetingId" TEXT NOT NULL,
    "recipientPartyId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "verificationHash" TEXT NOT NULL,
    "status" "BallotStatus" NOT NULL DEFAULT 'ACTIVE',
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "issuedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "openedAt" TIMESTAMP(3),
    "usedAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "revokedReason" TEXT,
    "failedAttempts" INTEGER NOT NULL DEFAULT 0,
    "replacedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Ballot_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "Ballot_tokenHash_key" ON "Ballot"("tokenHash");
CREATE UNIQUE INDEX "Ballot_replacedById_key" ON "Ballot"("replacedById");
CREATE INDEX "Ballot_meetingId_idx" ON "Ballot"("meetingId");

ALTER TABLE "Ballot" ADD CONSTRAINT "Ballot_zevId_fkey" FOREIGN KEY ("zevId") REFERENCES "Zev"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Ballot" ADD CONSTRAINT "Ballot_meetingId_fkey" FOREIGN KEY ("meetingId") REFERENCES "Meeting"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Ballot" ADD CONSTRAINT "Ballot_recipientPartyId_fkey" FOREIGN KEY ("recipientPartyId") REFERENCES "Party"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Ballot" ADD CONSTRAINT "Ballot_replacedById_fkey" FOREIGN KEY ("replacedById") REFERENCES "Ballot"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "ApprovalToken" ADD COLUMN "ballotId" TEXT;
CREATE INDEX "ApprovalToken_ballotId_idx" ON "ApprovalToken"("ballotId");
ALTER TABLE "ApprovalToken" ADD CONSTRAINT "ApprovalToken_ballotId_fkey" FOREIGN KEY ("ballotId") REFERENCES "Ballot"("id") ON DELETE SET NULL ON UPDATE CASCADE;
