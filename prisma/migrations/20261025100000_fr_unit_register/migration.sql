-- FR: registar posebnih dijelova + glasanje po etaznim vlasnicima (Plans/fr-registar-i-glasanje-po-etaznim-vlasnicima-plan.md).
-- Aditivna migracija: nista se ne brise. Jedino se mijenja unique na "EligibleVoter" (uz backfill prije toga).
-- (Runner izvrsava skriptu bez parsiranja dollar-quoted stringova — ovdje ih nema.)

-- AlterEnum
ALTER TYPE "UnitType" ADD VALUE 'GARAGE_SPACE';

-- CreateEnum
CREATE TYPE "UnitRegisterStatus" AS ENUM ('DRAFT', 'ESTABLISHED', 'REVIEW');

-- CreateEnum
CREATE TYPE "UnitRegisterChangeKind" AS ENUM ('ESTABLISH', 'ADD_UNIT', 'RETIRE_UNIT', 'MERGE_SPLIT', 'CHANGE_AREA', 'CHANGE_SHARE', 'CHANGE_LABEL', 'CHANGE_TYPE');

-- AlterTable
ALTER TABLE "Zev" ADD COLUMN "unitRegisterStatus" "UnitRegisterStatus" NOT NULL DEFAULT 'DRAFT',
ADD COLUMN "unitRegisterVersion" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "unitRegisterEstablishedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "Unit" ADD COLUMN "votingRepresentativeId" TEXT;

-- AlterTable
ALTER TABLE "EligibleVoter" ADD COLUMN "subjectKey" TEXT NOT NULL DEFAULT '',
ADD COLUMN "memberPartyIds" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- CreateTable
CREATE TABLE "UnitRegisterChange" (
    "id" TEXT NOT NULL,
    "zevId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "kind" "UnitRegisterChangeKind" NOT NULL,
    "reason" TEXT NOT NULL,
    "attachmentId" TEXT,
    "before" JSONB NOT NULL,
    "after" JSONB NOT NULL,
    "actorId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UnitRegisterChange_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "UnitRegisterChange_zevId_version_key" ON "UnitRegisterChange"("zevId", "version");

-- AddForeignKey
ALTER TABLE "UnitRegisterChange" ADD CONSTRAINT "UnitRegisterChange_zevId_fkey" FOREIGN KEY ("zevId") REFERENCES "Zev"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Unit" ADD CONSTRAINT "Unit_votingRepresentativeId_fkey" FOREIGN KEY ("votingRepresentativeId") REFERENCES "Party"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Append-only: istorija registra se nikad ne mijenja ni brise (isti trigger kao AuditEvent/Vote).
CREATE TRIGGER unit_register_change_append_only
  BEFORE UPDATE OR DELETE ON "UnitRegisterChange"
  FOR EACH ROW EXECUTE FUNCTION forbid_update_delete();

-- Backfill EligibleVoter: postojeci redovi su "samostalni vlasnik" (odbor: clan odbora), pa tek onda novi unique.
UPDATE "EligibleVoter" ev
SET "subjectKey" = CASE
      WHEN EXISTS (
        SELECT 1 FROM "Proposal" p JOIN "Meeting" m ON m."id" = p."meetingId"
        WHERE p."id" = ev."proposalId" AND m."body" = 'BOARD'
      ) THEN 'B:' || ev."ownerId"
      ELSE 'P:' || ev."ownerId"
    END,
    "memberPartyIds" = ARRAY[ev."ownerId"];

-- DropIndex
DROP INDEX "EligibleVoter_proposalId_ownerId_key";

-- CreateIndex
CREATE UNIQUE INDEX "EligibleVoter_proposalId_subjectKey_ownerId_key" ON "EligibleVoter"("proposalId", "subjectKey", "ownerId");

-- FR-Q4: postojeci ZEV-ovi koji imaju jedinice prelaze u "Za provjeru"; ZEV bez jedinica ostaje DRAFT.
UPDATE "Zev" SET "unitRegisterStatus" = 'REVIEW'
WHERE EXISTS (SELECT 1 FROM "Unit" u WHERE u."zevId" = "Zev"."id");

-- Nova kategorija priloga: dokument izmjene registra (Attachment.category ima CHECK constraint).
ALTER TABLE "Attachment" DROP CONSTRAINT "Attachment_category_check";
ALTER TABLE "Attachment" ADD CONSTRAINT "Attachment_category_check"
  CHECK ("category" IN ('OWNERSHIP_PROOF', 'UNIT_REGISTER_CHANGE', 'INVOICE', 'REPORT', 'MINUTES', 'CONTRACT', 'CORRESPONDENCE', 'PHOTO', 'CONSENT', 'OTHER'));
