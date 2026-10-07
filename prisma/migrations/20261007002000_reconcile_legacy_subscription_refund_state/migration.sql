-- Repair native checkout subscriptions whose full refund predates projection.
-- Persisted checkout identity and tenant-scoped processed ledger are authoritative.
UPDATE "VendorSubscription" subscription
SET "status" = 'payment_refunded', "endedAt" = COALESCE(subscription."endedAt", CURRENT_TIMESTAMP)
WHERE subscription."status" <> 'payment_refunded'
AND EXISTS (
 SELECT 1 FROM "PaymentTransaction" payment
 WHERE payment."vendorId" = subscription."vendorId"
 AND payment."metadata"->>'billingPurpose' = 'platform_subscription_checkout'
 AND payment."metadata"->>'platformSubscriptionId' = subscription."id"
 AND payment."metadata"->>'billingPlanId' = subscription."planId"
 AND payment."paymentMode" = 'platform' AND payment."status"::TEXT = 'refunded'
 AND payment."grossAmountCents" > 0 AND payment."refundedAmountCents" = payment."grossAmountCents"
 AND (SELECT COALESCE(sum(refund."refundAmountCents"), 0) FROM "RefundRecord" refund
 WHERE refund."vendorId" = payment."vendorId" AND refund."paymentTransactionId" = payment."id"
 AND refund."status"::TEXT = 'processed') = payment."grossAmountCents"
);

-- Preserve an independent active B and all usage counters/limits.
UPDATE "VendorUsageLimit" usage SET "entitlementStatus" = 'revoked'
WHERE NOT EXISTS (SELECT 1 FROM "VendorSubscription" active
 WHERE active."vendorId" = usage."vendorId" AND active."status" = 'active')
AND EXISTS (
 SELECT 1 FROM "VendorSubscription" subscription
 JOIN "PaymentTransaction" payment ON payment."vendorId" = subscription."vendorId"
 AND payment."metadata"->>'billingPurpose' = 'platform_subscription_checkout'
 AND payment."metadata"->>'platformSubscriptionId' = subscription."id"
 AND payment."metadata"->>'billingPlanId' = subscription."planId"
 WHERE subscription."vendorId" = usage."vendorId" AND subscription."planId" = usage."billingPlanId"
 AND subscription."status" = 'payment_refunded'
 AND payment."paymentMode" = 'platform' AND payment."status"::TEXT = 'refunded'
 AND payment."grossAmountCents" > 0 AND payment."refundedAmountCents" = payment."grossAmountCents"
 AND (SELECT COALESCE(sum(refund."refundAmountCents"), 0) FROM "RefundRecord" refund
 WHERE refund."vendorId" = payment."vendorId" AND refund."paymentTransactionId" = payment."id"
 AND refund."status"::TEXT = 'processed') = payment."grossAmountCents"
);
