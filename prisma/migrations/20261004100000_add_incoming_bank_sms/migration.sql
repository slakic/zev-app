-- CreateTable
CREATE TABLE "IncomingBankSms" (
    "id" TEXT NOT NULL,
    "zevId" TEXT NOT NULL,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "rawText" TEXT,
    "rawHash" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "parseError" TEXT,
    "ownAccount" TEXT,
    "accountId" TEXT,
    "amount" DECIMAL(14,2),
    "purposeRaw" TEXT,
    "counterpartyAccount" TEXT,
    "counterpartyName" TEXT,
    "balanceAfter" DECIMAL(14,2),
    "duplicateHits" INTEGER NOT NULL DEFAULT 0,
    "lastDuplicateAt" TIMESTAMP(3),
    "paymentId" TEXT,
    "transactionId" TEXT,
    "importBatchId" TEXT,
    "reviewedById" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "dismissReason" TEXT,
    "ipHash" TEXT,

    CONSTRAINT "IncomingBankSms_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "IncomingBankSms_paymentId_key" ON "IncomingBankSms"("paymentId");

-- CreateIndex
CREATE UNIQUE INDEX "IncomingBankSms_transactionId_key" ON "IncomingBankSms"("transactionId");

-- CreateIndex
CREATE INDEX "IncomingBankSms_zevId_status_idx" ON "IncomingBankSms"("zevId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "IncomingBankSms_zevId_rawHash_key" ON "IncomingBankSms"("zevId", "rawHash");

-- AddForeignKey
ALTER TABLE "IncomingBankSms" ADD CONSTRAINT "IncomingBankSms_zevId_fkey" FOREIGN KEY ("zevId") REFERENCES "Zev"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IncomingBankSms" ADD CONSTRAINT "IncomingBankSms_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "MoneyAccount"("id") ON DELETE SET NULL ON UPDATE CASCADE;
