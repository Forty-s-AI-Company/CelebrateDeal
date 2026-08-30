CREATE TABLE "PlatformReferralCommission" (
    "id" TEXT NOT NULL,
    "ownerUserId" TEXT NOT NULL,
    "vendorId" TEXT NOT NULL,
    "subscriptionId" TEXT NOT NULL,
    "paymentTransactionId" TEXT NOT NULL,
    "codeSnapshot" TEXT NOT NULL,
    "commissionRateBpsSnapshot" INTEGER NOT NULL,
    "grossAmountCents" INTEGER NOT NULL,
    "commissionAmountCents" INTEGER NOT NULL,
    "currency" TEXT NOT NULL,
    "monthKey" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PlatformReferralCommission_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "PlatformReferralCommissionLedgerEntry" (
    "id" TEXT NOT NULL,
    "platformReferralCommissionId" TEXT NOT NULL,
    "entryType" TEXT NOT NULL,
    "amountCents" INTEGER NOT NULL,
    "providerName" TEXT NOT NULL,
    "eventIdentity" TEXT NOT NULL,
    "deduplicationKey" TEXT NOT NULL,
    "occurredAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PlatformReferralCommissionLedgerEntry_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "PlatformReferralCommission_paymentTransactionId_key" ON "PlatformReferralCommission"("paymentTransactionId");
CREATE UNIQUE INDEX "PlatformReferralCommission_vendorId_id_key" ON "PlatformReferralCommission"("vendorId", "id");
CREATE UNIQUE INDEX "PlatformReferralCommission_vendorId_paymentTransactionId_key" ON "PlatformReferralCommission"("vendorId", "paymentTransactionId");
CREATE INDEX "PlatformReferralCommission_ownerUserId_monthKey_idx" ON "PlatformReferralCommission"("ownerUserId", "monthKey");
CREATE INDEX "PlatformReferralCommission_vendorId_monthKey_idx" ON "PlatformReferralCommission"("vendorId", "monthKey");
CREATE UNIQUE INDEX "PlatformReferralCommissionLedgerEntry_commissionId_dedup_key" ON "PlatformReferralCommissionLedgerEntry"("platformReferralCommissionId", "deduplicationKey");
CREATE INDEX "PlatformReferralCommissionLedgerEntry_commissionId_createdAt_idx" ON "PlatformReferralCommissionLedgerEntry"("platformReferralCommissionId", "createdAt");

ALTER TABLE "PlatformReferralCommission" ADD CONSTRAINT "PlatformReferralCommission_ownerUserId_fkey" FOREIGN KEY ("ownerUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PlatformReferralCommission" ADD CONSTRAINT "PlatformReferralCommission_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "Vendor"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PlatformReferralCommission" ADD CONSTRAINT "PlatformReferralCommission_subscriptionId_fkey" FOREIGN KEY ("subscriptionId") REFERENCES "VendorSubscription"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PlatformReferralCommission" ADD CONSTRAINT "PlatformReferralCommission_vendorId_paymentTransactionId_fkey" FOREIGN KEY ("vendorId", "paymentTransactionId") REFERENCES "PaymentTransaction"("vendorId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PlatformReferralCommissionLedgerEntry" ADD CONSTRAINT "PlatformReferralCommissionLedgerEntry_commissionId_fkey" FOREIGN KEY ("platformReferralCommissionId") REFERENCES "PlatformReferralCommission"("id") ON DELETE CASCADE ON UPDATE CASCADE;
