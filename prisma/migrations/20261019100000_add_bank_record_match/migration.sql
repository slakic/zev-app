-- CreateTable
CREATE TABLE "BankRecordMatch" (
    "id" TEXT NOT NULL,
    "zevId" TEXT NOT NULL,
    "smsId" TEXT NOT NULL,
    "statementBatchId" TEXT,
    "statementPaymentId" TEXT,
    "statementTransactionId" TEXT,
    "decision" TEXT NOT NULL,
    "origin" TEXT NOT NULL,
    "survivorPaymentId" TEXT,
    "reversedPaymentId" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BankRecordMatch_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "BankRecordMatch_zevId_smsId_idx" ON "BankRecordMatch"("zevId", "smsId");

-- CreateIndex
CREATE INDEX "BankRecordMatch_statementPaymentId_idx" ON "BankRecordMatch"("statementPaymentId");

-- CreateIndex
CREATE INDEX "BankRecordMatch_statementTransactionId_idx" ON "BankRecordMatch"("statementTransactionId");

-- AddForeignKey
ALTER TABLE "BankRecordMatch" ADD CONSTRAINT "BankRecordMatch_zevId_fkey" FOREIGN KEY ("zevId") REFERENCES "Zev"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BankRecordMatch" ADD CONSTRAINT "BankRecordMatch_smsId_fkey" FOREIGN KEY ("smsId") REFERENCES "IncomingBankSms"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Append-only, like PaymentAllocation: a changed decision is a new row (the latest one wins).
-- forbid_update_delete() comes from 20260823180200_append_only_guards.
CREATE TRIGGER bank_record_match_append_only
  BEFORE UPDATE OR DELETE ON "BankRecordMatch"
  FOR EACH ROW EXECUTE FUNCTION forbid_update_delete();
