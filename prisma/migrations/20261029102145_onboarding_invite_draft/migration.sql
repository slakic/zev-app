-- Plans/zev-onboarding-wizard-plan.md §2 (v2.57.0, Faza A): pozivni link i nacrt novog ZEV-a.
-- Aditivno: tri nove tabele bez veze sa postojećim (ZEV nastaje tek pri objavi nacrta); stari kod ih ignoriše.
-- Nisu append-only: nacrt i njegovi fajlovi se smiju obrisati, trajni trag je AuditEvent (onboarding.*).
CREATE TYPE "OnboardingInviteStatus" AS ENUM ('ACTIVE', 'ACCEPTED', 'REVOKED');
CREATE TYPE "OnboardingDraftStatus" AS ENUM ('IN_PROGRESS', 'PUBLISHED', 'DISCARDED');

CREATE TABLE "OnboardingInvite" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "workingName" TEXT NOT NULL,
    "tier" "ZevTier" NOT NULL,
    "note" TEXT,
    "tokenHash" TEXT NOT NULL,
    "status" "OnboardingInviteStatus" NOT NULL DEFAULT 'ACTIVE',
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "openedAt" TIMESTAMP(3),
    "acceptedAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "revokedReason" TEXT,

    CONSTRAINT "OnboardingInvite_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "OnboardingInvite_tokenHash_key" ON "OnboardingInvite"("tokenHash");
CREATE INDEX "OnboardingInvite_email_idx" ON "OnboardingInvite"("email");

CREATE TABLE "OnboardingDraft" (
    "id" TEXT NOT NULL,
    "inviteId" TEXT NOT NULL,
    "ownerUserId" TEXT NOT NULL,
    "status" "OnboardingDraftStatus" NOT NULL DEFAULT 'IN_PROGRESS',
    "data" JSONB NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 0,
    "publishedZevId" TEXT,
    "publishedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OnboardingDraft_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "OnboardingDraft_inviteId_key" ON "OnboardingDraft"("inviteId");
CREATE UNIQUE INDEX "OnboardingDraft_publishedZevId_key" ON "OnboardingDraft"("publishedZevId");
CREATE INDEX "OnboardingDraft_ownerUserId_status_idx" ON "OnboardingDraft"("ownerUserId", "status");

ALTER TABLE "OnboardingDraft" ADD CONSTRAINT "OnboardingDraft_inviteId_fkey" FOREIGN KEY ("inviteId") REFERENCES "OnboardingInvite"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "OnboardingDraftFile" (
    "id" TEXT NOT NULL,
    "draftId" TEXT NOT NULL,
    "filename" TEXT NOT NULL,
    "mime" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "bytes" BYTEA NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OnboardingDraftFile_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "OnboardingDraftFile_draftId_idx" ON "OnboardingDraftFile"("draftId");

ALTER TABLE "OnboardingDraftFile" ADD CONSTRAINT "OnboardingDraftFile_draftId_fkey" FOREIGN KEY ("draftId") REFERENCES "OnboardingDraft"("id") ON DELETE CASCADE ON UPDATE CASCADE;
