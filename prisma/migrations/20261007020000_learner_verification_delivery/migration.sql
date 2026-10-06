-- Forward-only durable challenge delivery. Historical hashes cannot recreate tokens:
-- existing challenges stay suppressed and must be requested again by their owner.
ALTER TABLE "LearnerNotificationVerification"
 ADD COLUMN "deliveryTokenEncryptedEnvelope" TEXT,
 ADD COLUMN "deliveryStatus" TEXT NOT NULL DEFAULT 'suppressed',
 ADD COLUMN "deliveryAttemptCount" INTEGER NOT NULL DEFAULT 0,
 ADD COLUMN "deliveryClaimTokenHash" TEXT,
 ADD COLUMN "deliveryNextAttemptAt" TIMESTAMP(3),
 ADD COLUMN "deliveryReceiptEncryptedEnvelope" TEXT,
 ADD COLUMN "deliveredAt" TIMESTAMP(3),
 ADD CONSTRAINT "LearnerVerification_delivery_status_check" CHECK ("deliveryStatus" IN ('queued','processing','sent','suppressed','failed','indeterminate')),
 ADD CONSTRAINT "LearnerVerification_delivery_attempt_check" CHECK ("deliveryAttemptCount" BETWEEN 0 AND 1),
 ADD CONSTRAINT "LearnerVerification_delivery_claim_check" CHECK ("deliveryClaimTokenHash" IS NULL OR "deliveryClaimTokenHash" ~ '^[a-f0-9]{64}$'),
 ADD CONSTRAINT "LearnerVerification_delivery_payload_check" CHECK ("deliveryStatus" NOT IN ('queued','processing') OR "deliveryTokenEncryptedEnvelope" IS NOT NULL);
CREATE INDEX "LearnerNotificationVerification_delivery_due_idx" ON "LearnerNotificationVerification"("vendorId","deliveryStatus","deliveryNextAttemptAt");
-- RLS and tenant composite FK remain enforced by the original forward migration.
