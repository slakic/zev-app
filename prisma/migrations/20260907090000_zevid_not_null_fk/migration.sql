-- zevId columns: NOT NULL + real FK to Zev (see docs/multitenancy-plan.md §6.3).
--
-- Builds on the soft columns added in 20260907070201_add_multitenancy_foundations.
-- Scope (explicitly agreed with the user): DB-level integrity only — flip the 32
-- pre-existing "soft" zevId columns to NOT NULL with a real @relation FK to Zev, and
-- tenant-scope the handful of existing unique constraints that were not zevId-aware
-- (spotted while preparing this migration — same class of gap, fixed together rather
-- than left half-done). The service layer still does not set zevId explicitly on any
-- write (that is the separate, larger step 5) — so every column below gets a
-- temporary DB-level default that resolves to the single pre-existing tenant, via a
-- small SQL function. This keeps every existing .create() call working unchanged.
-- The default is a stopgap for a still-single-tenant app: it must be dropped once
-- step 5 makes every write path set zevId explicitly from actor.zevId, otherwise a
-- second tenant's writes would silently fall back to tenant #1 instead of failing
-- loudly (see the banner comment on the Zev model in schema.prisma).
--
-- Hand-written for the same reason as the other non-init migrations in this project:
-- the bundled schema-engine-wasm cannot introspect this database (PL/pgSQL trigger
-- functions from append_only_guards break its Postgres catalog scan).

-- A STABLE function (not a literal) so the default is correct in every environment
-- (sandbox, dev, production all have a different Zev.id) — matches the dynamic
-- "earliest Zev" subquery already used by the step 1-2 data backfill. Postgres column
-- DEFAULT clauses cannot contain an inline subquery, so it is wrapped in a function.
CREATE FUNCTION "default_zev_id"() RETURNS TEXT AS $$
  SELECT "id" FROM "Zev" ORDER BY "createdAt" ASC LIMIT 1;
$$ LANGUAGE sql STABLE;

-- Defensive backfill: fills any zevId that is still NULL (e.g. a row created via
-- `db:reset && db:seed` in the window between the previous migration and this one,
-- back when the column had no default yet). A no-op wherever step 1-2's backfill
-- already covered every row, which is the common case.

UPDATE "Party" SET "zevId" = "default_zev_id"() WHERE "zevId" IS NULL;
UPDATE "Entrance" SET "zevId" = "default_zev_id"() WHERE "zevId" IS NULL;
UPDATE "Unit" SET "zevId" = "default_zev_id"() WHERE "zevId" IS NULL;
UPDATE "OwnershipStake" SET "zevId" = "default_zev_id"() WHERE "zevId" IS NULL;
UPDATE "Occupancy" SET "zevId" = "default_zev_id"() WHERE "zevId" IS NULL;
UPDATE "Proxy" SET "zevId" = "default_zev_id"() WHERE "zevId" IS NULL;
UPDATE "OfficeTerm" SET "zevId" = "default_zev_id"() WHERE "zevId" IS NULL;
UPDATE "AllocationGroup" SET "zevId" = "default_zev_id"() WHERE "zevId" IS NULL;
UPDATE "CommonAsset" SET "zevId" = "default_zev_id"() WHERE "zevId" IS NULL;
UPDATE "Meeting" SET "zevId" = "default_zev_id"() WHERE "zevId" IS NULL;
UPDATE "VotingRule" SET "zevId" = "default_zev_id"() WHERE "zevId" IS NULL;
UPDATE "Proposal" SET "zevId" = "default_zev_id"() WHERE "zevId" IS NULL;
ALTER TABLE "Vote" DISABLE TRIGGER "vote_append_only";
UPDATE "Vote" SET "zevId" = "default_zev_id"() WHERE "zevId" IS NULL;
ALTER TABLE "Vote" ENABLE TRIGGER "vote_append_only";
UPDATE "TransactionCategory" SET "zevId" = "default_zev_id"() WHERE "zevId" IS NULL;
UPDATE "FinTransaction" SET "zevId" = "default_zev_id"() WHERE "zevId" IS NULL;
UPDATE "ChargeItem" SET "zevId" = "default_zev_id"() WHERE "zevId" IS NULL;
UPDATE "InvoiceBatch" SET "zevId" = "default_zev_id"() WHERE "zevId" IS NULL;
UPDATE "Invoice" SET "zevId" = "default_zev_id"() WHERE "zevId" IS NULL;
UPDATE "BankImportBatch" SET "zevId" = "default_zev_id"() WHERE "zevId" IS NULL;
UPDATE "Payment" SET "zevId" = "default_zev_id"() WHERE "zevId" IS NULL;
UPDATE "BalanceCorrection" SET "zevId" = "default_zev_id"() WHERE "zevId" IS NULL;
UPDATE "Supplier" SET "zevId" = "default_zev_id"() WHERE "zevId" IS NULL;
UPDATE "Expense" SET "zevId" = "default_zev_id"() WHERE "zevId" IS NULL;
UPDATE "AnnualPlan" SET "zevId" = "default_zev_id"() WHERE "zevId" IS NULL;
UPDATE "PlanItem" SET "zevId" = "default_zev_id"() WHERE "zevId" IS NULL;
UPDATE "Project" SET "zevId" = "default_zev_id"() WHERE "zevId" IS NULL;
UPDATE "MaintenanceIssue" SET "zevId" = "default_zev_id"() WHERE "zevId" IS NULL;
UPDATE "WorkOrder" SET "zevId" = "default_zev_id"() WHERE "zevId" IS NULL;
UPDATE "Document" SET "zevId" = "default_zev_id"() WHERE "zevId" IS NULL;
UPDATE "Attachment" SET "zevId" = "default_zev_id"() WHERE "zevId" IS NULL;
UPDATE "NotificationMessage" SET "zevId" = "default_zev_id"() WHERE "zevId" IS NULL;
ALTER TABLE "AuditEvent" DISABLE TRIGGER "audit_event_append_only";
UPDATE "AuditEvent" SET "zevId" = "default_zev_id"() WHERE "zevId" IS NULL;
ALTER TABLE "AuditEvent" ENABLE TRIGGER "audit_event_append_only";

-- Set the temporary default (see header), then enforce NOT NULL, add the real FK, and
-- index the column (it will be filtered on constantly from step 5 onward).

ALTER TABLE "Party" ALTER COLUMN "zevId" SET DEFAULT "default_zev_id"();
ALTER TABLE "Party" ALTER COLUMN "zevId" SET NOT NULL;
ALTER TABLE "Party" ADD CONSTRAINT "Party_zevId_fkey" FOREIGN KEY ("zevId") REFERENCES "Zev"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE INDEX "Party_zevId_idx" ON "Party"("zevId");

ALTER TABLE "Entrance" ALTER COLUMN "zevId" SET DEFAULT "default_zev_id"();
ALTER TABLE "Entrance" ALTER COLUMN "zevId" SET NOT NULL;
ALTER TABLE "Entrance" ADD CONSTRAINT "Entrance_zevId_fkey" FOREIGN KEY ("zevId") REFERENCES "Zev"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE INDEX "Entrance_zevId_idx" ON "Entrance"("zevId");

ALTER TABLE "Unit" ALTER COLUMN "zevId" SET DEFAULT "default_zev_id"();
ALTER TABLE "Unit" ALTER COLUMN "zevId" SET NOT NULL;
ALTER TABLE "Unit" ADD CONSTRAINT "Unit_zevId_fkey" FOREIGN KEY ("zevId") REFERENCES "Zev"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE INDEX "Unit_zevId_idx" ON "Unit"("zevId");

ALTER TABLE "OwnershipStake" ALTER COLUMN "zevId" SET DEFAULT "default_zev_id"();
ALTER TABLE "OwnershipStake" ALTER COLUMN "zevId" SET NOT NULL;
ALTER TABLE "OwnershipStake" ADD CONSTRAINT "OwnershipStake_zevId_fkey" FOREIGN KEY ("zevId") REFERENCES "Zev"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE INDEX "OwnershipStake_zevId_idx" ON "OwnershipStake"("zevId");

ALTER TABLE "Occupancy" ALTER COLUMN "zevId" SET DEFAULT "default_zev_id"();
ALTER TABLE "Occupancy" ALTER COLUMN "zevId" SET NOT NULL;
ALTER TABLE "Occupancy" ADD CONSTRAINT "Occupancy_zevId_fkey" FOREIGN KEY ("zevId") REFERENCES "Zev"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE INDEX "Occupancy_zevId_idx" ON "Occupancy"("zevId");

ALTER TABLE "Proxy" ALTER COLUMN "zevId" SET DEFAULT "default_zev_id"();
ALTER TABLE "Proxy" ALTER COLUMN "zevId" SET NOT NULL;
ALTER TABLE "Proxy" ADD CONSTRAINT "Proxy_zevId_fkey" FOREIGN KEY ("zevId") REFERENCES "Zev"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE INDEX "Proxy_zevId_idx" ON "Proxy"("zevId");

ALTER TABLE "OfficeTerm" ALTER COLUMN "zevId" SET DEFAULT "default_zev_id"();
ALTER TABLE "OfficeTerm" ALTER COLUMN "zevId" SET NOT NULL;
ALTER TABLE "OfficeTerm" ADD CONSTRAINT "OfficeTerm_zevId_fkey" FOREIGN KEY ("zevId") REFERENCES "Zev"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE INDEX "OfficeTerm_zevId_idx" ON "OfficeTerm"("zevId");

ALTER TABLE "AllocationGroup" ALTER COLUMN "zevId" SET DEFAULT "default_zev_id"();
ALTER TABLE "AllocationGroup" ALTER COLUMN "zevId" SET NOT NULL;
ALTER TABLE "AllocationGroup" ADD CONSTRAINT "AllocationGroup_zevId_fkey" FOREIGN KEY ("zevId") REFERENCES "Zev"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE INDEX "AllocationGroup_zevId_idx" ON "AllocationGroup"("zevId");

ALTER TABLE "CommonAsset" ALTER COLUMN "zevId" SET DEFAULT "default_zev_id"();
ALTER TABLE "CommonAsset" ALTER COLUMN "zevId" SET NOT NULL;
ALTER TABLE "CommonAsset" ADD CONSTRAINT "CommonAsset_zevId_fkey" FOREIGN KEY ("zevId") REFERENCES "Zev"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE INDEX "CommonAsset_zevId_idx" ON "CommonAsset"("zevId");

ALTER TABLE "Meeting" ALTER COLUMN "zevId" SET DEFAULT "default_zev_id"();
ALTER TABLE "Meeting" ALTER COLUMN "zevId" SET NOT NULL;
ALTER TABLE "Meeting" ADD CONSTRAINT "Meeting_zevId_fkey" FOREIGN KEY ("zevId") REFERENCES "Zev"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE INDEX "Meeting_zevId_idx" ON "Meeting"("zevId");

ALTER TABLE "VotingRule" ALTER COLUMN "zevId" SET DEFAULT "default_zev_id"();
ALTER TABLE "VotingRule" ALTER COLUMN "zevId" SET NOT NULL;
ALTER TABLE "VotingRule" ADD CONSTRAINT "VotingRule_zevId_fkey" FOREIGN KEY ("zevId") REFERENCES "Zev"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE INDEX "VotingRule_zevId_idx" ON "VotingRule"("zevId");

ALTER TABLE "Proposal" ALTER COLUMN "zevId" SET DEFAULT "default_zev_id"();
ALTER TABLE "Proposal" ALTER COLUMN "zevId" SET NOT NULL;
ALTER TABLE "Proposal" ADD CONSTRAINT "Proposal_zevId_fkey" FOREIGN KEY ("zevId") REFERENCES "Zev"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE INDEX "Proposal_zevId_idx" ON "Proposal"("zevId");

ALTER TABLE "Vote" ALTER COLUMN "zevId" SET DEFAULT "default_zev_id"();
ALTER TABLE "Vote" ALTER COLUMN "zevId" SET NOT NULL;
ALTER TABLE "Vote" ADD CONSTRAINT "Vote_zevId_fkey" FOREIGN KEY ("zevId") REFERENCES "Zev"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE INDEX "Vote_zevId_idx" ON "Vote"("zevId");

ALTER TABLE "TransactionCategory" ALTER COLUMN "zevId" SET DEFAULT "default_zev_id"();
ALTER TABLE "TransactionCategory" ALTER COLUMN "zevId" SET NOT NULL;
ALTER TABLE "TransactionCategory" ADD CONSTRAINT "TransactionCategory_zevId_fkey" FOREIGN KEY ("zevId") REFERENCES "Zev"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE INDEX "TransactionCategory_zevId_idx" ON "TransactionCategory"("zevId");

ALTER TABLE "FinTransaction" ALTER COLUMN "zevId" SET DEFAULT "default_zev_id"();
ALTER TABLE "FinTransaction" ALTER COLUMN "zevId" SET NOT NULL;
ALTER TABLE "FinTransaction" ADD CONSTRAINT "FinTransaction_zevId_fkey" FOREIGN KEY ("zevId") REFERENCES "Zev"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE INDEX "FinTransaction_zevId_idx" ON "FinTransaction"("zevId");

ALTER TABLE "ChargeItem" ALTER COLUMN "zevId" SET DEFAULT "default_zev_id"();
ALTER TABLE "ChargeItem" ALTER COLUMN "zevId" SET NOT NULL;
ALTER TABLE "ChargeItem" ADD CONSTRAINT "ChargeItem_zevId_fkey" FOREIGN KEY ("zevId") REFERENCES "Zev"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE INDEX "ChargeItem_zevId_idx" ON "ChargeItem"("zevId");

ALTER TABLE "InvoiceBatch" ALTER COLUMN "zevId" SET DEFAULT "default_zev_id"();
ALTER TABLE "InvoiceBatch" ALTER COLUMN "zevId" SET NOT NULL;
ALTER TABLE "InvoiceBatch" ADD CONSTRAINT "InvoiceBatch_zevId_fkey" FOREIGN KEY ("zevId") REFERENCES "Zev"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE INDEX "InvoiceBatch_zevId_idx" ON "InvoiceBatch"("zevId");

ALTER TABLE "Invoice" ALTER COLUMN "zevId" SET DEFAULT "default_zev_id"();
ALTER TABLE "Invoice" ALTER COLUMN "zevId" SET NOT NULL;
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_zevId_fkey" FOREIGN KEY ("zevId") REFERENCES "Zev"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE INDEX "Invoice_zevId_idx" ON "Invoice"("zevId");

ALTER TABLE "BankImportBatch" ALTER COLUMN "zevId" SET DEFAULT "default_zev_id"();
ALTER TABLE "BankImportBatch" ALTER COLUMN "zevId" SET NOT NULL;
ALTER TABLE "BankImportBatch" ADD CONSTRAINT "BankImportBatch_zevId_fkey" FOREIGN KEY ("zevId") REFERENCES "Zev"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE INDEX "BankImportBatch_zevId_idx" ON "BankImportBatch"("zevId");

ALTER TABLE "Payment" ALTER COLUMN "zevId" SET DEFAULT "default_zev_id"();
ALTER TABLE "Payment" ALTER COLUMN "zevId" SET NOT NULL;
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_zevId_fkey" FOREIGN KEY ("zevId") REFERENCES "Zev"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE INDEX "Payment_zevId_idx" ON "Payment"("zevId");

ALTER TABLE "BalanceCorrection" ALTER COLUMN "zevId" SET DEFAULT "default_zev_id"();
ALTER TABLE "BalanceCorrection" ALTER COLUMN "zevId" SET NOT NULL;
ALTER TABLE "BalanceCorrection" ADD CONSTRAINT "BalanceCorrection_zevId_fkey" FOREIGN KEY ("zevId") REFERENCES "Zev"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE INDEX "BalanceCorrection_zevId_idx" ON "BalanceCorrection"("zevId");

ALTER TABLE "Supplier" ALTER COLUMN "zevId" SET DEFAULT "default_zev_id"();
ALTER TABLE "Supplier" ALTER COLUMN "zevId" SET NOT NULL;
ALTER TABLE "Supplier" ADD CONSTRAINT "Supplier_zevId_fkey" FOREIGN KEY ("zevId") REFERENCES "Zev"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE INDEX "Supplier_zevId_idx" ON "Supplier"("zevId");

ALTER TABLE "Expense" ALTER COLUMN "zevId" SET DEFAULT "default_zev_id"();
ALTER TABLE "Expense" ALTER COLUMN "zevId" SET NOT NULL;
ALTER TABLE "Expense" ADD CONSTRAINT "Expense_zevId_fkey" FOREIGN KEY ("zevId") REFERENCES "Zev"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE INDEX "Expense_zevId_idx" ON "Expense"("zevId");

ALTER TABLE "AnnualPlan" ALTER COLUMN "zevId" SET DEFAULT "default_zev_id"();
ALTER TABLE "AnnualPlan" ALTER COLUMN "zevId" SET NOT NULL;
ALTER TABLE "AnnualPlan" ADD CONSTRAINT "AnnualPlan_zevId_fkey" FOREIGN KEY ("zevId") REFERENCES "Zev"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE INDEX "AnnualPlan_zevId_idx" ON "AnnualPlan"("zevId");

ALTER TABLE "PlanItem" ALTER COLUMN "zevId" SET DEFAULT "default_zev_id"();
ALTER TABLE "PlanItem" ALTER COLUMN "zevId" SET NOT NULL;
ALTER TABLE "PlanItem" ADD CONSTRAINT "PlanItem_zevId_fkey" FOREIGN KEY ("zevId") REFERENCES "Zev"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE INDEX "PlanItem_zevId_idx" ON "PlanItem"("zevId");

ALTER TABLE "Project" ALTER COLUMN "zevId" SET DEFAULT "default_zev_id"();
ALTER TABLE "Project" ALTER COLUMN "zevId" SET NOT NULL;
ALTER TABLE "Project" ADD CONSTRAINT "Project_zevId_fkey" FOREIGN KEY ("zevId") REFERENCES "Zev"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE INDEX "Project_zevId_idx" ON "Project"("zevId");

ALTER TABLE "MaintenanceIssue" ALTER COLUMN "zevId" SET DEFAULT "default_zev_id"();
ALTER TABLE "MaintenanceIssue" ALTER COLUMN "zevId" SET NOT NULL;
ALTER TABLE "MaintenanceIssue" ADD CONSTRAINT "MaintenanceIssue_zevId_fkey" FOREIGN KEY ("zevId") REFERENCES "Zev"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE INDEX "MaintenanceIssue_zevId_idx" ON "MaintenanceIssue"("zevId");

ALTER TABLE "WorkOrder" ALTER COLUMN "zevId" SET DEFAULT "default_zev_id"();
ALTER TABLE "WorkOrder" ALTER COLUMN "zevId" SET NOT NULL;
ALTER TABLE "WorkOrder" ADD CONSTRAINT "WorkOrder_zevId_fkey" FOREIGN KEY ("zevId") REFERENCES "Zev"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE INDEX "WorkOrder_zevId_idx" ON "WorkOrder"("zevId");

ALTER TABLE "Document" ALTER COLUMN "zevId" SET DEFAULT "default_zev_id"();
ALTER TABLE "Document" ALTER COLUMN "zevId" SET NOT NULL;
ALTER TABLE "Document" ADD CONSTRAINT "Document_zevId_fkey" FOREIGN KEY ("zevId") REFERENCES "Zev"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE INDEX "Document_zevId_idx" ON "Document"("zevId");

ALTER TABLE "Attachment" ALTER COLUMN "zevId" SET DEFAULT "default_zev_id"();
ALTER TABLE "Attachment" ALTER COLUMN "zevId" SET NOT NULL;
ALTER TABLE "Attachment" ADD CONSTRAINT "Attachment_zevId_fkey" FOREIGN KEY ("zevId") REFERENCES "Zev"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE INDEX "Attachment_zevId_idx" ON "Attachment"("zevId");

ALTER TABLE "NotificationMessage" ALTER COLUMN "zevId" SET DEFAULT "default_zev_id"();
ALTER TABLE "NotificationMessage" ALTER COLUMN "zevId" SET NOT NULL;
ALTER TABLE "NotificationMessage" ADD CONSTRAINT "NotificationMessage_zevId_fkey" FOREIGN KEY ("zevId") REFERENCES "Zev"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE INDEX "NotificationMessage_zevId_idx" ON "NotificationMessage"("zevId");

ALTER TABLE "AuditEvent" ALTER COLUMN "zevId" SET DEFAULT "default_zev_id"();
ALTER TABLE "AuditEvent" ALTER COLUMN "zevId" SET NOT NULL;
ALTER TABLE "AuditEvent" ADD CONSTRAINT "AuditEvent_zevId_fkey" FOREIGN KEY ("zevId") REFERENCES "Zev"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE INDEX "AuditEvent_zevId_idx" ON "AuditEvent"("zevId");

-- Tenant-scope existing unique constraints that were not zevId-aware. Without this,
-- two tenants would collide the moment a second one exists (e.g. both issuing their
-- own invoice numbering from "1", or both naming a cost category "Struja").

DROP INDEX "AllocationGroup_name_key";
CREATE UNIQUE INDEX "AllocationGroup_zevId_name_key" ON "AllocationGroup"("zevId", "name");

DROP INDEX "VotingRule_name_key";
CREATE UNIQUE INDEX "VotingRule_zevId_name_key" ON "VotingRule"("zevId", "name");

DROP INDEX "TransactionCategory_name_key";
CREATE UNIQUE INDEX "TransactionCategory_zevId_name_key" ON "TransactionCategory"("zevId", "name");

DROP INDEX "Invoice_number_key";
CREATE UNIQUE INDEX "Invoice_zevId_number_key" ON "Invoice"("zevId", "number");

DROP INDEX "WorkOrder_number_key";
CREATE UNIQUE INDEX "WorkOrder_zevId_number_key" ON "WorkOrder"("zevId", "number");

DROP INDEX "Proposal_code_version_key";
CREATE UNIQUE INDEX "Proposal_zevId_code_version_key" ON "Proposal"("zevId", "code", "version");

DROP INDEX "InvoiceBatch_period_status_key";
CREATE UNIQUE INDEX "InvoiceBatch_zevId_period_status_key" ON "InvoiceBatch"("zevId", "period", "status");

DROP INDEX "AnnualPlan_year_kind_version_key";
CREATE UNIQUE INDEX "AnnualPlan_zevId_year_kind_version_key" ON "AnnualPlan"("zevId", "year", "kind", "version");

DROP INDEX "Document_type_number_version_key";
CREATE UNIQUE INDEX "Document_zevId_type_number_version_key" ON "Document"("zevId", "type", "number", "version");
