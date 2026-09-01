-- AlterTable
ALTER TABLE "Payment" ADD COLUMN "purposeRaw" TEXT;

-- AlterTable
ALTER TABLE "BankImportBatch" ADD COLUMN "sourceType" TEXT NOT NULL DEFAULT 'CSV';
ALTER TABLE "BankImportBatch" ADD COLUMN "rawText" TEXT;
