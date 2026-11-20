-- Kontni plan A2 (Plans/kontni-plan-i-knjizenje-plan.md §3.5–3.6, §11): namjene sredstava, vrste zaduženja,
-- kontrolna konta, pravila knjiženja i potvrde šema pod kapijom. Ništa ne knjiži.
-- Tabele i indeksi generisani `prisma migrate diff`; okidači na kraju su ručno napisani.

-- CreateEnum
CREATE TYPE "ControlRole" AS ENUM ('MONEY_ACCOUNT', 'OWNER_RECEIVABLE', 'OWNER_ADVANCE', 'UNIDENTIFIED_RECEIPTS', 'SUPPLIER_PAYABLE');

-- CreateEnum
CREATE TYPE "AccountingEventKind" AS ENUM ('CHARGE_ISSUED', 'CHARGE_CANCELLED', 'CHARGE_CORRECTED', 'PAYMENT_RECEIVED', 'PAYMENT_REVERSED', 'PAYMENT_IDENTIFIED', 'PAYMENT_ALLOCATED', 'ALLOCATION_REVERSED', 'REVENUE_RECOGNIZED', 'SUPPLIER_INVOICE', 'SUPPLIER_INVOICE_CANCELLED', 'SUPPLIER_PAYMENT', 'CASH_INCOME', 'CASH_EXPENSE', 'TRANSACTION_CANCELLED', 'BALANCE_CORRECTION');

-- CreateEnum
CREATE TYPE "PostingRuleStatus" AS ENUM ('DRAFT', 'CONFIRMED', 'WITHDRAWN');

-- CreateEnum
CREATE TYPE "GatedSchema" AS ENUM ('REVENUE_RECOGNITION', 'COMMON_RESERVE_CLASSIFICATION');

-- AlterTable
ALTER TABLE "ChargeItem" ADD COLUMN     "chargeTypeId" TEXT;

-- AlterTable
ALTER TABLE "InvoiceLine" ADD COLUMN     "chargeTypeId" TEXT;

-- CreateTable
CREATE TABLE "FundPurpose" (
    "id" TEXT NOT NULL,
    "zevId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "isCommonReserve" BOOLEAN NOT NULL DEFAULT false,
    "decisionRef" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FundPurpose_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ChargeType" (
    "id" TEXT NOT NULL,
    "zevId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "defaultPurposeId" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ChargeType_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ZevControlAccount" (
    "id" TEXT NOT NULL,
    "zevId" TEXT NOT NULL,
    "role" "ControlRole" NOT NULL,
    "moneyAccountId" TEXT,
    "purposeId" TEXT,
    "accountId" TEXT NOT NULL,
    "validFrom" TIMESTAMP(3) NOT NULL,
    "reason" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ZevControlAccount_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PostingRule" (
    "id" TEXT NOT NULL,
    "zevId" TEXT NOT NULL,
    "chartId" TEXT NOT NULL,
    "kind" "AccountingEventKind" NOT NULL,
    "chargeTypeId" TEXT,
    "categoryId" TEXT,
    "counterAccountId" TEXT NOT NULL,
    "purposeId" TEXT,
    "validFrom" TIMESTAMP(3) NOT NULL,
    "status" "PostingRuleStatus" NOT NULL DEFAULT 'DRAFT',
    "supersedesId" TEXT,
    "reason" TEXT NOT NULL,
    "expertRef" TEXT,
    "createdById" TEXT NOT NULL,
    "confirmedById" TEXT,
    "confirmedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PostingRule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PostingSchemaApproval" (
    "id" TEXT NOT NULL,
    "zevId" TEXT NOT NULL,
    "schema" "GatedSchema" NOT NULL,
    "description" TEXT NOT NULL,
    "expertName" TEXT NOT NULL,
    "approvedAt" TIMESTAMP(3) NOT NULL,
    "attachmentId" TEXT,
    "revokesId" TEXT,
    "recordedById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PostingSchemaApproval_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "FundPurpose_zevId_code_key" ON "FundPurpose"("zevId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "ChargeType_zevId_code_key" ON "ChargeType"("zevId", "code");

-- CreateIndex
CREATE INDEX "ZevControlAccount_zevId_role_idx" ON "ZevControlAccount"("zevId", "role");

-- CreateIndex
CREATE UNIQUE INDEX "PostingRule_supersedesId_key" ON "PostingRule"("supersedesId");

-- CreateIndex
CREATE INDEX "PostingRule_zevId_kind_chargeTypeId_categoryId_validFrom_idx" ON "PostingRule"("zevId", "kind", "chargeTypeId", "categoryId", "validFrom");

-- CreateIndex
CREATE UNIQUE INDEX "PostingSchemaApproval_revokesId_key" ON "PostingSchemaApproval"("revokesId");

-- CreateIndex
CREATE INDEX "PostingSchemaApproval_zevId_schema_idx" ON "PostingSchemaApproval"("zevId", "schema");

-- AddForeignKey
ALTER TABLE "ChargeItem" ADD CONSTRAINT "ChargeItem_chargeTypeId_fkey" FOREIGN KEY ("chargeTypeId") REFERENCES "ChargeType"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InvoiceLine" ADD CONSTRAINT "InvoiceLine_chargeTypeId_fkey" FOREIGN KEY ("chargeTypeId") REFERENCES "ChargeType"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FundPurpose" ADD CONSTRAINT "FundPurpose_zevId_fkey" FOREIGN KEY ("zevId") REFERENCES "Zev"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChargeType" ADD CONSTRAINT "ChargeType_zevId_fkey" FOREIGN KEY ("zevId") REFERENCES "Zev"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChargeType" ADD CONSTRAINT "ChargeType_defaultPurposeId_fkey" FOREIGN KEY ("defaultPurposeId") REFERENCES "FundPurpose"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ZevControlAccount" ADD CONSTRAINT "ZevControlAccount_zevId_fkey" FOREIGN KEY ("zevId") REFERENCES "Zev"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ZevControlAccount" ADD CONSTRAINT "ZevControlAccount_moneyAccountId_fkey" FOREIGN KEY ("moneyAccountId") REFERENCES "MoneyAccount"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ZevControlAccount" ADD CONSTRAINT "ZevControlAccount_purposeId_fkey" FOREIGN KEY ("purposeId") REFERENCES "FundPurpose"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ZevControlAccount" ADD CONSTRAINT "ZevControlAccount_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "ZevAccount"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PostingRule" ADD CONSTRAINT "PostingRule_zevId_fkey" FOREIGN KEY ("zevId") REFERENCES "Zev"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PostingRule" ADD CONSTRAINT "PostingRule_chargeTypeId_fkey" FOREIGN KEY ("chargeTypeId") REFERENCES "ChargeType"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PostingRule" ADD CONSTRAINT "PostingRule_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "TransactionCategory"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PostingRule" ADD CONSTRAINT "PostingRule_counterAccountId_fkey" FOREIGN KEY ("counterAccountId") REFERENCES "ZevAccount"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PostingRule" ADD CONSTRAINT "PostingRule_purposeId_fkey" FOREIGN KEY ("purposeId") REFERENCES "FundPurpose"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PostingRule" ADD CONSTRAINT "PostingRule_supersedesId_fkey" FOREIGN KEY ("supersedesId") REFERENCES "PostingRule"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PostingSchemaApproval" ADD CONSTRAINT "PostingSchemaApproval_zevId_fkey" FOREIGN KEY ("zevId") REFERENCES "Zev"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PostingSchemaApproval" ADD CONSTRAINT "PostingSchemaApproval_revokesId_fkey" FOREIGN KEY ("revokesId") REFERENCES "PostingSchemaApproval"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Potvrđeno pravilo knjiženja se ne mijenja ni ne briše; izmjena je novi red (supersedesId).
-- Nacrt (DRAFT) se smije potvrditi, povući ili obrisati.
CREATE OR REPLACE FUNCTION posting_rule_confirmed_immutable() RETURNS trigger AS '
BEGIN
  IF OLD.status = ''CONFIRMED'' THEN
    RAISE EXCEPTION ''Potvrđeno pravilo knjiženja se ne mijenja — napravite novu verziju.'';
  END IF;
  IF TG_OP = ''DELETE'' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
' LANGUAGE plpgsql;

CREATE TRIGGER posting_rule_confirmed_immutable
  BEFORE UPDATE OR DELETE ON "PostingRule"
  FOR EACH ROW EXECUTE FUNCTION posting_rule_confirmed_immutable();

-- Kontrolna konta i potvrde šema su append-only (isti obrazac kao append_only_guards).
CREATE TRIGGER zev_control_account_append_only
  BEFORE UPDATE OR DELETE ON "ZevControlAccount"
  FOR EACH ROW EXECUTE FUNCTION forbid_update_delete();

CREATE TRIGGER posting_schema_approval_append_only
  BEFORE UPDATE OR DELETE ON "PostingSchemaApproval"
  FOR EACH ROW EXECUTE FUNCTION forbid_update_delete();
