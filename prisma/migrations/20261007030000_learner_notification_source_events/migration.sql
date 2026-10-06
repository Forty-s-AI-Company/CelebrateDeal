-- New domain event outbox; existing migrations remain unchanged.
CREATE TABLE "LearnerNotificationSourceEvent" (
 "id" TEXT NOT NULL,"vendorId" TEXT NOT NULL,"productId" TEXT NOT NULL,"event" TEXT NOT NULL,"eventIdentity" TEXT NOT NULL,
 "audienceCustomerKeyHash" TEXT,"payloadEncryptedEnvelope" TEXT NOT NULL,"occurredAt" TIMESTAMP(3) NOT NULL,
 "preferenceCursor" TEXT,"completedAt" TIMESTAMP(3),"revision" INTEGER NOT NULL DEFAULT 1,"createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 CONSTRAINT "LearnerNotificationSourceEvent_pkey" PRIMARY KEY("id"),
 CONSTRAINT "LearnerSourceEvent_event_check" CHECK("event" IN ('lesson_published','discussion_reply','course_completed','live_started','consultation_reminder','payment_success')),
 CONSTRAINT "LearnerSourceEvent_identity_check" CHECK(length("eventIdentity") BETWEEN 1 AND 160 AND "revision">0),
 CONSTRAINT "LearnerSourceEvent_audience_check" CHECK("audienceCustomerKeyHash" IS NULL OR "audienceCustomerKeyHash" ~ '^[A-Za-z0-9_-]{43}$'),
 CONSTRAINT "LearnerSourceEvent_cursor_check" CHECK("preferenceCursor" IS NULL OR "preferenceCursor" ~ '^[A-Za-z0-9_-]{1,128}$'),
 CONSTRAINT "LearnerNotificationSourceEvent_vendor_fkey" FOREIGN KEY("vendorId") REFERENCES "Vendor"("id") ON DELETE CASCADE ON UPDATE CASCADE,
 CONSTRAINT "LearnerNotificationSourceEvent_product_fkey" FOREIGN KEY("vendorId","productId") REFERENCES "Product"("vendorId","id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "LearnerNotificationSourceEvent_scope_key" ON "LearnerNotificationSourceEvent"("vendorId","productId","event","eventIdentity");
CREATE INDEX "LearnerNotificationSourceEvent_due_idx" ON "LearnerNotificationSourceEvent"("vendorId","completedAt","createdAt","id");
ALTER TABLE "LearnerNotificationSourceEvent" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE "LearnerNotificationSourceEvent" FROM PUBLIC;
DO $$ BEGIN
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='anon') THEN REVOKE ALL ON TABLE "LearnerNotificationSourceEvent" FROM anon; END IF;
 IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN REVOKE ALL ON TABLE "LearnerNotificationSourceEvent" FROM authenticated; END IF;
END $$;
