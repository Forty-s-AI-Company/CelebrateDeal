-- Extend only the existing outbox; keep prior migrations/checksums immutable.
ALTER TABLE "CommerceOrder" ADD COLUMN "trackingContextEncrypted" TEXT;
ALTER TABLE "TrackingDelivery" ALTER COLUMN "orderId" DROP NOT NULL;
ALTER TABLE "TrackingDelivery" ADD COLUMN "eventName" TEXT NOT NULL DEFAULT 'Purchase';
ALTER TABLE "TrackingDelivery" ADD COLUMN "formId" TEXT;
ALTER TABLE "TrackingDelivery" ADD COLUMN "submissionId" TEXT;
ALTER TABLE "TrackingDelivery" ADD COLUMN "analyticsEventId" TEXT;
ALTER TABLE "TrackingDelivery" ADD COLUMN "bookingId" TEXT;
ALTER TABLE "TrackingDelivery" ADD COLUMN "contextEncrypted" TEXT;

-- Both indexes include each table's already-unique primary key: no existing
-- row can conflict. They enable tenant/source composite foreign keys.
CREATE UNIQUE INDEX "FormSubmission_formId_id_key" ON "FormSubmission"("formId", "id");
CREATE UNIQUE INDEX "AnalyticsEvent_vendorId_id_key" ON "AnalyticsEvent"("vendorId", "id");
CREATE INDEX "TrackingDelivery_vendorId_status_nextAttemptAt_idx" ON "TrackingDelivery"("vendorId", "status", "nextAttemptAt");
CREATE INDEX "TrackingDelivery_formId_submissionId_idx" ON "TrackingDelivery"("formId", "submissionId");
CREATE INDEX "TrackingDelivery_vendorId_analyticsEventId_idx" ON "TrackingDelivery"("vendorId", "analyticsEventId");
CREATE INDEX "TrackingDelivery_vendorId_bookingId_idx" ON "TrackingDelivery"("vendorId", "bookingId");

ALTER TABLE "TrackingDelivery" ADD CONSTRAINT "TrackingDelivery_vendorId_formId_fkey" FOREIGN KEY ("vendorId", "formId") REFERENCES "RegistrationForm"("vendorId", "id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TrackingDelivery" ADD CONSTRAINT "TrackingDelivery_formId_submissionId_fkey" FOREIGN KEY ("formId", "submissionId") REFERENCES "FormSubmission"("formId", "id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TrackingDelivery" ADD CONSTRAINT "TrackingDelivery_vendorId_analyticsEventId_fkey" FOREIGN KEY ("vendorId", "analyticsEventId") REFERENCES "AnalyticsEvent"("vendorId", "id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TrackingDelivery" ADD CONSTRAINT "TrackingDelivery_vendorId_bookingId_fkey" FOREIGN KEY ("vendorId", "bookingId") REFERENCES "ConsultationBooking"("vendorId", "id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TrackingDelivery" ADD CONSTRAINT "TrackingDelivery_authoritative_source_check" CHECK (
 ("eventName" = 'Purchase' AND "orderId" IS NOT NULL AND "formId" IS NULL AND "submissionId" IS NULL AND "analyticsEventId" IS NULL AND "bookingId" IS NULL) OR
 ("eventName" = 'Lead' AND "orderId" IS NULL AND "formId" IS NOT NULL AND "submissionId" IS NOT NULL AND "analyticsEventId" IS NULL AND "bookingId" IS NULL) OR
 ("eventName" = 'ViewContent' AND "orderId" IS NULL AND "formId" IS NULL AND "submissionId" IS NULL AND "analyticsEventId" IS NOT NULL AND "bookingId" IS NULL) OR
 ("eventName" = 'Schedule' AND "orderId" IS NULL AND "formId" IS NULL AND "submissionId" IS NULL AND "analyticsEventId" IS NULL AND "bookingId" IS NOT NULL)
);
