-- Kontni plan, Faza A1 (Plans/kontni-plan-i-knjizenje-plan.md §3.1–3.4).
-- Tabele i indeksi generisani `prisma migrate diff` (staro → novo schema.prisma); okidači na
-- kraju su ručno napisani, kao i u ostalim migracijama sa PL/pgSQL funkcijama.

-- CreateEnum
CREATE TYPE "ChartTemplateStatus" AS ENUM ('DRAFT', 'DEMO', 'REVIEWED', 'RETIRED');

-- CreateEnum
CREATE TYPE "AccountNature" AS ENUM ('ASSET', 'LIABILITY', 'EQUITY', 'INCOME', 'EXPENSE', 'OFF_BALANCE');

-- CreateEnum
CREATE TYPE "ZevChartStatus" AS ENUM ('DRAFT', 'ACTIVE', 'RETIRED');

-- CreateEnum
CREATE TYPE "FiscalStatus" AS ENUM ('OPEN', 'CLOSED');

-- AlterTable
ALTER TABLE "Zev" ADD COLUMN     "isDemo" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "ChartTemplate" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "jurisdiction" TEXT NOT NULL,
    "source" TEXT,
    "note" TEXT,
    "status" "ChartTemplateStatus" NOT NULL DEFAULT 'DRAFT',
    "reviewedBy" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "validFrom" TIMESTAMP(3),
    "validTo" TIMESTAMP(3),
    "codeRules" JSONB NOT NULL,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ChartTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ChartTemplateAccount" (
    "id" TEXT NOT NULL,
    "templateId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "parentId" TEXT,
    "nature" "AccountNature" NOT NULL,
    "postable" BOOLEAN NOT NULL,
    "requiredDimensions" TEXT[] DEFAULT ARRAY[]::TEXT[],

    CONSTRAINT "ChartTemplateAccount_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ZevChart" (
    "id" TEXT NOT NULL,
    "zevId" TEXT NOT NULL,
    "sourceTemplateId" TEXT NOT NULL,
    "codeRules" JSONB NOT NULL,
    "status" "ZevChartStatus" NOT NULL DEFAULT 'DRAFT',
    "activatedAt" TIMESTAMP(3),
    "retiredAt" TIMESTAMP(3),
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ZevChart_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ZevAccount" (
    "id" TEXT NOT NULL,
    "zevId" TEXT NOT NULL,
    "chartId" TEXT NOT NULL,
    "templateAccountId" TEXT,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "parentId" TEXT,
    "nature" "AccountNature" NOT NULL,
    "postable" BOOLEAN NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "deactivatedAt" TIMESTAMP(3),
    "requiredDimensions" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "replacesId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ZevAccount_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FiscalYear" (
    "id" TEXT NOT NULL,
    "zevId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "startDate" TIMESTAMP(3) NOT NULL,
    "endDate" TIMESTAMP(3) NOT NULL,
    "status" "FiscalStatus" NOT NULL DEFAULT 'OPEN',
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FiscalYear_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FiscalPeriod" (
    "id" TEXT NOT NULL,
    "zevId" TEXT NOT NULL,
    "yearId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "startDate" TIMESTAMP(3) NOT NULL,
    "endDate" TIMESTAMP(3) NOT NULL,
    "status" "FiscalStatus" NOT NULL DEFAULT 'OPEN',
    "closedAt" TIMESTAMP(3),
    "closedById" TEXT,

    CONSTRAINT "FiscalPeriod_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ChartTemplate_key_version_key" ON "ChartTemplate"("key", "version");

-- CreateIndex
CREATE UNIQUE INDEX "ChartTemplateAccount_templateId_code_key" ON "ChartTemplateAccount"("templateId", "code");

-- CreateIndex
CREATE INDEX "ZevChart_zevId_status_idx" ON "ZevChart"("zevId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "ZevAccount_replacesId_key" ON "ZevAccount"("replacesId");

-- CreateIndex
CREATE INDEX "ZevAccount_zevId_idx" ON "ZevAccount"("zevId");

-- CreateIndex
CREATE UNIQUE INDEX "ZevAccount_chartId_code_key" ON "ZevAccount"("chartId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "FiscalYear_zevId_label_key" ON "FiscalYear"("zevId", "label");

-- CreateIndex
CREATE INDEX "FiscalPeriod_zevId_startDate_idx" ON "FiscalPeriod"("zevId", "startDate");

-- CreateIndex
CREATE UNIQUE INDEX "FiscalPeriod_yearId_label_key" ON "FiscalPeriod"("yearId", "label");

-- AddForeignKey
ALTER TABLE "ChartTemplateAccount" ADD CONSTRAINT "ChartTemplateAccount_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "ChartTemplate"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChartTemplateAccount" ADD CONSTRAINT "ChartTemplateAccount_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "ChartTemplateAccount"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ZevChart" ADD CONSTRAINT "ZevChart_zevId_fkey" FOREIGN KEY ("zevId") REFERENCES "Zev"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ZevChart" ADD CONSTRAINT "ZevChart_sourceTemplateId_fkey" FOREIGN KEY ("sourceTemplateId") REFERENCES "ChartTemplate"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ZevAccount" ADD CONSTRAINT "ZevAccount_zevId_fkey" FOREIGN KEY ("zevId") REFERENCES "Zev"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ZevAccount" ADD CONSTRAINT "ZevAccount_chartId_fkey" FOREIGN KEY ("chartId") REFERENCES "ZevChart"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ZevAccount" ADD CONSTRAINT "ZevAccount_templateAccountId_fkey" FOREIGN KEY ("templateAccountId") REFERENCES "ChartTemplateAccount"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ZevAccount" ADD CONSTRAINT "ZevAccount_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "ZevAccount"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ZevAccount" ADD CONSTRAINT "ZevAccount_replacesId_fkey" FOREIGN KEY ("replacesId") REFERENCES "ZevAccount"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FiscalYear" ADD CONSTRAINT "FiscalYear_zevId_fkey" FOREIGN KEY ("zevId") REFERENCES "Zev"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FiscalPeriod" ADD CONSTRAINT "FiscalPeriod_zevId_fkey" FOREIGN KEY ("zevId") REFERENCES "Zev"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FiscalPeriod" ADD CONSTRAINT "FiscalPeriod_yearId_fkey" FOREIGN KEY ("yearId") REFERENCES "FiscalYear"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Šifra konta: tekst bez praznog prostora na krajevima, nikad prazna (vodeće nule se čuvaju
-- jer je kolona TEXT; servis ih nikad ne pretvara u broj).
ALTER TABLE "ChartTemplateAccount" ADD CONSTRAINT "ChartTemplateAccount_code_nonblank"
  CHECK (length(btrim("code")) > 0 AND "code" = btrim("code"));
ALTER TABLE "ZevAccount" ADD CONSTRAINT "ZevAccount_code_nonblank"
  CHECK (length(btrim("code")) > 0 AND "code" = btrim("code"));

-- Druga linija odbrane iza servisa (§3.4): roditelj mora biti u istom planu/predlošku, a
-- hijerarhija ne smije imati ciklus. Servis provjerava isto i daje čitljivu poruku; okidač
-- hvata svaki put koji servis zaobiđe.
CREATE OR REPLACE FUNCTION zev_account_tree_guard() RETURNS trigger AS '
DECLARE
  cur TEXT;
  parent_chart TEXT;
  depth INT := 0;
BEGIN
  IF NEW."parentId" IS NULL THEN
    RETURN NEW;
  END IF;
  SELECT "chartId" INTO parent_chart FROM "ZevAccount" WHERE id = NEW."parentId";
  IF parent_chart IS DISTINCT FROM NEW."chartId" THEN
    RAISE EXCEPTION ''Nadređeni konto mora biti u istom kontnom planu.'';
  END IF;
  cur := NEW."parentId";
  WHILE cur IS NOT NULL LOOP
    IF cur = NEW.id THEN
      RAISE EXCEPTION ''Hijerarhija konta ne smije imati ciklus.'';
    END IF;
    depth := depth + 1;
    IF depth > 64 THEN
      RAISE EXCEPTION ''Hijerarhija konta je predubok ili ima ciklus.'';
    END IF;
    SELECT "parentId" INTO cur FROM "ZevAccount" WHERE id = cur;
  END LOOP;
  RETURN NEW;
END;
' LANGUAGE plpgsql;

CREATE TRIGGER zev_account_tree_guard
  BEFORE INSERT OR UPDATE OF "parentId", "chartId" ON "ZevAccount"
  FOR EACH ROW EXECUTE FUNCTION zev_account_tree_guard();

CREATE OR REPLACE FUNCTION chart_template_account_tree_guard() RETURNS trigger AS '
DECLARE
  cur TEXT;
  parent_tpl TEXT;
  depth INT := 0;
BEGIN
  IF NEW."parentId" IS NULL THEN
    RETURN NEW;
  END IF;
  SELECT "templateId" INTO parent_tpl FROM "ChartTemplateAccount" WHERE id = NEW."parentId";
  IF parent_tpl IS DISTINCT FROM NEW."templateId" THEN
    RAISE EXCEPTION ''Nadređeni konto mora biti u istom predlošku.'';
  END IF;
  cur := NEW."parentId";
  WHILE cur IS NOT NULL LOOP
    IF cur = NEW.id THEN
      RAISE EXCEPTION ''Hijerarhija konta ne smije imati ciklus.'';
    END IF;
    depth := depth + 1;
    IF depth > 64 THEN
      RAISE EXCEPTION ''Hijerarhija konta je predubok ili ima ciklus.'';
    END IF;
    SELECT "parentId" INTO cur FROM "ChartTemplateAccount" WHERE id = cur;
  END LOOP;
  RETURN NEW;
END;
' LANGUAGE plpgsql;

CREATE TRIGGER chart_template_account_tree_guard
  BEFORE INSERT OR UPDATE OF "parentId", "templateId" ON "ChartTemplateAccount"
  FOR EACH ROW EXECUTE FUNCTION chart_template_account_tree_guard();
