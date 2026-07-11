CREATE TABLE "NotificationOutbox" (
  "id" TEXT NOT NULL,
  "vendorId" TEXT NOT NULL,
  "templateId" TEXT,
  "channel" TEXT NOT NULL DEFAULT 'email',
  "recipient" TEXT NOT NULL,
  "subject" TEXT NOT NULL,
  "body" TEXT NOT NULL,
  "sourceType" TEXT NOT NULL,
  "sourceId" TEXT NOT NULL,
  "idempotencyKey" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'pending',
  "payload" JSONB,
  "scheduledAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "nextAttemptAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "attemptCount" INTEGER NOT NULL DEFAULT 0,
  "maxAttempts" INTEGER NOT NULL DEFAULT 5,
  "lastError" TEXT,
  "providerMessageId" TEXT,
  "sentAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "NotificationOutbox_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "NotificationOutbox_channel_valid" CHECK ("channel" IN ('email')),
  CONSTRAINT "NotificationOutbox_recipient_not_blank" CHECK (btrim("recipient") <> ''),
  CONSTRAINT "NotificationOutbox_status_valid" CHECK ("status" IN ('pending', 'sending', 'sent', 'failed', 'exhausted')),
  CONSTRAINT "NotificationOutbox_attempts_valid" CHECK ("attemptCount" >= 0 AND "maxAttempts" > 0 AND "attemptCount" <= "maxAttempts")
);

CREATE TABLE "NotificationDeliveryAttempt" (
  "id" TEXT NOT NULL,
  "outboxId" TEXT NOT NULL,
  "attemptNumber" INTEGER NOT NULL,
  "provider" TEXT NOT NULL,
  "status" TEXT NOT NULL,
  "providerMessageId" TEXT,
  "errorMessage" TEXT,
  "attemptedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "NotificationDeliveryAttempt_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "NotificationDeliveryAttempt_number_positive" CHECK ("attemptNumber" > 0),
  CONSTRAINT "NotificationDeliveryAttempt_status_valid" CHECK ("status" IN ('sent', 'failed'))
);

CREATE UNIQUE INDEX "NotificationOutbox_idempotencyKey_key" ON "NotificationOutbox"("idempotencyKey");
CREATE INDEX "NotificationOutbox_status_nextAttemptAt_idx" ON "NotificationOutbox"("status", "nextAttemptAt");
CREATE INDEX "NotificationOutbox_vendorId_createdAt_idx" ON "NotificationOutbox"("vendorId", "createdAt");
CREATE INDEX "NotificationOutbox_sourceType_sourceId_idx" ON "NotificationOutbox"("sourceType", "sourceId");
CREATE UNIQUE INDEX "NotificationDeliveryAttempt_outboxId_attemptNumber_key" ON "NotificationDeliveryAttempt"("outboxId", "attemptNumber");
CREATE INDEX "NotificationDeliveryAttempt_status_attemptedAt_idx" ON "NotificationDeliveryAttempt"("status", "attemptedAt");

ALTER TABLE "NotificationOutbox"
ADD CONSTRAINT "NotificationOutbox_vendorId_fkey"
FOREIGN KEY ("vendorId") REFERENCES "Vendor"("id") ON DELETE CASCADE ON UPDATE CASCADE,
ADD CONSTRAINT "NotificationOutbox_templateId_fkey"
FOREIGN KEY ("templateId") REFERENCES "MessageTemplate"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "NotificationDeliveryAttempt"
ADD CONSTRAINT "NotificationDeliveryAttempt_outboxId_fkey"
FOREIGN KEY ("outboxId") REFERENCES "NotificationOutbox"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Rollback: stop the notification worker, then DROP TABLE "NotificationDeliveryAttempt";
-- DROP TABLE "NotificationOutbox";. Existing sent email cannot be recalled.
