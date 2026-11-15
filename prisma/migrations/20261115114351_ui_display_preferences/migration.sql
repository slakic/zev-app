-- AlterTable
ALTER TABLE "User" ADD COLUMN     "uiLayoutSimple" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "uiPrefsAskedAt" TIMESTAMP(3),
ADD COLUMN     "uiTextLarge" BOOLEAN NOT NULL DEFAULT false;
