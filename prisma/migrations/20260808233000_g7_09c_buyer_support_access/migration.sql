-- G7-09C: per-order buyer support capability, buyer-visible replies and SLA timestamps.
-- Raw capability tokens remain in HttpOnly cookies; only SHA-256 hashes are persisted.

ALTER TYPE "SupportCaseEventType" ADD VALUE 'buyer_reply_added';
ALTER TYPE "SupportCaseEventType" ADD VALUE 'customer_reply_added';
CREATE TYPE "SupportCaseEventAudience" AS ENUM ('internal', 'buyer');

CREATE TABLE "BuyerSupportOrderGrant" (
  "id" TEXT NOT NULL,
  "vendorId" TEXT NOT NULL,
  "orderId" TEXT NOT NULL,
  "cookieKey" TEXT NOT NULL,
  "tokenHash" TEXT NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "revokedAt" TIMESTAMP(3),
  "lastAccessedAt" TIMESTAMP(3),
  "rotationCount" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "BuyerSupportOrderGrant_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "BuyerSupportOrderGrant_cookie_key_check" CHECK ("cookieKey" ~ '^[a-f0-9]{32}$'),
  CONSTRAINT "BuyerSupportOrderGrant_token_hash_check" CHECK ("tokenHash" ~ '^[a-f0-9]{64}$'),
  CONSTRAINT "BuyerSupportOrderGrant_expiry_check" CHECK ("expiresAt" > "createdAt"),
  CONSTRAINT "BuyerSupportOrderGrant_revocation_check" CHECK ("revokedAt" IS NULL OR "revokedAt" >= "createdAt"),
  CONSTRAINT "BuyerSupportOrderGrant_rotation_check" CHECK ("rotationCount" >= 0)
);

CREATE UNIQUE INDEX "BuyerSupportOrderGrant_cookieKey_key" ON "BuyerSupportOrderGrant"("cookieKey");
CREATE UNIQUE INDEX "BuyerSupportOrderGrant_tokenHash_key" ON "BuyerSupportOrderGrant"("tokenHash");
CREATE UNIQUE INDEX "BuyerSupportOrderGrant_vendorId_orderId_key" ON "BuyerSupportOrderGrant"("vendorId", "orderId");
CREATE UNIQUE INDEX "BuyerSupportOrderGrant_vendorId_id_key" ON "BuyerSupportOrderGrant"("vendorId", "id");
CREATE UNIQUE INDEX "BuyerSupportOrderGrant_vendorId_orderId_id_key" ON "BuyerSupportOrderGrant"("vendorId", "orderId", "id");
CREATE INDEX "BuyerSupportOrderGrant_vendorId_orderId_idx" ON "BuyerSupportOrderGrant"("vendorId", "orderId");
CREATE INDEX "BuyerSupportOrderGrant_expiresAt_revokedAt_idx" ON "BuyerSupportOrderGrant"("expiresAt", "revokedAt");

ALTER TABLE "BuyerSupportOrderGrant" ADD CONSTRAINT "BuyerSupportOrderGrant_vendor_fkey"
FOREIGN KEY ("vendorId") REFERENCES "Vendor"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "BuyerSupportOrderGrant" ADD CONSTRAINT "BuyerSupportOrderGrant_order_tenant_fkey"
FOREIGN KEY ("vendorId", "orderId") REFERENCES "CommerceOrder"("vendorId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "SupportCase"
ALTER COLUMN "createdByMemberId" DROP NOT NULL,
ADD COLUMN "createdByBuyerGrantId" TEXT,
ADD COLUMN "responseDueAt" TIMESTAMP(3);

UPDATE "SupportCase"
SET "responseDueAt" = "createdAt" + CASE "priority"
  WHEN 'p0' THEN INTERVAL '15 minutes'
  WHEN 'p1' THEN INTERVAL '1 hour'
  ELSE INTERVAL '1 day'
END
WHERE "responseDueAt" IS NULL;

ALTER TABLE "SupportCase"
ALTER COLUMN "responseDueAt" SET NOT NULL,
ADD CONSTRAINT "SupportCase_creator_check" CHECK (
  ("createdByMemberId" IS NOT NULL AND "createdByBuyerGrantId" IS NULL)
  OR ("createdByMemberId" IS NULL AND "createdByBuyerGrantId" IS NOT NULL)
),
ADD CONSTRAINT "SupportCase_response_due_check" CHECK ("responseDueAt" > "createdAt");

ALTER TABLE "SupportCase" ADD CONSTRAINT "SupportCase_buyer_creator_fkey"
FOREIGN KEY ("vendorId", "orderId", "createdByBuyerGrantId")
REFERENCES "BuyerSupportOrderGrant"("vendorId", "orderId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE INDEX "SupportCase_buyer_creator_createdAt_idx" ON "SupportCase"("createdByBuyerGrantId", "createdAt");
CREATE UNIQUE INDEX "SupportCase_vendorId_id_orderId_key" ON "SupportCase"("vendorId", "id", "orderId");

ALTER TABLE "SupportCaseEvent"
ADD COLUMN "audience" "SupportCaseEventAudience" NOT NULL DEFAULT 'internal',
ADD COLUMN "actorBuyerOrderId" TEXT,
ADD COLUMN "actorBuyerGrantId" TEXT;

ALTER TABLE "SupportCaseEvent" DROP CONSTRAINT "SupportCaseEvent_actor_check";
ALTER TABLE "SupportCaseEvent" ADD CONSTRAINT "SupportCaseEvent_actor_check" CHECK (
  (("actorMemberId" IS NOT NULL)::INTEGER
    + ("actorUserId" IS NOT NULL)::INTEGER
    + ("actorBuyerGrantId" IS NOT NULL)::INTEGER) = 1
);
ALTER TABLE "SupportCaseEvent" ADD CONSTRAINT "SupportCaseEvent_buyer_audience_check" CHECK (
  "actorBuyerGrantId" IS NULL OR "audience" = 'buyer'
);
ALTER TABLE "SupportCaseEvent" ADD CONSTRAINT "SupportCaseEvent_buyer_order_check" CHECK (
  ("actorBuyerGrantId" IS NULL AND "actorBuyerOrderId" IS NULL)
  OR ("actorBuyerGrantId" IS NOT NULL AND "actorBuyerOrderId" IS NOT NULL)
);
ALTER TABLE "SupportCaseEvent" ADD CONSTRAINT "SupportCaseEvent_buyer_actor_fkey"
FOREIGN KEY ("vendorId", "actorBuyerOrderId", "actorBuyerGrantId")
REFERENCES "BuyerSupportOrderGrant"("vendorId", "orderId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "SupportCaseEvent" ADD CONSTRAINT "SupportCaseEvent_buyer_case_order_fkey"
FOREIGN KEY ("vendorId", "supportCaseId", "actorBuyerOrderId")
REFERENCES "SupportCase"("vendorId", "id", "orderId") ON DELETE CASCADE ON UPDATE CASCADE;
CREATE INDEX "SupportCaseEvent_buyer_actor_occurredAt_idx" ON "SupportCaseEvent"("actorBuyerGrantId", "occurredAt");
