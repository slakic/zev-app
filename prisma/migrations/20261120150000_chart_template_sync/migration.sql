-- Kontni plan: ZEV pamti posljednju pregledanu verziju predloška („Preuzmi izmjene iz nove verzije”).
-- Generisano `prisma migrate diff` (staro → novo schema.prisma); samo dodavanje.

-- AlterTable
ALTER TABLE "ZevChart" ADD COLUMN     "syncedAt" TIMESTAMP(3),
ADD COLUMN     "syncedTemplateId" TEXT;

-- AddForeignKey
ALTER TABLE "ZevChart" ADD CONSTRAINT "ZevChart_syncedTemplateId_fkey" FOREIGN KEY ("syncedTemplateId") REFERENCES "ChartTemplate"("id") ON DELETE SET NULL ON UPDATE CASCADE;

