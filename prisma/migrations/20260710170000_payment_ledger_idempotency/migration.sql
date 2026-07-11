-- Payment, refund, and commission idempotency constraints.
-- Preflight duplicate queries are documented in docs/database/payment-ledger-migration.md.
CREATE UNIQUE INDEX "PaymentTransaction_providerName_orderNumber_key"
ON "PaymentTransaction"("providerName", "orderNumber");

CREATE UNIQUE INDEX "RefundRecord_paymentTransactionId_providerEventId_key"
ON "RefundRecord"("paymentTransactionId", "providerEventId");

CREATE UNIQUE INDEX "AffiliateCommission_vendorId_sourceType_sourceId_key"
ON "AffiliateCommission"("vendorId", "sourceType", "sourceId");

ALTER TABLE "PaymentTransaction"
ADD CONSTRAINT "PaymentTransaction_refund_not_over_gross"
CHECK ("refundedAmountCents" >= 0 AND "refundedAmountCents" <= "grossAmountCents");
