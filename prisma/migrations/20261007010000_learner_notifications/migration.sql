-- Additive learner notification storage. Contacts,device keys,payloads and receipts stay encrypted.
CREATE TABLE "LearnerNotificationPreference" (
 "id" TEXT NOT NULL,"vendorId" TEXT NOT NULL,"productId" TEXT NOT NULL,"customerKeyHash" TEXT NOT NULL,
 "channel" TEXT NOT NULL,"enabled" BOOLEAN NOT NULL DEFAULT false,"revision" INTEGER NOT NULL DEFAULT 1,
 "consentedAt" TIMESTAMP(3),"destinationEncryptedEnvelope" TEXT,"destinationKeyHash" TEXT,"destinationVerifiedAt" TIMESTAMP(3),
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,"updatedAt" TIMESTAMP(3) NOT NULL,
 CONSTRAINT "LearnerNotificationPreference_pkey" PRIMARY KEY ("id"),
 CONSTRAINT "LearnerNotificationPreference_channel_check" CHECK ("channel" IN ('email','push','sms','whatsapp')),
 CONSTRAINT "LearnerNotificationPreference_scope_check" CHECK ("customerKeyHash" ~ '^[A-Za-z0-9_-]{43}$' AND "revision">0),
 CONSTRAINT "LearnerNotificationPreference_hash_check" CHECK ("destinationKeyHash" IS NULL OR "destinationKeyHash" ~ '^[a-f0-9]{64}$'),
 CONSTRAINT "LearnerNotificationPreference_consent_check" CHECK (NOT "enabled" OR "consentedAt" IS NOT NULL),
 CONSTRAINT "LearnerNotificationPreference_verified_check" CHECK ("destinationVerifiedAt" IS NULL OR ("destinationEncryptedEnvelope" IS NOT NULL AND "destinationKeyHash" IS NOT NULL)),
 CONSTRAINT "LearnerNotificationPreference_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "Vendor"("id") ON DELETE CASCADE ON UPDATE CASCADE,
 CONSTRAINT "LearnerNotificationPreference_vendorId_productId_fkey" FOREIGN KEY ("vendorId","productId") REFERENCES "Product"("vendorId","id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "LearnerNotificationPreference_vendorId_productId_id_key" ON "LearnerNotificationPreference"("vendorId","productId","id");
CREATE UNIQUE INDEX "LearnerNotificationPreference_scope_channel_key" ON "LearnerNotificationPreference"("vendorId","customerKeyHash","productId","channel");
CREATE INDEX "LearnerNotificationPreference_product_enabled_idx" ON "LearnerNotificationPreference"("vendorId","productId","enabled");
CREATE TABLE "LearnerNotificationDelivery" (
 "id" TEXT NOT NULL,"vendorId" TEXT NOT NULL,"productId" TEXT NOT NULL,"preferenceId" TEXT NOT NULL,"event" TEXT NOT NULL,
 "eventIdentity" TEXT NOT NULL,"deduplicationKey" TEXT NOT NULL,"consentRevision" INTEGER NOT NULL,"payloadEncryptedEnvelope" TEXT NOT NULL,
 "status" TEXT NOT NULL DEFAULT 'queued',"attemptCount" INTEGER NOT NULL DEFAULT 0,"claimTokenHash" TEXT,"claimedAt" TIMESTAMP(3),
 "nextAttemptAt" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP,"providerReceiptEncryptedEnvelope" TEXT,"lastErrorCode" TEXT,"dispatchedAt" TIMESTAMP(3),
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,"updatedAt" TIMESTAMP(3) NOT NULL,
 CONSTRAINT "LearnerNotificationDelivery_pkey" PRIMARY KEY ("id"),
 CONSTRAINT "LearnerNotificationDelivery_bounds_check" CHECK ("consentRevision">0 AND "attemptCount" BETWEEN 0 AND 5 AND length("eventIdentity") BETWEEN 1 AND 160),
 CONSTRAINT "LearnerNotificationDelivery_hash_check" CHECK ("deduplicationKey" ~ '^[a-f0-9]{64}$' AND ("claimTokenHash" IS NULL OR "claimTokenHash" ~ '^[a-f0-9]{64}$')),
 CONSTRAINT "LearnerNotificationDelivery_event_check" CHECK ("event" IN ('lesson_published','discussion_reply','course_completed','live_started','consultation_reminder','payment_success')),
 CONSTRAINT "LearnerNotificationDelivery_status_check" CHECK ("status" IN ('queued','processing','sent','suppressed','failed','indeterminate')),
 CONSTRAINT "LearnerNotificationDelivery_error_check" CHECK ("lastErrorCode" IS NULL OR "lastErrorCode" ~ '^[A-Z_]{1,80}$'),
 CONSTRAINT "LearnerNotificationDelivery_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "Vendor"("id") ON DELETE CASCADE ON UPDATE CASCADE,
 CONSTRAINT "LearnerNotificationDelivery_preference_fkey" FOREIGN KEY ("vendorId","productId","preferenceId") REFERENCES "LearnerNotificationPreference"("vendorId","productId","id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "LearnerNotificationDelivery_vendorId_id_key" ON "LearnerNotificationDelivery"("vendorId","id");
CREATE UNIQUE INDEX "LearnerNotificationDelivery_vendorId_deduplicationKey_key" ON "LearnerNotificationDelivery"("vendorId","deduplicationKey");
CREATE INDEX "LearnerNotificationDelivery_status_nextAttemptAt_idx" ON "LearnerNotificationDelivery"("status","nextAttemptAt");
CREATE INDEX "LearnerNotificationDelivery_vendorId_preferenceId_createdAt_idx" ON "LearnerNotificationDelivery"("vendorId","preferenceId","createdAt");
CREATE TABLE "LearnerNotificationVerification" (
 "id" TEXT NOT NULL,"vendorId" TEXT NOT NULL,"productId" TEXT NOT NULL,"preferenceId" TEXT NOT NULL,"consentRevision" INTEGER NOT NULL,
 "tokenHash" TEXT NOT NULL,"destinationEncryptedEnvelope" TEXT NOT NULL,"destinationKeyHash" TEXT NOT NULL,
 "attemptCount" INTEGER NOT NULL DEFAULT 0,"expiresAt" TIMESTAMP(3) NOT NULL,"consumedAt" TIMESTAMP(3),"createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 CONSTRAINT "LearnerNotificationVerification_pkey" PRIMARY KEY ("id"),
 CONSTRAINT "LearnerNotificationVerification_bounds_check" CHECK ("consentRevision">0 AND "attemptCount" BETWEEN 0 AND 5 AND "expiresAt">"createdAt"),
 CONSTRAINT "LearnerNotificationVerification_hash_check" CHECK ("tokenHash" ~ '^[a-f0-9]{64}$' AND "destinationKeyHash" ~ '^[a-f0-9]{64}$'),
 CONSTRAINT "LearnerNotificationVerification_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "Vendor"("id") ON DELETE CASCADE ON UPDATE CASCADE,
 CONSTRAINT "LearnerNotificationVerification_preference_fkey" FOREIGN KEY ("vendorId","productId","preferenceId") REFERENCES "LearnerNotificationPreference"("vendorId","productId","id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "LearnerNotificationVerification_tokenHash_key" ON "LearnerNotificationVerification"("tokenHash");
CREATE INDEX "LearnerNotificationVerification_scope_expiry_idx" ON "LearnerNotificationVerification"("vendorId","preferenceId","expiresAt");
-- Reuse default-deny Data API rules; no public notification/contact policy is created.
ALTER TABLE "LearnerNotificationPreference" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "LearnerNotificationDelivery" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "LearnerNotificationVerification" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON "LearnerNotificationPreference","LearnerNotificationDelivery","LearnerNotificationVerification" FROM PUBLIC;
DO $$ DECLARE role_name TEXT; BEGIN
 FOREACH role_name IN ARRAY ARRAY['anon','authenticated'] LOOP
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname=role_name) THEN
   EXECUTE format('REVOKE ALL ON "LearnerNotificationPreference","LearnerNotificationDelivery","LearnerNotificationVerification" FROM %I',role_name);
  END IF;
 END LOOP;
END $$;
