-- Keep historical counters/limits intact; revocation is a separate permission state.
ALTER TABLE "VendorUsageLimit" ADD COLUMN "entitlementStatus" TEXT NOT NULL DEFAULT 'active';
ALTER TABLE "VendorUsageLimit" ADD CONSTRAINT "VendorUsageLimit_entitlementStatus_check" CHECK ("entitlementStatus" IN ('active', 'revoked'));

-- Repair only native, fully processed refunded plans with no remaining active plan.
-- A newer active subscription always wins; no legacy usage amounts are rewritten.
UPDATE "VendorUsageLimit" usage SET "entitlementStatus" = 'revoked'
WHERE NOT EXISTS (SELECT 1 FROM "VendorSubscription" active WHERE active."vendorId" = usage."vendorId" AND active."status" = 'active')
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
 WHERE refund."vendorId" = payment."vendorId" AND refund."paymentTransactionId" = payment."id" AND refund."status"::TEXT = 'processed') = payment."grossAmountCents"
);
