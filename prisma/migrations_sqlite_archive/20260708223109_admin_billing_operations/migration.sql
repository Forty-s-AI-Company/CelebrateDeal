-- AlterTable
ALTER TABLE "PayoutBatch" ADD COLUMN "exportedAt" DATETIME;

-- AlterTable
ALTER TABLE "Settlement" ADD COLUMN "adjustmentReason" TEXT;
ALTER TABLE "Settlement" ADD COLUMN "lockedBy" TEXT;
ALTER TABLE "Settlement" ADD COLUMN "paidAt" DATETIME;

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_PayoutItem" (
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
    "paidAt" DATETIME,
    "retryCount" INTEGER NOT NULL DEFAULT 0,
    "retriedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "PayoutItem_payoutBatchId_fkey" FOREIGN KEY ("payoutBatchId") REFERENCES "PayoutBatch" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "PayoutItem_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "Vendor" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "PayoutItem_settlementId_fkey" FOREIGN KEY ("settlementId") REFERENCES "Settlement" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_PayoutItem" ("bankAccountName", "bankAccountNumber", "bankCode", "createdAt", "failReason", "id", "payoutAmountCents", "payoutBatchId", "retriedAt", "settlementId", "status", "updatedAt", "vendorId") SELECT "bankAccountName", "bankAccountNumber", "bankCode", "createdAt", "failReason", "id", "payoutAmountCents", "payoutBatchId", "retriedAt", "settlementId", "status", "updatedAt", "vendorId" FROM "PayoutItem";
DROP TABLE "PayoutItem";
ALTER TABLE "new_PayoutItem" RENAME TO "PayoutItem";
CREATE INDEX "PayoutItem_payoutBatchId_status_idx" ON "PayoutItem"("payoutBatchId", "status");
CREATE INDEX "PayoutItem_vendorId_createdAt_idx" ON "PayoutItem"("vendorId", "createdAt");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
