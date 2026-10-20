-- F-049 / B03-15: large settlement adjustments need a second platform admin.
--
-- An adjustment whose absolute amount exceeds
-- FINANCE_SECOND_APPROVAL_THRESHOLD_CENTS (default 5,000,000 cents =
-- NT$50,000) is stored here as "pending" and changes nothing on Settlement.
-- Only an "approved" request, reviewed by an account other than the
-- requester, writes Settlement.adjustmentAmountCents. Smaller adjustments are
-- applied directly and supersede any pending request.
--
-- Forward-only and additive: a new table, no existing row changes.
CREATE TABLE "SettlementAdjustmentRequest" (
    "id" TEXT NOT NULL,
    "vendorId" TEXT NOT NULL,
    "settlementId" TEXT NOT NULL,
    "amountCents" INTEGER NOT NULL,
    "reason" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "requestedBy" TEXT NOT NULL,
    "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reviewedBy" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SettlementAdjustmentRequest_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "SettlementAdjustmentRequest_status_check"
        CHECK ("status" IN ('pending', 'approved', 'rejected', 'superseded')),
    -- A reason is mandatory and bounded (the action trims it first).
    CONSTRAINT "SettlementAdjustmentRequest_reason_check"
        CHECK (char_length(btrim("reason")) BETWEEN 1 AND 500),
    -- Only pending rows lack a reviewer; every closed row records who closed it.
    CONSTRAINT "SettlementAdjustmentRequest_review_check"
        CHECK (("status" = 'pending') = ("reviewedBy" IS NULL AND "reviewedAt" IS NULL)),
    -- The second-person rule is enforced by the database as well.
    CONSTRAINT "SettlementAdjustmentRequest_second_approver_check"
        CHECK ("status" <> 'approved' OR "reviewedBy" <> "requestedBy")
);

CREATE INDEX "SettlementAdjustmentRequest_vendorId_settlementId_status_idx" ON "SettlementAdjustmentRequest"("vendorId", "settlementId", "status");

CREATE INDEX "SettlementAdjustmentRequest_status_requestedAt_idx" ON "SettlementAdjustmentRequest"("status", "requestedAt");

-- At most one pending request per settlement. Prisma 6 cannot express a
-- partial index; src/lib/prisma-unmanaged-indexes.db.test.ts asserts it.
CREATE UNIQUE INDEX "SettlementAdjustmentRequest_one_pending_per_settlement"
    ON "SettlementAdjustmentRequest"("settlementId") WHERE "status" = 'pending';

ALTER TABLE "SettlementAdjustmentRequest" ADD CONSTRAINT "SettlementAdjustmentRequest_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "Vendor"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Tenant binding: the request can only point at a settlement of its vendor.
ALTER TABLE "SettlementAdjustmentRequest" ADD CONSTRAINT "SettlementAdjustmentRequest_vendorId_settlementId_fkey" FOREIGN KEY ("vendorId", "settlementId") REFERENCES "Settlement"("vendorId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Same defense in depth as every other public table (20261020090000).
ALTER TABLE "SettlementAdjustmentRequest" ENABLE ROW LEVEL SECURITY;
