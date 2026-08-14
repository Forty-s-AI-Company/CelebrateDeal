CREATE TABLE "PlatformReferralPayoutBatch" (
    "id" TEXT NOT NULL,
    "batchNumber" TEXT NOT NULL,
    "monthKey" TEXT NOT NULL,
    "batchDate" TIMESTAMP(3) NOT NULL,
    "totalAmountCents" INTEGER NOT NULL DEFAULT 0,
    "totalCount" INTEGER NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "exportedAt" TIMESTAMP(3),
    "executedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PlatformReferralPayoutBatch_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "PlatformReferralPayout" (
    "id" TEXT NOT NULL,
    "ownerUserId" TEXT NOT NULL,
    "monthKey" TEXT NOT NULL,
    "commissionAmountCents" INTEGER NOT NULL DEFAULT 0,
    "adjustmentAmountCents" INTEGER NOT NULL DEFAULT 0,
    "finalAmountCents" INTEGER NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "payoutBatchId" TEXT,
    "outcomeReference" TEXT,
    "outcomeReason" TEXT,
    "paidAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PlatformReferralPayout_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "PlatformReferralPayoutBatch_batchNumber_key" ON "PlatformReferralPayoutBatch"("batchNumber");
CREATE UNIQUE INDEX "PlatformReferralPayout_ownerUserId_monthKey_key" ON "PlatformReferralPayout"("ownerUserId", "monthKey");
CREATE INDEX "PlatformReferralPayoutBatch_monthKey_status_idx" ON "PlatformReferralPayoutBatch"("monthKey", "status");
CREATE INDEX "PlatformReferralPayout_ownerUserId_monthKey_status_idx" ON "PlatformReferralPayout"("ownerUserId", "monthKey", "status");
CREATE INDEX "PlatformReferralPayout_payoutBatchId_status_idx" ON "PlatformReferralPayout"("payoutBatchId", "status");

ALTER TABLE "PlatformReferralPayout" ADD CONSTRAINT "PlatformReferralPayout_ownerUserId_fkey" FOREIGN KEY ("ownerUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PlatformReferralPayout" ADD CONSTRAINT "PlatformReferralPayout_payoutBatchId_fkey" FOREIGN KEY ("payoutBatchId") REFERENCES "PlatformReferralPayoutBatch"("id") ON DELETE SET NULL ON UPDATE CASCADE;
