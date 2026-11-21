-- Faza B2: događaji za automatsko knjiženje (Plans/kontni-plan-b2-automatsko-knjizenje-plan.md §2). Samo dodavanje.

-- CreateEnum
CREATE TYPE "AccountingEventStatus" AS ENUM ('PENDING', 'POSTED', 'WAITING_RULE', 'WAITING_SCHEMA', 'WAITING_PREDECESSOR', 'WAITING_PERIOD');

-- CreateTable
CREATE TABLE "AccountingEvent" (
    "id" TEXT NOT NULL,
    "zevId" TEXT NOT NULL,
    "kind" "AccountingEventKind" NOT NULL,
    "sourceType" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "eventDate" TIMESTAMP(3) NOT NULL,
    "sourceCreatedAt" TIMESTAMP(3) NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "status" "AccountingEventStatus" NOT NULL DEFAULT 'PENDING',
    "statusDetail" TEXT,
    "journalEntryId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processedAt" TIMESTAMP(3),

    CONSTRAINT "AccountingEvent_pkey" PRIMARY KEY ("id")
);

-- AlterTable
ALTER TABLE "JournalLine" ADD COLUMN "ruleId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "AccountingEvent_journalEntryId_key" ON "AccountingEvent"("journalEntryId");
CREATE INDEX "AccountingEvent_zevId_status_eventDate_idx" ON "AccountingEvent"("zevId", "status", "eventDate");
CREATE UNIQUE INDEX "AccountingEvent_zevId_sourceType_sourceId_kind_key" ON "AccountingEvent"("zevId", "sourceType", "sourceId", "kind");

-- AddForeignKey
ALTER TABLE "AccountingEvent" ADD CONSTRAINT "AccountingEvent_zevId_fkey" FOREIGN KEY ("zevId") REFERENCES "Zev"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "AccountingEvent" ADD CONSTRAINT "AccountingEvent_journalEntryId_fkey" FOREIGN KEY ("journalEntryId") REFERENCES "JournalEntry"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "JournalLine" ADD CONSTRAINT "JournalLine_ruleId_fkey" FOREIGN KEY ("ruleId") REFERENCES "PostingRule"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Proknjižen događaj se više ne mijenja (veza na nalog je trajna).
CREATE OR REPLACE FUNCTION accounting_event_posted_immutable() RETURNS trigger AS $$
BEGIN
  IF OLD."status" = 'POSTED' THEN
    RAISE EXCEPTION 'Proknjižen događaj se ne mijenja';
  END IF;
  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER accounting_event_posted_immutable
  BEFORE UPDATE OR DELETE ON "AccountingEvent"
  FOR EACH ROW EXECUTE FUNCTION accounting_event_posted_immutable();
