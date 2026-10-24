-- Plans/invoice-email-delivery-plan.md
ALTER TABLE "Party" ADD COLUMN "invoiceEmailDelivery" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Party" ADD COLUMN "invoiceEmailDeliveryAt" TIMESTAMP(3);
ALTER TABLE "NotificationMessage" ADD COLUMN "attachmentDocumentId" TEXT;
ALTER TABLE "NotificationMessage" ADD COLUMN "dispatchingAt" TIMESTAMP(3);
