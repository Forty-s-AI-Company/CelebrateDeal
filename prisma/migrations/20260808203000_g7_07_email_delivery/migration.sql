-- G7-07: durable, tenant-scoped email delivery and suppression ledgers.
CREATE TABLE "EmailDelivery" (
    "id" TEXT NOT NULL,
    "vendorId" TEXT NOT NULL,
    "sourceTemplateId" TEXT NOT NULL,
    "sourceLiveId" TEXT,
    "sourceFormSubmissionId" TEXT,
    "trigger" TEXT NOT NULL,
    "payloadEncryptedEnvelope" TEXT NOT NULL,
    "recipientHash" TEXT NOT NULL,
    "recipientMaskedEmail" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'queued',
    "attemptCount" INTEGER NOT NULL DEFAULT 0,
    "maxAttempts" INTEGER NOT NULL DEFAULT 5,
    "nextAttemptAt" TIMESTAMP(3),
    "claimedAt" TIMESTAMP(3),
    "sentAt" TIMESTAMP(3),
    "failedAt" TIMESTAMP(3),
    "providerMessageId" TEXT,
    "lastErrorCode" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "EmailDelivery_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "EmailSuppression" (
    "id" TEXT NOT NULL,
    "vendorId" TEXT NOT NULL,
    "recipientHash" TEXT NOT NULL,
    "recipientMaskedEmail" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "suppressedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resubscribedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "EmailSuppression_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "EmailDelivery_vendorId_idempotencyKey_key" ON "EmailDelivery"("vendorId", "idempotencyKey");
CREATE INDEX "EmailDelivery_status_nextAttemptAt_idx" ON "EmailDelivery"("status", "nextAttemptAt");
CREATE INDEX "EmailDelivery_vendorId_createdAt_idx" ON "EmailDelivery"("vendorId", "createdAt");
CREATE INDEX "EmailDelivery_vendorId_recipientHash_idx" ON "EmailDelivery"("vendorId", "recipientHash");
CREATE UNIQUE INDEX "EmailSuppression_vendorId_recipientHash_key" ON "EmailSuppression"("vendorId", "recipientHash");
CREATE INDEX "EmailSuppression_vendorId_suppressedAt_idx" ON "EmailSuppression"("vendorId", "suppressedAt");
CREATE UNIQUE INDEX "MessageTemplate_vendorId_id_key" ON "MessageTemplate"("vendorId", "id");

DO $$
BEGIN
    IF EXISTS (
        SELECT 1
        FROM "Live" AS l
        LEFT JOIN "MessageTemplate" AS mt ON mt."id" = l."messageTemplateId"
        WHERE l."messageTemplateId" IS NOT NULL
          AND (mt."id" IS NULL OR mt."vendorId" <> l."vendorId")
    ) THEN
        RAISE EXCEPTION 'Live message template tenant preflight failed';
    END IF;
END $$;

ALTER TABLE "EmailDelivery" ADD CONSTRAINT "EmailDelivery_vendorId_fkey"
FOREIGN KEY ("vendorId") REFERENCES "Vendor"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "EmailSuppression" ADD CONSTRAINT "EmailSuppression_vendorId_fkey"
FOREIGN KEY ("vendorId") REFERENCES "Vendor"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Keep the legacy single-column SET NULL relation while enforcing that a live
-- can only reference a template owned by the same vendor.
ALTER TABLE "Live" ADD CONSTRAINT "Live_vendorId_messageTemplateId_fkey"
FOREIGN KEY ("vendorId", "messageTemplateId") REFERENCES "MessageTemplate"("vendorId", "id")
ON DELETE NO ACTION ON UPDATE CASCADE;
