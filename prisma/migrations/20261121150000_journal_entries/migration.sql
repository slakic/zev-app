-- Faza B1a (Plans/kontni-plan-b1-nalozi-plan.md): nalozi za knjiženje, stavke, brojač naloga i zahtjevi za
-- ponovno otvaranje perioda. Tabele i indeksi generisani `prisma migrate diff`; ograničenja i okidači na kraju ručno.

-- CreateEnum
CREATE TYPE "JournalStatus" AS ENUM ('DRAFT', 'POSTED');

-- CreateEnum
CREATE TYPE "JournalKind" AS ENUM ('MANUAL', 'OPENING', 'REVERSAL', 'AUTO');

-- CreateTable
CREATE TABLE "JournalEntry" (
    "id" TEXT NOT NULL,
    "zevId" TEXT NOT NULL,
    "yearId" TEXT NOT NULL,
    "periodId" TEXT NOT NULL,
    "kind" "JournalKind" NOT NULL,
    "number" TEXT,
    "documentDate" TIMESTAMP(3) NOT NULL,
    "postingDate" TIMESTAMP(3) NOT NULL,
    "description" TEXT NOT NULL,
    "status" "JournalStatus" NOT NULL DEFAULT 'DRAFT',
    "reversalOfId" TEXT,
    "reversalReason" TEXT,
    "sourceType" TEXT,
    "sourceId" TEXT,
    "createdById" TEXT NOT NULL,
    "postedById" TEXT,
    "postedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "JournalEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "JournalLine" (
    "id" TEXT NOT NULL,
    "entryId" TEXT NOT NULL,
    "zevId" TEXT NOT NULL,
    "order" INTEGER NOT NULL,
    "accountId" TEXT NOT NULL,
    "debit" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "credit" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "partyId" TEXT,
    "unitId" TEXT,
    "supplierId" TEXT,
    "projectId" TEXT,
    "purposeId" TEXT,
    "description" TEXT,
    "openingSourceType" TEXT,
    "openingSourceId" TEXT,

    CONSTRAINT "JournalLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "JournalCounter" (
    "zevId" TEXT NOT NULL,
    "yearId" TEXT NOT NULL,
    "series" TEXT NOT NULL,
    "next" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "JournalCounter_pkey" PRIMARY KEY ("zevId","yearId","series")
);

-- CreateTable
CREATE TABLE "PeriodReopenRequest" (
    "id" TEXT NOT NULL,
    "zevId" TEXT NOT NULL,
    "periodId" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "requestedById" TEXT NOT NULL,
    "requestedRole" "Role" NOT NULL,
    "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "decidedById" TEXT,
    "decision" TEXT,
    "decisionNote" TEXT,
    "decidedAt" TIMESTAMP(3),

    CONSTRAINT "PeriodReopenRequest_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "JournalEntry_reversalOfId_key" ON "JournalEntry"("reversalOfId");

-- CreateIndex
CREATE INDEX "JournalEntry_zevId_periodId_status_idx" ON "JournalEntry"("zevId", "periodId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "JournalEntry_zevId_number_key" ON "JournalEntry"("zevId", "number");

-- CreateIndex
CREATE INDEX "JournalLine_entryId_idx" ON "JournalLine"("entryId");

-- CreateIndex
CREATE INDEX "JournalLine_zevId_accountId_idx" ON "JournalLine"("zevId", "accountId");

-- CreateIndex
CREATE INDEX "PeriodReopenRequest_zevId_periodId_idx" ON "PeriodReopenRequest"("zevId", "periodId");

-- AddForeignKey
ALTER TABLE "JournalEntry" ADD CONSTRAINT "JournalEntry_zevId_fkey" FOREIGN KEY ("zevId") REFERENCES "Zev"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JournalEntry" ADD CONSTRAINT "JournalEntry_yearId_fkey" FOREIGN KEY ("yearId") REFERENCES "FiscalYear"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JournalEntry" ADD CONSTRAINT "JournalEntry_periodId_fkey" FOREIGN KEY ("periodId") REFERENCES "FiscalPeriod"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JournalEntry" ADD CONSTRAINT "JournalEntry_reversalOfId_fkey" FOREIGN KEY ("reversalOfId") REFERENCES "JournalEntry"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JournalLine" ADD CONSTRAINT "JournalLine_entryId_fkey" FOREIGN KEY ("entryId") REFERENCES "JournalEntry"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JournalLine" ADD CONSTRAINT "JournalLine_zevId_fkey" FOREIGN KEY ("zevId") REFERENCES "Zev"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JournalLine" ADD CONSTRAINT "JournalLine_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "ZevAccount"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JournalLine" ADD CONSTRAINT "JournalLine_partyId_fkey" FOREIGN KEY ("partyId") REFERENCES "Party"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JournalLine" ADD CONSTRAINT "JournalLine_unitId_fkey" FOREIGN KEY ("unitId") REFERENCES "Unit"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JournalLine" ADD CONSTRAINT "JournalLine_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "Supplier"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JournalLine" ADD CONSTRAINT "JournalLine_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JournalLine" ADD CONSTRAINT "JournalLine_purposeId_fkey" FOREIGN KEY ("purposeId") REFERENCES "FundPurpose"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PeriodReopenRequest" ADD CONSTRAINT "PeriodReopenRequest_zevId_fkey" FOREIGN KEY ("zevId") REFERENCES "Zev"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PeriodReopenRequest" ADD CONSTRAINT "PeriodReopenRequest_periodId_fkey" FOREIGN KEY ("periodId") REFERENCES "FiscalPeriod"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Stavka: pozitivan iznos tačno na jednoj strani.
ALTER TABLE "JournalLine" ADD CONSTRAINT "JournalLine_one_side_positive"
  CHECK (("debit" > 0 AND "credit" = 0) OR ("credit" > 0 AND "debit" = 0));

-- Proknjižen nalog se ne mijenja ni ne briše (ispravka je storno nalog).
CREATE OR REPLACE FUNCTION journal_entry_posted_immutable() RETURNS trigger AS '
BEGIN
  IF OLD.status = ''POSTED'' THEN
    RAISE EXCEPTION ''Proknjižen nalog se ne mijenja — ispravka je storno.'';
  END IF;
  IF TG_OP = ''DELETE'' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
' LANGUAGE plpgsql;

CREATE TRIGGER journal_entry_posted_immutable
  BEFORE UPDATE OR DELETE ON "JournalEntry"
  FOR EACH ROW EXECUTE FUNCTION journal_entry_posted_immutable();

-- Stavke proknjiženog naloga se ne dodaju, ne mijenjaju i ne brišu.
CREATE OR REPLACE FUNCTION journal_line_posted_immutable() RETURNS trigger AS '
DECLARE
  st TEXT;
BEGIN
  SELECT status INTO st FROM "JournalEntry" WHERE id = COALESCE(NEW."entryId", OLD."entryId");
  IF st = ''POSTED'' THEN
    RAISE EXCEPTION ''Stavke proknjiženog naloga se ne mijenjaju — ispravka je storno.'';
  END IF;
  IF TG_OP = ''DELETE'' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
' LANGUAGE plpgsql;

CREATE TRIGGER journal_line_posted_immutable
  BEFORE INSERT OR UPDATE OR DELETE ON "JournalLine"
  FOR EACH ROW EXECUTE FUNCTION journal_line_posted_immutable();

-- Odložena provjera (na kraju transakcije): proknjižen nalog ima najmanje dvije stavke i zbir duguje = zbir potražuje.
CREATE OR REPLACE FUNCTION journal_entry_balanced() RETURNS trigger AS '
DECLARE
  d NUMERIC;
  c NUMERIC;
  n INT;
BEGIN
  IF NEW.status <> ''POSTED'' THEN
    RETURN NULL;
  END IF;
  SELECT COALESCE(SUM("debit"), 0), COALESCE(SUM("credit"), 0), COUNT(*) INTO d, c, n
    FROM "JournalLine" WHERE "entryId" = NEW.id;
  IF n < 2 THEN
    RAISE EXCEPTION ''Proknjižen nalog mora imati najmanje dvije stavke.'';
  END IF;
  IF d <> c THEN
    RAISE EXCEPTION ''Proknjižen nalog nije uravnotežen: duguje % / potražuje %.'', d, c;
  END IF;
  RETURN NULL;
END;
' LANGUAGE plpgsql;

CREATE CONSTRAINT TRIGGER journal_entry_balanced
  AFTER INSERT OR UPDATE ON "JournalEntry"
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION journal_entry_balanced();
