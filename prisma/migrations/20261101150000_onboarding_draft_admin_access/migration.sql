-- CreateTable
CREATE TABLE "OnboardingDraftAdminAccess" (
    "id" TEXT NOT NULL,
    "draftId" TEXT NOT NULL,
    "adminUserId" TEXT NOT NULL,
    "grantedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastUsedAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "revokedById" TEXT,

    CONSTRAINT "OnboardingDraftAdminAccess_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "OnboardingDraftAdminAccess_draftId_idx" ON "OnboardingDraftAdminAccess"("draftId");

-- CreateIndex
CREATE INDEX "OnboardingDraftAdminAccess_adminUserId_idx" ON "OnboardingDraftAdminAccess"("adminUserId");

-- AddForeignKey
ALTER TABLE "OnboardingDraftAdminAccess" ADD CONSTRAINT "OnboardingDraftAdminAccess_draftId_fkey" FOREIGN KEY ("draftId") REFERENCES "OnboardingDraft"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Najviše jedan AKTIVAN pristup po (nacrt, admin): ponovno dodavanje poslije uklanjanja pravi novi red, a dva
-- istovremena dodavanja ne mogu napraviti dva aktivna. Prisma ne modelira parcijalne indekse, pa je ovo ručni dodatak
-- (isti obrazac kao u 20260909100000_tenant_scope_settings).
CREATE UNIQUE INDEX "OnboardingDraftAdminAccess_active_key" ON "OnboardingDraftAdminAccess"("draftId", "adminUserId") WHERE "revokedAt" IS NULL;
