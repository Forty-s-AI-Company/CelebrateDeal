-- AlterTable
ALTER TABLE "RefundRecord" ADD COLUMN "providerEventId" TEXT;

-- CreateIndex
CREATE INDEX "RefundRecord_paymentTransactionId_providerEventId_idx" ON "RefundRecord"("paymentTransactionId", "providerEventId");
