-- CreateTable
CREATE TABLE "VendorSubscription" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "vendorId" TEXT NOT NULL,
    "planId" TEXT NOT NULL,
    "paymentMode" TEXT NOT NULL DEFAULT 'byo',
    "status" TEXT NOT NULL DEFAULT 'active',
    "customFeeRateBps" INTEGER,
    "billingCycleDay" INTEGER NOT NULL DEFAULT 5,
    "startedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "VendorSubscription_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "Vendor" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "VendorSubscription_planId_fkey" FOREIGN KEY ("planId") REFERENCES "BillingPlan" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Invoice" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "vendorId" TEXT NOT NULL,
    "monthKey" TEXT NOT NULL,
    "invoiceNumber" TEXT NOT NULL,
    "invoiceType" TEXT NOT NULL DEFAULT 'monthly',
    "monthlyFeeCents" INTEGER NOT NULL DEFAULT 0,
    "overflowFeeCents" INTEGER NOT NULL DEFAULT 0,
    "paymentServiceFeeCents" INTEGER NOT NULL DEFAULT 0,
    "transactionServiceFeeCents" INTEGER NOT NULL DEFAULT 0,
    "affiliateManagementFeeCents" INTEGER NOT NULL DEFAULT 0,
    "subtotalCents" INTEGER NOT NULL DEFAULT 0,
    "taxCents" INTEGER NOT NULL DEFAULT 0,
    "totalCents" INTEGER NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "dueAt" DATETIME,
    "paidAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Invoice_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "Vendor" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Settlement" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "vendorId" TEXT NOT NULL,
    "monthKey" TEXT NOT NULL,
    "monthlyFeeCents" INTEGER NOT NULL DEFAULT 0,
    "overflowFeeCents" INTEGER NOT NULL DEFAULT 0,
    "paymentServiceFeeCents" INTEGER NOT NULL DEFAULT 0,
    "transactionServiceFeeCents" INTEGER NOT NULL DEFAULT 0,
    "affiliateManagementFeeCents" INTEGER NOT NULL DEFAULT 0,
    "paymentGatewayFeeCents" INTEGER NOT NULL DEFAULT 0,
    "grossRevenueCents" INTEGER NOT NULL DEFAULT 0,
    "payoutableAmountCents" INTEGER NOT NULL DEFAULT 0,
    "adjustmentAmountCents" INTEGER NOT NULL DEFAULT 0,
    "finalPayoutAmountCents" INTEGER NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "lockedAt" DATETIME,
    "reviewedBy" TEXT,
    "payoutBatchId" TEXT,
    "payoutDate" DATETIME,
    "batchNumber" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Settlement_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "Vendor" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Settlement_payoutBatchId_fkey" FOREIGN KEY ("payoutBatchId") REFERENCES "PayoutBatch" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "PayoutBatch" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "batchNumber" TEXT NOT NULL,
    "batchDate" DATETIME NOT NULL,
    "totalAmountCents" INTEGER NOT NULL DEFAULT 0,
    "totalCount" INTEGER NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "exportedFilePath" TEXT,
    "executedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);

-- CreateTable
CREATE TABLE "PayoutItem" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "payoutBatchId" TEXT NOT NULL,
    "vendorId" TEXT NOT NULL,
    "settlementId" TEXT,
    "bankAccountName" TEXT NOT NULL,
    "bankCode" TEXT NOT NULL,
    "bankAccountNumber" TEXT NOT NULL,
    "payoutAmountCents" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "failReason" TEXT,
    "retriedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "PayoutItem_payoutBatchId_fkey" FOREIGN KEY ("payoutBatchId") REFERENCES "PayoutBatch" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "PayoutItem_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "Vendor" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "PayoutItem_settlementId_fkey" FOREIGN KEY ("settlementId") REFERENCES "Settlement" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "PaymentAccount" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "vendorId" TEXT NOT NULL,
    "mode" TEXT NOT NULL DEFAULT 'byo',
    "providerName" TEXT NOT NULL,
    "accountLabel" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "apiKeyRef" TEXT,
    "merchantIdRef" TEXT,
    "bankAccountName" TEXT,
    "bankCode" TEXT,
    "bankAccountNumber" TEXT,
    "riskHoldEnabled" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "PaymentAccount_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "Vendor" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "PaymentTransaction" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "vendorId" TEXT NOT NULL,
    "providerName" TEXT NOT NULL,
    "providerTradeNo" TEXT,
    "orderNumber" TEXT,
    "paymentMode" TEXT NOT NULL DEFAULT 'platform',
    "grossAmountCents" INTEGER NOT NULL DEFAULT 0,
    "gatewayFeeCents" INTEGER NOT NULL DEFAULT 0,
    "platformFeeCents" INTEGER NOT NULL DEFAULT 0,
    "netAmountCents" INTEGER NOT NULL DEFAULT 0,
    "currency" TEXT NOT NULL DEFAULT 'TWD',
    "status" TEXT NOT NULL DEFAULT 'paid',
    "occurredAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "metadata" JSONB,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PaymentTransaction_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "Vendor" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "AffiliateCommission" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "vendorId" TEXT NOT NULL,
    "affiliateId" TEXT,
    "monthKey" TEXT NOT NULL,
    "sourceType" TEXT NOT NULL DEFAULT 'product',
    "sourceId" TEXT,
    "referralCode" TEXT,
    "orderNumber" TEXT,
    "orderAmountCents" INTEGER NOT NULL DEFAULT 0,
    "commissionRateBps" INTEGER NOT NULL DEFAULT 0,
    "commissionAmountCents" INTEGER NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "attributedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "settledAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "AffiliateCommission_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "Vendor" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "AffiliateCommission_affiliateId_fkey" FOREIGN KEY ("affiliateId") REFERENCES "Affiliate" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "AffiliatePayout" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "vendorId" TEXT NOT NULL,
    "affiliateId" TEXT,
    "monthKey" TEXT NOT NULL,
    "commissionAmountCents" INTEGER NOT NULL DEFAULT 0,
    "adjustmentAmountCents" INTEGER NOT NULL DEFAULT 0,
    "finalAmountCents" INTEGER NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "payoutItemId" TEXT,
    "paidAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "AffiliatePayout_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "Vendor" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "AffiliatePayout_affiliateId_fkey" FOREIGN KEY ("affiliateId") REFERENCES "Affiliate" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_BillingPlan" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "name" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "monthlyPriceCents" INTEGER NOT NULL DEFAULT 0,
    "includedStreamMinutes" INTEGER NOT NULL DEFAULT 0,
    "includedStorageMinutes" INTEGER NOT NULL DEFAULT 0,
    "includedCredits" INTEGER NOT NULL DEFAULT 0,
    "includedEvents" INTEGER NOT NULL DEFAULT 0,
    "includedAffiliates" INTEGER NOT NULL DEFAULT 0,
    "overageCreditCostCents" INTEGER NOT NULL DEFAULT 0,
    "overflowWatchHourPriceCents" INTEGER NOT NULL DEFAULT 0,
    "overflowEventUnitPriceCents" INTEGER NOT NULL DEFAULT 0,
    "overflowAffiliateUnitPriceCents" INTEGER NOT NULL DEFAULT 0,
    "overflowStorageMinutePriceCents" INTEGER NOT NULL DEFAULT 0,
    "paymentServiceFeeCents" INTEGER NOT NULL DEFAULT 0,
    "transactionFeeRateBps" INTEGER NOT NULL DEFAULT 0,
    "affiliateManagementFeeCents" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "description" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL
);
INSERT INTO "new_BillingPlan" ("code", "createdAt", "description", "id", "includedCredits", "includedStorageMinutes", "includedStreamMinutes", "monthlyPriceCents", "name", "overageCreditCostCents", "updatedAt") SELECT "code", "createdAt", "description", "id", "includedCredits", "includedStorageMinutes", "includedStreamMinutes", "monthlyPriceCents", "name", "overageCreditCostCents", "updatedAt" FROM "BillingPlan";
DROP TABLE "BillingPlan";
ALTER TABLE "new_BillingPlan" RENAME TO "BillingPlan";
CREATE UNIQUE INDEX "BillingPlan_code_key" ON "BillingPlan"("code");
CREATE TABLE "new_UsageRecord" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "vendorId" TEXT NOT NULL,
    "monthKey" TEXT,
    "recordType" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "unit" TEXT NOT NULL,
    "creditsDelta" INTEGER NOT NULL DEFAULT 0,
    "totalWatchMinutes" INTEGER NOT NULL DEFAULT 0,
    "totalEvents" INTEGER NOT NULL DEFAULT 0,
    "totalAffiliates" INTEGER NOT NULL DEFAULT 0,
    "totalStorageMinutes" INTEGER NOT NULL DEFAULT 0,
    "overflowWatchMinutes" INTEGER NOT NULL DEFAULT 0,
    "overflowEvents" INTEGER NOT NULL DEFAULT 0,
    "overflowAffiliates" INTEGER NOT NULL DEFAULT 0,
    "overflowStorageMinutes" INTEGER NOT NULL DEFAULT 0,
    "description" TEXT,
    "metadata" JSONB,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "UsageRecord_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "Vendor" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_UsageRecord" ("createdAt", "creditsDelta", "description", "id", "metadata", "quantity", "recordType", "unit", "vendorId") SELECT "createdAt", "creditsDelta", "description", "id", "metadata", "quantity", "recordType", "unit", "vendorId" FROM "UsageRecord";
DROP TABLE "UsageRecord";
ALTER TABLE "new_UsageRecord" RENAME TO "UsageRecord";
CREATE INDEX "UsageRecord_vendorId_monthKey_idx" ON "UsageRecord"("vendorId", "monthKey");
CREATE INDEX "UsageRecord_vendorId_createdAt_idx" ON "UsageRecord"("vendorId", "createdAt");
CREATE INDEX "UsageRecord_recordType_createdAt_idx" ON "UsageRecord"("recordType", "createdAt");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE INDEX "VendorSubscription_vendorId_status_idx" ON "VendorSubscription"("vendorId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "Invoice_invoiceNumber_key" ON "Invoice"("invoiceNumber");

-- CreateIndex
CREATE INDEX "Invoice_vendorId_monthKey_idx" ON "Invoice"("vendorId", "monthKey");

-- CreateIndex
CREATE INDEX "Settlement_status_monthKey_idx" ON "Settlement"("status", "monthKey");

-- CreateIndex
CREATE UNIQUE INDEX "Settlement_vendorId_monthKey_key" ON "Settlement"("vendorId", "monthKey");

-- CreateIndex
CREATE UNIQUE INDEX "PayoutBatch_batchNumber_key" ON "PayoutBatch"("batchNumber");

-- CreateIndex
CREATE INDEX "PayoutItem_payoutBatchId_status_idx" ON "PayoutItem"("payoutBatchId", "status");

-- CreateIndex
CREATE INDEX "PayoutItem_vendorId_createdAt_idx" ON "PayoutItem"("vendorId", "createdAt");

-- CreateIndex
CREATE INDEX "PaymentAccount_vendorId_mode_idx" ON "PaymentAccount"("vendorId", "mode");

-- CreateIndex
CREATE INDEX "PaymentTransaction_vendorId_occurredAt_idx" ON "PaymentTransaction"("vendorId", "occurredAt");

-- CreateIndex
CREATE INDEX "PaymentTransaction_status_occurredAt_idx" ON "PaymentTransaction"("status", "occurredAt");

-- CreateIndex
CREATE INDEX "AffiliateCommission_vendorId_monthKey_idx" ON "AffiliateCommission"("vendorId", "monthKey");

-- CreateIndex
CREATE INDEX "AffiliateCommission_affiliateId_status_idx" ON "AffiliateCommission"("affiliateId", "status");

-- CreateIndex
CREATE INDEX "AffiliatePayout_vendorId_monthKey_idx" ON "AffiliatePayout"("vendorId", "monthKey");

-- CreateIndex
CREATE INDEX "AffiliatePayout_affiliateId_status_idx" ON "AffiliatePayout"("affiliateId", "status");
