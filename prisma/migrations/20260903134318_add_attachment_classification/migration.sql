-- AlterTable: classify uploaded Attachments (existing model, previously unused by app code)
-- and optionally link one to any other record (mirrors Document.sourceType/sourceId).
ALTER TABLE "Attachment" ADD COLUMN "category" TEXT NOT NULL DEFAULT 'OTHER';
ALTER TABLE "Attachment" ADD COLUMN "linkedType" TEXT;
ALTER TABLE "Attachment" ADD COLUMN "linkedId" TEXT;

-- Defense in depth: the service layer is the primary gate on allowed categories,
-- but a DB check constraint stops a bad value from entering through any other path.
ALTER TABLE "Attachment" ADD CONSTRAINT "Attachment_category_check"
  CHECK ("category" IN ('OWNERSHIP_PROOF', 'INVOICE', 'REPORT', 'MINUTES', 'CONTRACT', 'CORRESPONDENCE', 'PHOTO', 'OTHER'));

CREATE INDEX "Attachment_linkedType_linkedId_idx" ON "Attachment"("linkedType", "linkedId");
CREATE INDEX "Attachment_category_idx" ON "Attachment"("category");
