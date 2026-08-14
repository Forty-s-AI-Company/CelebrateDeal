ALTER TABLE "AffiliateCommission"
ADD COLUMN IF NOT EXISTS "commissionBaseAmountCents" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN IF NOT EXISTS "netReferenceAmountCents" INTEGER NOT NULL DEFAULT 0;

UPDATE "AffiliateCommission"
SET "commissionBaseAmountCents" = "orderAmountCents"
WHERE "commissionBaseAmountCents" = 0;

UPDATE "AffiliateCommission" AS commission
SET "netReferenceAmountCents" = GREATEST(
  0,
  transaction."netAmountCents"
    - transaction."refundedAmountCents"
    + COALESCE(refund_totals."gatewayFeeRefundCents", 0)
    + COALESCE(refund_totals."platformFeeRefundCents", 0)
)
FROM "PaymentTransaction" AS transaction
LEFT JOIN (
  SELECT
    "paymentTransactionId",
    SUM("gatewayFeeRefundCents") AS "gatewayFeeRefundCents",
    SUM("platformFeeRefundCents") AS "platformFeeRefundCents"
  FROM "RefundRecord"
  WHERE "status" = 'processed'
  GROUP BY "paymentTransactionId"
) AS refund_totals ON refund_totals."paymentTransactionId" = transaction."id"
WHERE commission."sourceType" = 'webhook'
  AND commission."sourceId" = transaction."id"
  AND commission."vendorId" = transaction."vendorId";
