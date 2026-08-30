-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "Role" AS ENUM ('PRESIDENT', 'ACCOUNTANT', 'OWNER');

-- CreateEnum
CREATE TYPE "PartyKind" AS ENUM ('PERSON', 'ORGANIZATION');

-- CreateEnum
CREATE TYPE "UnitType" AS ENUM ('APARTMENT', 'BUSINESS', 'GARAGE', 'OTHER');

-- CreateEnum
CREATE TYPE "OccupancyType" AS ENUM ('OWNER_OCCUPANT', 'TENANT', 'OTHER_OCCUPANT');

-- CreateEnum
CREATE TYPE "ProxyScope" AS ENUM ('ALL', 'MEETING', 'PROPOSAL');

-- CreateEnum
CREATE TYPE "OfficeRole" AS ENUM ('PRESIDENT', 'ACCOUNTANT');

-- CreateEnum
CREATE TYPE "CommonAssetKind" AS ENUM ('AREA', 'SYSTEM', 'EQUIPMENT');

-- CreateEnum
CREATE TYPE "ScopeType" AS ENUM ('ZEV', 'BUILDING', 'ENTRANCE', 'UNITS', 'GROUP');

-- CreateEnum
CREATE TYPE "MeetingStatus" AS ENUM ('DRAFT', 'SCHEDULED', 'INVITATIONS_PREPARED', 'INVITATIONS_SENT', 'VOTING_OPEN', 'VOTING_CLOSED', 'RESULTS_REVIEW', 'DECISION_RECORDED', 'MINUTES_FINALIZED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "MeetingType" AS ENUM ('REGULAR', 'EXTRAORDINARY', 'CONSTITUTIVE', 'WRITTEN');

-- CreateEnum
CREATE TYPE "ProposalStatus" AS ENUM ('DRAFT', 'VOTING_OPEN', 'VOTING_CLOSED', 'ACCEPTED', 'REJECTED', 'WITHDRAWN', 'SUPERSEDED');

-- CreateEnum
CREATE TYPE "QuorumType" AS ENUM ('NONE', 'PERCENT_OF_TOTAL_WEIGHT', 'PERCENT_OF_OWNER_COUNT');

-- CreateEnum
CREATE TYPE "MajorityType" AS ENUM ('SIMPLE_OF_VOTES_CAST', 'PERCENT_OF_VOTES_CAST', 'PERCENT_OF_ELIGIBLE_WEIGHT');

-- CreateEnum
CREATE TYPE "WeightMethod" AS ENUM ('PER_OWNER', 'OWNERSHIP_SHARE', 'USABLE_AREA');

-- CreateEnum
CREATE TYPE "TokenStatus" AS ENUM ('ACTIVE', 'USED', 'REVOKED', 'EXPIRED', 'SUPERSEDED');

-- CreateEnum
CREATE TYPE "VoteChoice" AS ENUM ('APPROVE', 'REJECT', 'ABSTAIN');

-- CreateEnum
CREATE TYPE "VoteChannel" AS ENUM ('ELECTRONIC', 'PAPER', 'IN_PERSON');

-- CreateEnum
CREATE TYPE "AccountType" AS ENUM ('BANK', 'CASH');

-- CreateEnum
CREATE TYPE "TxType" AS ENUM ('INCOME', 'EXPENSE', 'TRANSFER');

-- CreateEnum
CREATE TYPE "TxStatus" AS ENUM ('ACTIVE', 'CANCELLED');

-- CreateEnum
CREATE TYPE "ChargeMethod" AS ENUM ('FIXED_PER_UNIT', 'PER_AREA', 'PER_OWNERSHIP_SHARE', 'PER_OCCUPANT', 'EQUAL_SPLIT', 'UNIT_TYPE_COEFFICIENT', 'CONSUMPTION', 'CUSTOM_WEIGHTS', 'MANUAL');

-- CreateEnum
CREATE TYPE "BillingFrequency" AS ENUM ('MONTHLY', 'ANNUAL', 'ONE_TIME');

-- CreateEnum
CREATE TYPE "RoundingMethod" AS ENUM ('HALF_UP_2', 'UP_2', 'DOWN_2');

-- CreateEnum
CREATE TYPE "BatchStatus" AS ENUM ('DRAFT', 'ISSUED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "InvoiceStatus" AS ENUM ('DRAFT', 'ISSUED', 'PAID', 'CANCELLED', 'CORRECTED');

-- CreateEnum
CREATE TYPE "PaymentStatus" AS ENUM ('UNAPPLIED', 'PARTIALLY_APPLIED', 'APPLIED', 'REVERSED');

-- CreateEnum
CREATE TYPE "ExpenseStatus" AS ENUM ('UNPAID', 'PARTIALLY_PAID', 'PAID', 'CANCELLED');

-- CreateEnum
CREATE TYPE "PlanKind" AS ENUM ('MAINTENANCE', 'BUDGET');

-- CreateEnum
CREATE TYPE "PlanStatus" AS ENUM ('DRAFT', 'PROPOSED', 'APPROVED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "PlanItemType" AS ENUM ('INCOME', 'RECURRING_EXPENSE', 'MAINTENANCE_EXPENSE', 'PROJECT', 'RESERVE_ALLOCATION', 'CONTINGENCY', 'PREVENTIVE_MAINTENANCE', 'INSPECTION');

-- CreateEnum
CREATE TYPE "IssueStatus" AS ENUM ('REPORTED', 'TRIAGED', 'AUTHORIZATION_REQUIRED', 'APPROVED', 'OFFERS_REQUESTED', 'CONTRACTOR_SELECTED', 'SCHEDULED', 'IN_PROGRESS', 'COMPLETED', 'VERIFIED', 'INVOICED', 'PAID', 'CLOSED', 'REJECTED');

-- CreateEnum
CREATE TYPE "IssueUrgency" AS ENUM ('LOW', 'NORMAL', 'HIGH', 'EMERGENCY');

-- CreateEnum
CREATE TYPE "DocumentType" AS ENUM ('FOUNDING_AGREEMENT', 'REGISTRY_APPLICATION', 'MEETING_INVITATION', 'AGENDA', 'PROXY_AUTHORIZATION', 'ATTENDANCE_LIST', 'VOTING_LIST', 'MINUTES', 'DECISION', 'ANNUAL_MAINTENANCE_PLAN', 'ANNUAL_FINANCIAL_PLAN', 'ANNUAL_REPORT', 'INVOICE', 'OWNER_STATEMENT', 'PAYMENT_REMINDER', 'DEBT_STATEMENT', 'OFFER_COMPARISON', 'WORK_ORDER', 'COMPLETION_RECORD', 'OTHER');

-- CreateEnum
CREATE TYPE "DocumentStatus" AS ENUM ('DRAFT', 'FINAL');

-- CreateEnum
CREATE TYPE "NotifChannel" AS ENUM ('EMAIL', 'VIBER');

-- CreateEnum
CREATE TYPE "NotifStatus" AS ENUM ('QUEUED', 'SENT', 'DELIVERED', 'SEEN', 'FAILED');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "roles" "Role"[],
    "active" BOOLEAN NOT NULL DEFAULT true,
    "deactivatedAt" TIMESTAMP(3),
    "partyId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Session" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "ip" TEXT,
    "userAgent" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Party" (
    "id" TEXT NOT NULL,
    "kind" "PartyKind" NOT NULL,
    "firstName" TEXT,
    "lastName" TEXT,
    "orgName" TEXT,
    "orgIdNumber" TEXT,
    "email" TEXT,
    "phone" TEXT,
    "address" TEXT,
    "correspondenceAddress" TEXT,
    "note" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Party_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Zev" (
    "id" TEXT NOT NULL,
    "legalName" TEXT NOT NULL,
    "shortName" TEXT,
    "registrationNumber" TEXT,
    "jib" TEXT,
    "registeredAddress" TEXT,
    "city" TEXT,
    "municipality" TEXT,
    "foundingDate" TIMESTAMP(3),
    "registrationDate" TIMESTAMP(3),
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Zev_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Building" (
    "id" TEXT NOT NULL,
    "zevId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "address" TEXT NOT NULL,
    "cadastralRef" TEXT,
    "yearBuilt" INTEGER,
    "floorsCount" INTEGER,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Building_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Entrance" (
    "id" TEXT NOT NULL,
    "buildingId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "address" TEXT,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Entrance_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Unit" (
    "id" TEXT NOT NULL,
    "buildingId" TEXT NOT NULL,
    "entranceId" TEXT,
    "type" "UnitType" NOT NULL,
    "label" TEXT NOT NULL,
    "floor" INTEGER,
    "usableArea" DECIMAL(10,2) NOT NULL,
    "ownershipShare" DECIMAL(9,6) NOT NULL,
    "occupantCount" INTEGER NOT NULL DEFAULT 0,
    "typeCoefficient" DECIMAL(6,3) NOT NULL DEFAULT 1,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "note" TEXT,
    "invoiceRecipientId" TEXT,
    "correspondenceContactId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Unit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OwnershipStake" (
    "id" TEXT NOT NULL,
    "unitId" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "sharePercent" DECIMAL(9,6) NOT NULL,
    "validFrom" TIMESTAMP(3) NOT NULL,
    "validTo" TIMESTAMP(3),
    "acquisitionNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "OwnershipStake_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Occupancy" (
    "id" TEXT NOT NULL,
    "unitId" TEXT NOT NULL,
    "partyId" TEXT NOT NULL,
    "type" "OccupancyType" NOT NULL,
    "headcount" INTEGER NOT NULL DEFAULT 1,
    "validFrom" TIMESTAMP(3) NOT NULL,
    "validTo" TIMESTAMP(3),
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Occupancy_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Proxy" (
    "id" TEXT NOT NULL,
    "grantorId" TEXT NOT NULL,
    "holderId" TEXT NOT NULL,
    "scope" "ProxyScope" NOT NULL,
    "meetingId" TEXT,
    "proposalId" TEXT,
    "documentRef" TEXT,
    "validFrom" TIMESTAMP(3) NOT NULL,
    "validTo" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "revokedReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Proxy_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OfficeTerm" (
    "id" TEXT NOT NULL,
    "role" "OfficeRole" NOT NULL,
    "partyId" TEXT NOT NULL,
    "validFrom" TIMESTAMP(3) NOT NULL,
    "validTo" TIMESTAMP(3),
    "decisionRef" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OfficeTerm_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AllocationGroup" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AllocationGroup_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AllocationGroupMember" (
    "id" TEXT NOT NULL,
    "groupId" TEXT NOT NULL,
    "unitId" TEXT NOT NULL,
    "weight" DECIMAL(12,6) NOT NULL DEFAULT 1,

    CONSTRAINT "AllocationGroupMember_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CommonAsset" (
    "id" TEXT NOT NULL,
    "buildingId" TEXT,
    "kind" "CommonAssetKind" NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "warrantyUntil" TIMESTAMP(3),
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CommonAsset_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Meeting" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "type" "MeetingType" NOT NULL,
    "status" "MeetingStatus" NOT NULL DEFAULT 'DRAFT',
    "location" TEXT,
    "scheduledAt" TIMESTAMP(3),
    "eVoteOpensAt" TIMESTAMP(3),
    "eVoteClosesAt" TIMESTAMP(3),
    "discussionNotes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Meeting_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AgendaItem" (
    "id" TEXT NOT NULL,
    "meetingId" TEXT NOT NULL,
    "order" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "note" TEXT,

    CONSTRAINT "AgendaItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Attendance" (
    "id" TEXT NOT NULL,
    "meetingId" TEXT NOT NULL,
    "partyId" TEXT NOT NULL,
    "present" BOOLEAN NOT NULL DEFAULT true,
    "viaProxyId" TEXT,
    "note" TEXT,

    CONSTRAINT "Attendance_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VotingRule" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "quorumType" "QuorumType" NOT NULL,
    "quorumPercent" DECIMAL(6,3),
    "majorityType" "MajorityType" NOT NULL,
    "majorityPercent" DECIMAL(6,3),
    "weightMethod" "WeightMethod" NOT NULL,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "VotingRule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Proposal" (
    "id" TEXT NOT NULL,
    "meetingId" TEXT NOT NULL,
    "agendaItemId" TEXT,
    "code" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "supersedesId" TEXT,
    "title" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "rationale" TEXT,
    "financialImpact" DECIMAL(14,2),
    "scopeType" "ScopeType" NOT NULL DEFAULT 'ZEV',
    "buildingId" TEXT,
    "entranceId" TEXT,
    "allocationGroupId" TEXT,
    "status" "ProposalStatus" NOT NULL DEFAULT 'DRAFT',
    "votingRuleId" TEXT,
    "ruleSnapshot" JSONB,
    "contentHash" TEXT,
    "votingOpensAt" TIMESTAMP(3),
    "votingClosesAt" TIMESTAMP(3),
    "frozenAt" TIMESTAMP(3),
    "resultSummary" JSONB,
    "decisionNumber" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Proposal_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProposalUnit" (
    "id" TEXT NOT NULL,
    "proposalId" TEXT NOT NULL,
    "unitId" TEXT NOT NULL,

    CONSTRAINT "ProposalUnit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EligibleVoter" (
    "id" TEXT NOT NULL,
    "proposalId" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "proxyId" TEXT,
    "proxyRecordId" TEXT,
    "weight" DECIMAL(14,6) NOT NULL,
    "basis" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EligibleVoter_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ApprovalToken" (
    "id" TEXT NOT NULL,
    "eligibleVoterId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "verificationHash" TEXT NOT NULL,
    "status" "TokenStatus" NOT NULL DEFAULT 'ACTIVE',
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "issuedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deliveredVia" TEXT,
    "openedAt" TIMESTAMP(3),
    "usedAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "revokedReason" TEXT,
    "replacedById" TEXT,
    "failedAttempts" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "ApprovalToken_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Vote" (
    "id" TEXT NOT NULL,
    "proposalId" TEXT NOT NULL,
    "proposalVersion" INTEGER NOT NULL,
    "eligibleVoterId" TEXT NOT NULL,
    "voterId" TEXT NOT NULL,
    "representedId" TEXT,
    "proxyRecordId" TEXT,
    "choice" "VoteChoice" NOT NULL,
    "channel" "VoteChannel" NOT NULL,
    "weight" DECIMAL(14,6) NOT NULL,
    "countsForQuorum" BOOLEAN NOT NULL DEFAULT true,
    "tokenId" TEXT,
    "proposalHash" TEXT NOT NULL,
    "acknowledgementText" TEXT NOT NULL,
    "ipHash" TEXT,
    "userAgent" TEXT,
    "issuedAt" TIMESTAMP(3),
    "openedAt" TIMESTAMP(3),
    "confirmedAt" TIMESTAMP(3),
    "submittedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deliveryChannel" TEXT,
    "invalid" BOOLEAN NOT NULL DEFAULT false,
    "invalidReason" TEXT,
    "correctionOfId" TEXT,
    "correctionReason" TEXT,
    "correctionAuthority" TEXT,

    CONSTRAINT "Vote_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MoneyAccount" (
    "id" TEXT NOT NULL,
    "zevId" TEXT NOT NULL,
    "type" "AccountType" NOT NULL,
    "name" TEXT NOT NULL,
    "bankName" TEXT,
    "iban" TEXT,
    "openingBalance" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "openingDate" TIMESTAMP(3) NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MoneyAccount_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TransactionCategory" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "kind" TEXT NOT NULL,

    CONSTRAINT "TransactionCategory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FinTransaction" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "type" "TxType" NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'BAM',
    "counterpartyName" TEXT,
    "categoryId" TEXT,
    "paymentMethod" TEXT,
    "docRef" TEXT,
    "description" TEXT,
    "buildingId" TEXT,
    "entranceId" TEXT,
    "projectId" TEXT,
    "planItemId" TEXT,
    "expenseId" TEXT,
    "paymentId" TEXT,
    "isReserveFund" BOOLEAN NOT NULL DEFAULT false,
    "status" "TxStatus" NOT NULL DEFAULT 'ACTIVE',
    "cancelledAt" TIMESTAMP(3),
    "cancelReason" TEXT,
    "cancelOfId" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FinTransaction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ChargeItem" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "scopeType" "ScopeType" NOT NULL DEFAULT 'ZEV',
    "buildingId" TEXT,
    "entranceId" TEXT,
    "allocationGroupId" TEXT,
    "method" "ChargeMethod" NOT NULL,
    "rate" DECIMAL(14,6),
    "effectiveFrom" TIMESTAMP(3) NOT NULL,
    "effectiveTo" TIMESTAMP(3),
    "frequency" "BillingFrequency" NOT NULL DEFAULT 'MONTHLY',
    "dueDayOfMonth" INTEGER NOT NULL DEFAULT 15,
    "rounding" "RoundingMethod" NOT NULL DEFAULT 'HALF_UP_2',
    "minAmount" DECIMAL(14,2),
    "maxAmount" DECIMAL(14,2),
    "displayOrder" INTEGER NOT NULL DEFAULT 0,
    "isReserveFund" BOOLEAN NOT NULL DEFAULT false,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ChargeItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ChargeUnitOverride" (
    "id" TEXT NOT NULL,
    "chargeItemId" TEXT NOT NULL,
    "unitId" TEXT NOT NULL,
    "exempt" BOOLEAN NOT NULL DEFAULT false,
    "customWeight" DECIMAL(12,6),
    "manualAmount" DECIMAL(14,2),

    CONSTRAINT "ChargeUnitOverride_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MeterReading" (
    "id" TEXT NOT NULL,
    "chargeItemId" TEXT NOT NULL,
    "unitId" TEXT NOT NULL,
    "period" TEXT NOT NULL,
    "quantity" DECIMAL(14,3) NOT NULL,
    "enteredById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MeterReading_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InvoiceBatch" (
    "id" TEXT NOT NULL,
    "period" TEXT NOT NULL,
    "description" TEXT,
    "status" "BatchStatus" NOT NULL DEFAULT 'DRAFT',
    "previewData" JSONB,
    "issuedAt" TIMESTAMP(3),
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "InvoiceBatch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Invoice" (
    "id" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "batchId" TEXT,
    "unitId" TEXT NOT NULL,
    "debtorId" TEXT NOT NULL,
    "debtorShare" DECIMAL(9,6) NOT NULL DEFAULT 100,
    "issueDate" TIMESTAMP(3) NOT NULL,
    "dueDate" TIMESTAMP(3) NOT NULL,
    "periodLabel" TEXT,
    "total" DECIMAL(14,2) NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'BAM',
    "status" "InvoiceStatus" NOT NULL DEFAULT 'DRAFT',
    "paymentReference" TEXT,
    "cancelledAt" TIMESTAMP(3),
    "cancelReason" TEXT,
    "correctionOfId" TEXT,
    "documentId" TEXT,
    "deliveryStatus" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Invoice_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InvoiceLine" (
    "id" TEXT NOT NULL,
    "invoiceId" TEXT NOT NULL,
    "chargeItemId" TEXT,
    "description" TEXT NOT NULL,
    "calcSnapshot" JSONB NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "order" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "InvoiceLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BankImportBatch" (
    "id" TEXT NOT NULL,
    "filename" TEXT NOT NULL,
    "mapping" JSONB NOT NULL,
    "importedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "importedById" TEXT,

    CONSTRAINT "BankImportBatch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Payment" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'BAM',
    "payerId" TEXT,
    "payerNameRaw" TEXT,
    "reference" TEXT,
    "method" TEXT,
    "importBatchId" TEXT,
    "status" "PaymentStatus" NOT NULL DEFAULT 'UNAPPLIED',
    "note" TEXT,
    "reversedAt" TIMESTAMP(3),
    "reversalReason" TEXT,
    "reversalOfId" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Payment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PaymentAllocation" (
    "id" TEXT NOT NULL,
    "paymentId" TEXT NOT NULL,
    "invoiceId" TEXT NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "reversalOfId" TEXT,
    "reason" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PaymentAllocation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BalanceCorrection" (
    "id" TEXT NOT NULL,
    "partyId" TEXT NOT NULL,
    "unitId" TEXT,
    "amount" DECIMAL(14,2) NOT NULL,
    "reason" TEXT NOT NULL,
    "authority" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BalanceCorrection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Supplier" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "jib" TEXT,
    "address" TEXT,
    "iban" TEXT,
    "contactName" TEXT,
    "email" TEXT,
    "phone" TEXT,
    "note" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Supplier_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Expense" (
    "id" TEXT NOT NULL,
    "supplierId" TEXT,
    "invoiceNumber" TEXT,
    "invoiceDate" TIMESTAMP(3),
    "categoryId" TEXT,
    "amount" DECIMAL(14,2) NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'BAM',
    "dueDate" TIMESTAMP(3),
    "status" "ExpenseStatus" NOT NULL DEFAULT 'UNPAID',
    "paidDate" TIMESTAMP(3),
    "paidAmount" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "buildingId" TEXT,
    "entranceId" TEXT,
    "projectId" TEXT,
    "planItemId" TEXT,
    "maintenanceIssueId" TEXT,
    "workOrderId" TEXT,
    "description" TEXT,
    "recurring" BOOLEAN NOT NULL DEFAULT false,
    "recurrenceRule" TEXT,
    "cancelledAt" TIMESTAMP(3),
    "cancelReason" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Expense_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AnnualPlan" (
    "id" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "kind" "PlanKind" NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "status" "PlanStatus" NOT NULL DEFAULT 'DRAFT',
    "title" TEXT NOT NULL,
    "note" TEXT,
    "approvedByProposalId" TEXT,
    "approvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AnnualPlan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PlanItem" (
    "id" TEXT NOT NULL,
    "planId" TEXT NOT NULL,
    "type" "PlanItemType" NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "plannedAmount" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "month" INTEGER,
    "scopeType" "ScopeType" NOT NULL DEFAULT 'ZEV',
    "buildingId" TEXT,
    "entranceId" TEXT,
    "projectId" TEXT,
    "categoryName" TEXT,
    "scheduledDate" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PlanItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PlanItemUnit" (
    "id" TEXT NOT NULL,
    "planItemId" TEXT NOT NULL,
    "unitId" TEXT NOT NULL,

    CONSTRAINT "PlanItemUnit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Project" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "status" TEXT NOT NULL DEFAULT 'PLANNED',
    "estimatedCost" DECIMAL(14,2),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Project_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MaintenanceIssue" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "reporterId" TEXT NOT NULL,
    "buildingId" TEXT,
    "entranceId" TEXT,
    "unitId" TEXT,
    "locationNote" TEXT,
    "category" TEXT,
    "urgency" "IssueUrgency" NOT NULL DEFAULT 'NORMAL',
    "isEmergency" BOOLEAN NOT NULL DEFAULT false,
    "safetyImpact" BOOLEAN NOT NULL DEFAULT false,
    "status" "IssueStatus" NOT NULL DEFAULT 'REPORTED',
    "responsibleId" TEXT,
    "approvalProposalId" TEXT,
    "emergencyReason" TEXT,
    "emergencyAuthorizedBy" TEXT,
    "emergencyAuthority" TEXT,
    "emergencyRatifiedRef" TEXT,
    "estimatedCost" DECIMAL(14,2),
    "actualCost" DECIMAL(14,2),
    "warrantyUntil" TIMESTAMP(3),
    "recurrenceNote" TEXT,
    "planItemId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MaintenanceIssue_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IssueComment" (
    "id" TEXT NOT NULL,
    "issueId" TEXT NOT NULL,
    "authorId" TEXT,
    "text" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "IssueComment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IssueStatusEvent" (
    "id" TEXT NOT NULL,
    "issueId" TEXT NOT NULL,
    "from" "IssueStatus",
    "to" "IssueStatus" NOT NULL,
    "actorId" TEXT,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "IssueStatusEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ContractorOffer" (
    "id" TEXT NOT NULL,
    "issueId" TEXT NOT NULL,
    "supplierId" TEXT NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "description" TEXT,
    "validUntil" TIMESTAMP(3),
    "selected" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ContractorOffer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorkOrder" (
    "id" TEXT NOT NULL,
    "issueId" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "supplierId" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "scheduledFrom" TIMESTAMP(3),
    "scheduledTo" TIMESTAMP(3),
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "completionNote" TEXT,
    "completedAt" TIMESTAMP(3),
    "documentId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WorkOrder_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Document" (
    "id" TEXT NOT NULL,
    "type" "DocumentType" NOT NULL,
    "number" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "status" "DocumentStatus" NOT NULL DEFAULT 'DRAFT',
    "version" INTEGER NOT NULL DEFAULT 1,
    "sourceType" TEXT,
    "sourceId" TEXT,
    "filePath" TEXT NOT NULL,
    "sha256" TEXT NOT NULL,
    "publishedToOwners" BOOLEAN NOT NULL DEFAULT false,
    "createdById" TEXT,
    "finalizedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Document_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Attachment" (
    "id" TEXT NOT NULL,
    "filename" TEXT NOT NULL,
    "mime" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "filePath" TEXT NOT NULL,
    "sha256" TEXT,
    "uploadedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Attachment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NotificationMessage" (
    "id" TEXT NOT NULL,
    "channel" "NotifChannel" NOT NULL,
    "recipientId" TEXT,
    "toAddress" TEXT NOT NULL,
    "template" TEXT,
    "subject" TEXT,
    "body" TEXT NOT NULL,
    "status" "NotifStatus" NOT NULL DEFAULT 'QUEUED',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "lastError" TEXT,
    "events" JSONB,
    "relatedType" TEXT,
    "relatedId" TEXT,
    "sentAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "NotificationMessage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ViberSubscriber" (
    "id" TEXT NOT NULL,
    "partyId" TEXT NOT NULL,
    "viberId" TEXT NOT NULL,
    "optIn" BOOLEAN NOT NULL DEFAULT false,
    "optInAt" TIMESTAMP(3),
    "optOutAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ViberSubscriber_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditEvent" (
    "id" TEXT NOT NULL,
    "actorId" TEXT,
    "actorLabel" TEXT,
    "action" TEXT NOT NULL,
    "targetType" TEXT NOT NULL,
    "targetId" TEXT,
    "before" JSONB,
    "after" JSONB,
    "reason" TEXT,
    "ipHash" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Setting" (
    "key" TEXT NOT NULL,
    "value" JSONB NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Setting_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "_ProposalAttachments" (
    "A" TEXT NOT NULL,
    "B" TEXT NOT NULL,

    CONSTRAINT "_ProposalAttachments_AB_pkey" PRIMARY KEY ("A","B")
);

-- CreateTable
CREATE TABLE "_ExpenseAttachments" (
    "A" TEXT NOT NULL,
    "B" TEXT NOT NULL,

    CONSTRAINT "_ExpenseAttachments_AB_pkey" PRIMARY KEY ("A","B")
);

-- CreateTable
CREATE TABLE "_IssueAttachments" (
    "A" TEXT NOT NULL,
    "B" TEXT NOT NULL,

    CONSTRAINT "_IssueAttachments_AB_pkey" PRIMARY KEY ("A","B")
);

-- CreateTable
CREATE TABLE "_TxAttachments" (
    "A" TEXT NOT NULL,
    "B" TEXT NOT NULL,

    CONSTRAINT "_TxAttachments_AB_pkey" PRIMARY KEY ("A","B")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "User_partyId_key" ON "User"("partyId");

-- CreateIndex
CREATE INDEX "Session_userId_idx" ON "Session"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "Unit_buildingId_label_key" ON "Unit"("buildingId", "label");

-- CreateIndex
CREATE INDEX "OwnershipStake_unitId_validFrom_idx" ON "OwnershipStake"("unitId", "validFrom");

-- CreateIndex
CREATE INDEX "OwnershipStake_ownerId_idx" ON "OwnershipStake"("ownerId");

-- CreateIndex
CREATE INDEX "Occupancy_unitId_idx" ON "Occupancy"("unitId");

-- CreateIndex
CREATE INDEX "Proxy_grantorId_idx" ON "Proxy"("grantorId");

-- CreateIndex
CREATE UNIQUE INDEX "AllocationGroup_name_key" ON "AllocationGroup"("name");

-- CreateIndex
CREATE UNIQUE INDEX "AllocationGroupMember_groupId_unitId_key" ON "AllocationGroupMember"("groupId", "unitId");

-- CreateIndex
CREATE UNIQUE INDEX "AgendaItem_meetingId_order_key" ON "AgendaItem"("meetingId", "order");

-- CreateIndex
CREATE UNIQUE INDEX "Attendance_meetingId_partyId_key" ON "Attendance"("meetingId", "partyId");

-- CreateIndex
CREATE UNIQUE INDEX "VotingRule_name_key" ON "VotingRule"("name");

-- CreateIndex
CREATE UNIQUE INDEX "Proposal_supersedesId_key" ON "Proposal"("supersedesId");

-- CreateIndex
CREATE UNIQUE INDEX "Proposal_code_version_key" ON "Proposal"("code", "version");

-- CreateIndex
CREATE UNIQUE INDEX "ProposalUnit_proposalId_unitId_key" ON "ProposalUnit"("proposalId", "unitId");

-- CreateIndex
CREATE UNIQUE INDEX "EligibleVoter_proposalId_ownerId_key" ON "EligibleVoter"("proposalId", "ownerId");

-- CreateIndex
CREATE UNIQUE INDEX "ApprovalToken_tokenHash_key" ON "ApprovalToken"("tokenHash");

-- CreateIndex
CREATE UNIQUE INDEX "ApprovalToken_replacedById_key" ON "ApprovalToken"("replacedById");

-- CreateIndex
CREATE INDEX "ApprovalToken_eligibleVoterId_idx" ON "ApprovalToken"("eligibleVoterId");

-- CreateIndex
CREATE UNIQUE INDEX "Vote_tokenId_key" ON "Vote"("tokenId");

-- CreateIndex
CREATE UNIQUE INDEX "Vote_correctionOfId_key" ON "Vote"("correctionOfId");

-- CreateIndex
CREATE INDEX "Vote_proposalId_idx" ON "Vote"("proposalId");

-- CreateIndex
CREATE UNIQUE INDEX "Vote_proposalId_eligibleVoterId_correctionOfId_key" ON "Vote"("proposalId", "eligibleVoterId", "correctionOfId");

-- CreateIndex
CREATE UNIQUE INDEX "TransactionCategory_name_key" ON "TransactionCategory"("name");

-- CreateIndex
CREATE UNIQUE INDEX "FinTransaction_paymentId_key" ON "FinTransaction"("paymentId");

-- CreateIndex
CREATE UNIQUE INDEX "FinTransaction_cancelOfId_key" ON "FinTransaction"("cancelOfId");

-- CreateIndex
CREATE INDEX "FinTransaction_accountId_date_idx" ON "FinTransaction"("accountId", "date");

-- CreateIndex
CREATE UNIQUE INDEX "ChargeUnitOverride_chargeItemId_unitId_key" ON "ChargeUnitOverride"("chargeItemId", "unitId");

-- CreateIndex
CREATE UNIQUE INDEX "MeterReading_chargeItemId_unitId_period_key" ON "MeterReading"("chargeItemId", "unitId", "period");

-- CreateIndex
CREATE UNIQUE INDEX "InvoiceBatch_period_status_key" ON "InvoiceBatch"("period", "status");

-- CreateIndex
CREATE UNIQUE INDEX "Invoice_number_key" ON "Invoice"("number");

-- CreateIndex
CREATE UNIQUE INDEX "Invoice_correctionOfId_key" ON "Invoice"("correctionOfId");

-- CreateIndex
CREATE INDEX "Invoice_debtorId_idx" ON "Invoice"("debtorId");

-- CreateIndex
CREATE INDEX "Invoice_unitId_idx" ON "Invoice"("unitId");

-- CreateIndex
CREATE UNIQUE INDEX "Payment_reversalOfId_key" ON "Payment"("reversalOfId");

-- CreateIndex
CREATE INDEX "Payment_payerId_idx" ON "Payment"("payerId");

-- CreateIndex
CREATE UNIQUE INDEX "PaymentAllocation_reversalOfId_key" ON "PaymentAllocation"("reversalOfId");

-- CreateIndex
CREATE INDEX "PaymentAllocation_invoiceId_idx" ON "PaymentAllocation"("invoiceId");

-- CreateIndex
CREATE INDEX "PaymentAllocation_paymentId_idx" ON "PaymentAllocation"("paymentId");

-- CreateIndex
CREATE INDEX "Expense_supplierId_invoiceNumber_idx" ON "Expense"("supplierId", "invoiceNumber");

-- CreateIndex
CREATE UNIQUE INDEX "AnnualPlan_year_kind_version_key" ON "AnnualPlan"("year", "kind", "version");

-- CreateIndex
CREATE UNIQUE INDEX "PlanItemUnit_planItemId_unitId_key" ON "PlanItemUnit"("planItemId", "unitId");

-- CreateIndex
CREATE UNIQUE INDEX "WorkOrder_number_key" ON "WorkOrder"("number");

-- CreateIndex
CREATE INDEX "Document_sourceType_sourceId_idx" ON "Document"("sourceType", "sourceId");

-- CreateIndex
CREATE UNIQUE INDEX "Document_type_number_version_key" ON "Document"("type", "number", "version");

-- CreateIndex
CREATE INDEX "NotificationMessage_recipientId_idx" ON "NotificationMessage"("recipientId");

-- CreateIndex
CREATE INDEX "NotificationMessage_relatedType_relatedId_idx" ON "NotificationMessage"("relatedType", "relatedId");

-- CreateIndex
CREATE UNIQUE INDEX "ViberSubscriber_partyId_key" ON "ViberSubscriber"("partyId");

-- CreateIndex
CREATE UNIQUE INDEX "ViberSubscriber_viberId_key" ON "ViberSubscriber"("viberId");

-- CreateIndex
CREATE INDEX "AuditEvent_targetType_targetId_idx" ON "AuditEvent"("targetType", "targetId");

-- CreateIndex
CREATE INDEX "AuditEvent_action_idx" ON "AuditEvent"("action");

-- CreateIndex
CREATE INDEX "_ProposalAttachments_B_index" ON "_ProposalAttachments"("B");

-- CreateIndex
CREATE INDEX "_ExpenseAttachments_B_index" ON "_ExpenseAttachments"("B");

-- CreateIndex
CREATE INDEX "_IssueAttachments_B_index" ON "_IssueAttachments"("B");

-- CreateIndex
CREATE INDEX "_TxAttachments_B_index" ON "_TxAttachments"("B");

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_partyId_fkey" FOREIGN KEY ("partyId") REFERENCES "Party"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Session" ADD CONSTRAINT "Session_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Building" ADD CONSTRAINT "Building_zevId_fkey" FOREIGN KEY ("zevId") REFERENCES "Zev"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Entrance" ADD CONSTRAINT "Entrance_buildingId_fkey" FOREIGN KEY ("buildingId") REFERENCES "Building"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Unit" ADD CONSTRAINT "Unit_buildingId_fkey" FOREIGN KEY ("buildingId") REFERENCES "Building"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Unit" ADD CONSTRAINT "Unit_entranceId_fkey" FOREIGN KEY ("entranceId") REFERENCES "Entrance"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Unit" ADD CONSTRAINT "Unit_invoiceRecipientId_fkey" FOREIGN KEY ("invoiceRecipientId") REFERENCES "Party"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Unit" ADD CONSTRAINT "Unit_correspondenceContactId_fkey" FOREIGN KEY ("correspondenceContactId") REFERENCES "Party"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OwnershipStake" ADD CONSTRAINT "OwnershipStake_unitId_fkey" FOREIGN KEY ("unitId") REFERENCES "Unit"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OwnershipStake" ADD CONSTRAINT "OwnershipStake_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "Party"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Occupancy" ADD CONSTRAINT "Occupancy_unitId_fkey" FOREIGN KEY ("unitId") REFERENCES "Unit"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Occupancy" ADD CONSTRAINT "Occupancy_partyId_fkey" FOREIGN KEY ("partyId") REFERENCES "Party"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Proxy" ADD CONSTRAINT "Proxy_grantorId_fkey" FOREIGN KEY ("grantorId") REFERENCES "Party"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Proxy" ADD CONSTRAINT "Proxy_holderId_fkey" FOREIGN KEY ("holderId") REFERENCES "Party"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Proxy" ADD CONSTRAINT "Proxy_meetingId_fkey" FOREIGN KEY ("meetingId") REFERENCES "Meeting"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OfficeTerm" ADD CONSTRAINT "OfficeTerm_partyId_fkey" FOREIGN KEY ("partyId") REFERENCES "Party"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AllocationGroupMember" ADD CONSTRAINT "AllocationGroupMember_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "AllocationGroup"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AllocationGroupMember" ADD CONSTRAINT "AllocationGroupMember_unitId_fkey" FOREIGN KEY ("unitId") REFERENCES "Unit"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CommonAsset" ADD CONSTRAINT "CommonAsset_buildingId_fkey" FOREIGN KEY ("buildingId") REFERENCES "Building"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgendaItem" ADD CONSTRAINT "AgendaItem_meetingId_fkey" FOREIGN KEY ("meetingId") REFERENCES "Meeting"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Attendance" ADD CONSTRAINT "Attendance_meetingId_fkey" FOREIGN KEY ("meetingId") REFERENCES "Meeting"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Attendance" ADD CONSTRAINT "Attendance_partyId_fkey" FOREIGN KEY ("partyId") REFERENCES "Party"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Proposal" ADD CONSTRAINT "Proposal_meetingId_fkey" FOREIGN KEY ("meetingId") REFERENCES "Meeting"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Proposal" ADD CONSTRAINT "Proposal_agendaItemId_fkey" FOREIGN KEY ("agendaItemId") REFERENCES "AgendaItem"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Proposal" ADD CONSTRAINT "Proposal_supersedesId_fkey" FOREIGN KEY ("supersedesId") REFERENCES "Proposal"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Proposal" ADD CONSTRAINT "Proposal_votingRuleId_fkey" FOREIGN KEY ("votingRuleId") REFERENCES "VotingRule"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProposalUnit" ADD CONSTRAINT "ProposalUnit_proposalId_fkey" FOREIGN KEY ("proposalId") REFERENCES "Proposal"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProposalUnit" ADD CONSTRAINT "ProposalUnit_unitId_fkey" FOREIGN KEY ("unitId") REFERENCES "Unit"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EligibleVoter" ADD CONSTRAINT "EligibleVoter_proposalId_fkey" FOREIGN KEY ("proposalId") REFERENCES "Proposal"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EligibleVoter" ADD CONSTRAINT "EligibleVoter_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "Party"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EligibleVoter" ADD CONSTRAINT "EligibleVoter_proxyId_fkey" FOREIGN KEY ("proxyId") REFERENCES "Party"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApprovalToken" ADD CONSTRAINT "ApprovalToken_eligibleVoterId_fkey" FOREIGN KEY ("eligibleVoterId") REFERENCES "EligibleVoter"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApprovalToken" ADD CONSTRAINT "ApprovalToken_replacedById_fkey" FOREIGN KEY ("replacedById") REFERENCES "ApprovalToken"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Vote" ADD CONSTRAINT "Vote_proposalId_fkey" FOREIGN KEY ("proposalId") REFERENCES "Proposal"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Vote" ADD CONSTRAINT "Vote_eligibleVoterId_fkey" FOREIGN KEY ("eligibleVoterId") REFERENCES "EligibleVoter"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Vote" ADD CONSTRAINT "Vote_voterId_fkey" FOREIGN KEY ("voterId") REFERENCES "Party"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Vote" ADD CONSTRAINT "Vote_representedId_fkey" FOREIGN KEY ("representedId") REFERENCES "Party"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Vote" ADD CONSTRAINT "Vote_tokenId_fkey" FOREIGN KEY ("tokenId") REFERENCES "ApprovalToken"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Vote" ADD CONSTRAINT "Vote_correctionOfId_fkey" FOREIGN KEY ("correctionOfId") REFERENCES "Vote"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MoneyAccount" ADD CONSTRAINT "MoneyAccount_zevId_fkey" FOREIGN KEY ("zevId") REFERENCES "Zev"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FinTransaction" ADD CONSTRAINT "FinTransaction_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "MoneyAccount"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FinTransaction" ADD CONSTRAINT "FinTransaction_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "TransactionCategory"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FinTransaction" ADD CONSTRAINT "FinTransaction_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "Payment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FinTransaction" ADD CONSTRAINT "FinTransaction_cancelOfId_fkey" FOREIGN KEY ("cancelOfId") REFERENCES "FinTransaction"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChargeUnitOverride" ADD CONSTRAINT "ChargeUnitOverride_chargeItemId_fkey" FOREIGN KEY ("chargeItemId") REFERENCES "ChargeItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChargeUnitOverride" ADD CONSTRAINT "ChargeUnitOverride_unitId_fkey" FOREIGN KEY ("unitId") REFERENCES "Unit"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MeterReading" ADD CONSTRAINT "MeterReading_chargeItemId_fkey" FOREIGN KEY ("chargeItemId") REFERENCES "ChargeItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MeterReading" ADD CONSTRAINT "MeterReading_unitId_fkey" FOREIGN KEY ("unitId") REFERENCES "Unit"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "InvoiceBatch"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_unitId_fkey" FOREIGN KEY ("unitId") REFERENCES "Unit"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_debtorId_fkey" FOREIGN KEY ("debtorId") REFERENCES "Party"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_correctionOfId_fkey" FOREIGN KEY ("correctionOfId") REFERENCES "Invoice"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InvoiceLine" ADD CONSTRAINT "InvoiceLine_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "Invoice"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InvoiceLine" ADD CONSTRAINT "InvoiceLine_chargeItemId_fkey" FOREIGN KEY ("chargeItemId") REFERENCES "ChargeItem"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "MoneyAccount"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_payerId_fkey" FOREIGN KEY ("payerId") REFERENCES "Party"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_importBatchId_fkey" FOREIGN KEY ("importBatchId") REFERENCES "BankImportBatch"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_reversalOfId_fkey" FOREIGN KEY ("reversalOfId") REFERENCES "Payment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentAllocation" ADD CONSTRAINT "PaymentAllocation_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "Payment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentAllocation" ADD CONSTRAINT "PaymentAllocation_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "Invoice"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BalanceCorrection" ADD CONSTRAINT "BalanceCorrection_partyId_fkey" FOREIGN KEY ("partyId") REFERENCES "Party"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Expense" ADD CONSTRAINT "Expense_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Expense" ADD CONSTRAINT "Expense_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "TransactionCategory"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Expense" ADD CONSTRAINT "Expense_maintenanceIssueId_fkey" FOREIGN KEY ("maintenanceIssueId") REFERENCES "MaintenanceIssue"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlanItem" ADD CONSTRAINT "PlanItem_planId_fkey" FOREIGN KEY ("planId") REFERENCES "AnnualPlan"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlanItemUnit" ADD CONSTRAINT "PlanItemUnit_planItemId_fkey" FOREIGN KEY ("planItemId") REFERENCES "PlanItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlanItemUnit" ADD CONSTRAINT "PlanItemUnit_unitId_fkey" FOREIGN KEY ("unitId") REFERENCES "Unit"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MaintenanceIssue" ADD CONSTRAINT "MaintenanceIssue_reporterId_fkey" FOREIGN KEY ("reporterId") REFERENCES "Party"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MaintenanceIssue" ADD CONSTRAINT "MaintenanceIssue_unitId_fkey" FOREIGN KEY ("unitId") REFERENCES "Unit"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MaintenanceIssue" ADD CONSTRAINT "MaintenanceIssue_responsibleId_fkey" FOREIGN KEY ("responsibleId") REFERENCES "Party"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IssueComment" ADD CONSTRAINT "IssueComment_issueId_fkey" FOREIGN KEY ("issueId") REFERENCES "MaintenanceIssue"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IssueStatusEvent" ADD CONSTRAINT "IssueStatusEvent_issueId_fkey" FOREIGN KEY ("issueId") REFERENCES "MaintenanceIssue"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContractorOffer" ADD CONSTRAINT "ContractorOffer_issueId_fkey" FOREIGN KEY ("issueId") REFERENCES "MaintenanceIssue"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContractorOffer" ADD CONSTRAINT "ContractorOffer_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkOrder" ADD CONSTRAINT "WorkOrder_issueId_fkey" FOREIGN KEY ("issueId") REFERENCES "MaintenanceIssue"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkOrder" ADD CONSTRAINT "WorkOrder_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NotificationMessage" ADD CONSTRAINT "NotificationMessage_recipientId_fkey" FOREIGN KEY ("recipientId") REFERENCES "Party"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ViberSubscriber" ADD CONSTRAINT "ViberSubscriber_partyId_fkey" FOREIGN KEY ("partyId") REFERENCES "Party"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_ProposalAttachments" ADD CONSTRAINT "_ProposalAttachments_A_fkey" FOREIGN KEY ("A") REFERENCES "Attachment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_ProposalAttachments" ADD CONSTRAINT "_ProposalAttachments_B_fkey" FOREIGN KEY ("B") REFERENCES "Proposal"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_ExpenseAttachments" ADD CONSTRAINT "_ExpenseAttachments_A_fkey" FOREIGN KEY ("A") REFERENCES "Attachment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_ExpenseAttachments" ADD CONSTRAINT "_ExpenseAttachments_B_fkey" FOREIGN KEY ("B") REFERENCES "Expense"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_IssueAttachments" ADD CONSTRAINT "_IssueAttachments_A_fkey" FOREIGN KEY ("A") REFERENCES "Attachment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_IssueAttachments" ADD CONSTRAINT "_IssueAttachments_B_fkey" FOREIGN KEY ("B") REFERENCES "MaintenanceIssue"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_TxAttachments" ADD CONSTRAINT "_TxAttachments_A_fkey" FOREIGN KEY ("A") REFERENCES "Attachment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_TxAttachments" ADD CONSTRAINT "_TxAttachments_B_fkey" FOREIGN KEY ("B") REFERENCES "FinTransaction"("id") ON DELETE CASCADE ON UPDATE CASCADE;
