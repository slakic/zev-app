-- End of Korak 5 (docs/multitenancy-plan.md §6.4, end-of-Korak-5 addendum): every write
-- path in src/server/services/* now sets zevId explicitly from actor.zevId (or, for the
-- handful of internal helpers without an actor, from an explicit zevId parameter derived
-- upstream). The temporary DB-level default introduced in 20260907090000_zevid_not_null_fk
-- (`default_zev_id()`, resolving to the single pre-existing tenant) is no longer needed as
-- a safety net, and leaving it in place would be actively harmful: a future write path that
-- forgets to set zevId would silently misattribute the row to tenant #1 instead of failing
-- loudly. So it is dropped for the 30 models below, which keep NOT NULL.
--
-- Two models are handled differently: while preparing this migration, a real,
-- previously-undiscovered gap surfaced — src/server/audit.ts's audit() never set zevId on
-- any AuditEvent it created, for any caller, ever (it silently fell back to this same DB
-- default for every single audit event in the app, misattributing all of them to tenant #1
-- once a second tenant exists). That's fixed separately (audit() now derives zevId from the
-- actor). But a handful of audit events, and a handful of notifications (a pre-existing,
-- already-documented gap — queueNotification's password-reset caller), are genuinely
-- account-level or pre-tenant-resolution with no single ZEV to attribute to: anonymous
-- rate-limiting on an email that may not even exist, revoked/expired/unknown token lookups,
-- and the login/password-reset moments before a session's active ZEV is resolved. Confirmed
-- with the user: AuditEvent.zevId and NotificationMessage.zevId become genuinely nullable
-- for these cases, rather than leaning on any fallback tenant.
--
-- Hand-written for the same reason as the other non-init migrations in this project: the
-- bundled schema-engine-wasm cannot introspect this database (PL/pgSQL trigger functions
-- from append_only_guards break its Postgres catalog scan).

-- ---- 30 models: drop the temporary default, keep NOT NULL ----

ALTER TABLE "Party" ALTER COLUMN "zevId" DROP DEFAULT;
ALTER TABLE "Entrance" ALTER COLUMN "zevId" DROP DEFAULT;
ALTER TABLE "Unit" ALTER COLUMN "zevId" DROP DEFAULT;
ALTER TABLE "OwnershipStake" ALTER COLUMN "zevId" DROP DEFAULT;
ALTER TABLE "Occupancy" ALTER COLUMN "zevId" DROP DEFAULT;
ALTER TABLE "Proxy" ALTER COLUMN "zevId" DROP DEFAULT;
ALTER TABLE "OfficeTerm" ALTER COLUMN "zevId" DROP DEFAULT;
ALTER TABLE "AllocationGroup" ALTER COLUMN "zevId" DROP DEFAULT;
ALTER TABLE "CommonAsset" ALTER COLUMN "zevId" DROP DEFAULT;
ALTER TABLE "Meeting" ALTER COLUMN "zevId" DROP DEFAULT;
ALTER TABLE "VotingRule" ALTER COLUMN "zevId" DROP DEFAULT;
ALTER TABLE "Proposal" ALTER COLUMN "zevId" DROP DEFAULT;
ALTER TABLE "Vote" ALTER COLUMN "zevId" DROP DEFAULT;
ALTER TABLE "TransactionCategory" ALTER COLUMN "zevId" DROP DEFAULT;
ALTER TABLE "FinTransaction" ALTER COLUMN "zevId" DROP DEFAULT;
ALTER TABLE "ChargeItem" ALTER COLUMN "zevId" DROP DEFAULT;
ALTER TABLE "InvoiceBatch" ALTER COLUMN "zevId" DROP DEFAULT;
ALTER TABLE "Invoice" ALTER COLUMN "zevId" DROP DEFAULT;
ALTER TABLE "BankImportBatch" ALTER COLUMN "zevId" DROP DEFAULT;
ALTER TABLE "Payment" ALTER COLUMN "zevId" DROP DEFAULT;
ALTER TABLE "BalanceCorrection" ALTER COLUMN "zevId" DROP DEFAULT;
ALTER TABLE "Supplier" ALTER COLUMN "zevId" DROP DEFAULT;
ALTER TABLE "Expense" ALTER COLUMN "zevId" DROP DEFAULT;
ALTER TABLE "AnnualPlan" ALTER COLUMN "zevId" DROP DEFAULT;
ALTER TABLE "PlanItem" ALTER COLUMN "zevId" DROP DEFAULT;
ALTER TABLE "Project" ALTER COLUMN "zevId" DROP DEFAULT;
ALTER TABLE "MaintenanceIssue" ALTER COLUMN "zevId" DROP DEFAULT;
ALTER TABLE "WorkOrder" ALTER COLUMN "zevId" DROP DEFAULT;
ALTER TABLE "Document" ALTER COLUMN "zevId" DROP DEFAULT;
ALTER TABLE "Attachment" ALTER COLUMN "zevId" DROP DEFAULT;

-- ---- 2 models: drop the default AND drop NOT NULL (genuinely nullable going forward) ----

ALTER TABLE "NotificationMessage" ALTER COLUMN "zevId" DROP DEFAULT;
ALTER TABLE "NotificationMessage" ALTER COLUMN "zevId" DROP NOT NULL;

ALTER TABLE "AuditEvent" ALTER COLUMN "zevId" DROP DEFAULT;
ALTER TABLE "AuditEvent" ALTER COLUMN "zevId" DROP NOT NULL;

-- ---- Drop the now-unreferenced stopgap function ----
-- Must run after every ALTER COLUMN ... DROP DEFAULT above — Postgres refuses to drop a
-- function while any column DEFAULT expression still depends on it.

DROP FUNCTION "default_zev_id"();
