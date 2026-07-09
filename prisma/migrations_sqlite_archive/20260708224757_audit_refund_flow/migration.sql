-- CreateTable
CREATE TABLE "RefundRecord" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "vendorId" TEXT NOT NULL,
    "paymentTransactionId" TEXT NOT NULL,
    "monthKey" TEXT NOT NULL,
    "refundAmountCents" INTEGER NOT NULL,
    "gatewayFeeRefundCents" INTEGER NOT NULL DEFAULT 0,
    "platformFeeRefundCents" INTEGER NOT NULL DEFAULT 0,
    "reason" TEXT,
    "status" TEXT NOT NULL DEFAULT 'processed',
    "processedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "RefundRecord_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "Vendor" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "RefundRecord_paymentTransactionId_fkey" FOREIGN KEY ("paymentTransactionId") REFERENCES "PaymentTransaction" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "vendorId" TEXT,
    "actorId" TEXT,
    "actorLabel" TEXT,
    "action" TEXT NOT NULL,
    "targetType" TEXT NOT NULL,
    "targetId" TEXT,
    "before" JSONB,
    "after" JSONB,
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AuditLog_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "Vendor" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_PaymentTransaction" (
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
    "refundedAmountCents" INTEGER NOT NULL DEFAULT 0,
    "refundReason" TEXT,
    "refundedAt" DATETIME,
    "occurredAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "metadata" JSONB,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PaymentTransaction_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "Vendor" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
INSERT INTO "new_PaymentTransaction" ("createdAt", "currency", "gatewayFeeCents", "grossAmountCents", "id", "metadata", "netAmountCents", "occurredAt", "orderNumber", "paymentMode", "platformFeeCents", "providerName", "providerTradeNo", "status", "vendorId") SELECT "createdAt", "currency", "gatewayFeeCents", "grossAmountCents", "id", "metadata", "netAmountCents", "occurredAt", "orderNumber", "paymentMode", "platformFeeCents", "providerName", "providerTradeNo", "status", "vendorId" FROM "PaymentTransaction";
DROP TABLE "PaymentTransaction";
ALTER TABLE "new_PaymentTransaction" RENAME TO "PaymentTransaction";
CREATE INDEX "PaymentTransaction_vendorId_occurredAt_idx" ON "PaymentTransaction"("vendorId", "occurredAt");
CREATE INDEX "PaymentTransaction_status_occurredAt_idx" ON "PaymentTransaction"("status", "occurredAt");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE INDEX "RefundRecord_vendorId_monthKey_idx" ON "RefundRecord"("vendorId", "monthKey");

-- CreateIndex
CREATE INDEX "RefundRecord_paymentTransactionId_processedAt_idx" ON "RefundRecord"("paymentTransactionId", "processedAt");

-- CreateIndex
CREATE INDEX "AuditLog_vendorId_createdAt_idx" ON "AuditLog"("vendorId", "createdAt");

-- CreateIndex
CREATE INDEX "AuditLog_action_createdAt_idx" ON "AuditLog"("action", "createdAt");

-- CreateIndex
CREATE INDEX "AuditLog_targetType_targetId_idx" ON "AuditLog"("targetType", "targetId");
