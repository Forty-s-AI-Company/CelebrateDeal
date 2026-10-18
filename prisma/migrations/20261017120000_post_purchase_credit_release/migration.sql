-- A credit whose own target payment ended unpaid (provider failure or the
-- reservation expiring) is released so the source order can be quoted again.
-- At most one unreleased credit may exist per source order; released rows are
-- retained as immutable history and are never delivered or refunded.
ALTER TABLE "PostPurchaseCredit" ADD COLUMN "releasedAt" TIMESTAMP(3);

ALTER TABLE "PostPurchaseCredit" DROP CONSTRAINT "PostPurchaseCredit_vendorId_sourceOrderId_key";
CREATE INDEX "PostPurchaseCredit_vendorId_sourceOrderId_idx" ON "PostPurchaseCredit"("vendorId", "sourceOrderId");
-- Prisma cannot model a partial unique index; this is the authoritative
-- one-active-credit-per-source race barrier for upsell and downsell together.
CREATE UNIQUE INDEX "PostPurchaseCredit_vendorId_sourceOrderId_active_key"
  ON "PostPurchaseCredit"("vendorId", "sourceOrderId") WHERE "releasedAt" IS NULL;

-- Revokes any delivery prepared for a credited target order. Shared by source
-- refund invalidation and release, so neither can later be delivered.
CREATE FUNCTION revoke_post_purchase_target(p_vendor_id TEXT, p_target_id TEXT) RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  UPDATE "CommerceEntitlement" SET "status" = 'revoked', "revokedAt" = CURRENT_TIMESTAMP,
    "accessEncryptedEnvelope" = NULL, "accessMaskedSummary" = NULL, "revision" = "revision" + 1
    WHERE "vendorId" = p_vendor_id AND "status" IN ('pending', 'granted')
    AND "orderItemId" IN (SELECT "id" FROM "CommerceOrderItem" WHERE "vendorId" = p_vendor_id AND "orderId" = p_target_id);
  UPDATE "CommerceOrderItemDeliverySnapshot" SET "revokedAt" = CURRENT_TIMESTAMP
    WHERE "vendorId" = p_vendor_id AND "orderId" = p_target_id AND "revokedAt" IS NULL;
  UPDATE "ShippingFulfillment" SET "status" = CASE WHEN "status" = 'shipped' THEN 'refund_review'::"ShippingFulfillmentStatus" ELSE 'cancelled'::"ShippingFulfillmentStatus" END,
    "cancelledAt" = CASE WHEN "status" <> 'shipped' THEN CURRENT_TIMESTAMP ELSE "cancelledAt" END,
    "refundReviewAt" = CASE WHEN "status" = 'shipped' THEN CURRENT_TIMESTAMP ELSE "refundReviewAt" END, "revision" = "revision" + 1
    WHERE "vendorId" = p_vendor_id AND "status" IN ('pending', 'packing', 'shipped')
    AND "orderItemId" IN (SELECT "id" FROM "CommerceOrderItem" WHERE "vendorId" = p_vendor_id AND "orderId" = p_target_id);
  UPDATE "ServiceFulfillment" SET "status" = 'cancelled', "cancelledAt" = CURRENT_TIMESTAMP, "revision" = "revision" + 1
    WHERE "vendorId" = p_vendor_id AND "status" IN ('pending', 'scheduling', 'scheduled')
    AND "orderItemId" IN (SELECT "id" FROM "CommerceOrderItem" WHERE "vendorId" = p_vendor_id AND "orderId" = p_target_id);
END $$;

CREATE OR REPLACE FUNCTION validate_post_purchase_credit() RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE source_order "CommerceOrder"%ROWTYPE;
DECLARE target_order "CommerceOrder"%ROWTYPE;
DECLARE source_product "Product"%ROWTYPE;
DECLARE target_product "Product"%ROWTYPE;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    -- Money and bindings are immutable. invalidatedAt and releasedAt are each
    -- set at most once, and a released credit can no longer be invalidated.
    IF (to_jsonb(NEW) - 'invalidatedAt' - 'releasedAt') IS DISTINCT FROM (to_jsonb(OLD) - 'invalidatedAt' - 'releasedAt')
       OR (OLD."invalidatedAt" IS NOT NULL AND NEW."invalidatedAt" IS DISTINCT FROM OLD."invalidatedAt")
       OR (OLD."releasedAt" IS NOT NULL AND (NEW."releasedAt" IS DISTINCT FROM OLD."releasedAt"
         OR NEW."invalidatedAt" IS DISTINCT FROM OLD."invalidatedAt")) THEN
      RAISE EXCEPTION 'Post purchase credit snapshot is immutable' USING ERRCODE = '23514';
    END IF;
    IF OLD."releasedAt" IS NULL AND NEW."releasedAt" IS NOT NULL THEN
      -- Release only a valid credit whose own target ended without money.
      SELECT * INTO target_order FROM "CommerceOrder" WHERE "vendorId" = NEW."vendorId" AND "id" = NEW."targetOrderId" FOR UPDATE;
      IF NEW."invalidatedAt" IS NOT NULL OR target_order."id" IS NULL
         OR target_order."status" NOT IN ('payment_failed', 'expired')
         OR target_order."paidAmountCents" <> 0 OR target_order."refundedAmountCents" <> 0
         OR NOT EXISTS (SELECT 1 FROM "PaymentTransaction" WHERE "vendorId" = NEW."vendorId"
           AND "id" = target_order."primaryPaymentTransactionId" AND "status" IN ('failed', 'expired') AND "refundedAmountCents" = 0) THEN
        RAISE EXCEPTION 'Post purchase credit release unavailable' USING ERRCODE = '23514';
      END IF;
    END IF;
    RETURN NEW;
  END IF;
  -- Lock source and target money before recording the credit. A concurrent
  -- refund cannot commit between eligibility and the one-time binding.
  SELECT * INTO source_order FROM "CommerceOrder" WHERE "vendorId" = NEW."vendorId" AND "id" = NEW."sourceOrderId" FOR UPDATE;
  SELECT * INTO target_order FROM "CommerceOrder" WHERE "vendorId" = NEW."vendorId" AND "id" = NEW."targetOrderId" FOR UPDATE;
  SELECT * INTO source_product FROM "Product" WHERE "vendorId" = NEW."vendorId" AND "id" = NEW."sourceProductId";
  SELECT * INTO target_product FROM "Product" WHERE "vendorId" = NEW."vendorId" AND "id" = NEW."targetProductId";
  IF source_order."id" IS NULL OR target_order."id" IS NULL
     OR source_order."status" <> 'paid' OR source_order."isTestOrder" OR source_order."refundedAmountCents" <> 0
     OR source_order."paidAmountCents" <> NEW."creditAmountCents" OR source_order."paidAmountCents" <> source_order."totalAmountCents"
     OR source_order."currency" <> NEW."currency" OR target_order."currency" <> NEW."currency"
     OR target_order."status" <> 'pending_payment' OR target_order."isTestOrder" OR target_order."totalAmountCents" <> NEW."checkoutAmountCents"
     OR target_product."priceCents" <> NEW."targetPriceCents" OR NOT target_product."isActive" OR target_product."checkoutUrl" IS NOT NULL
     OR target_product."currency" <> NEW."currency" OR source_product."currency" <> NEW."currency"
     OR NOT target_product."fulfillmentTypeConfirmed" OR NOT source_product."isActive"
     OR (CASE NEW."kind" WHEN 'upsell' THEN source_product."upsellProductId" ELSE source_product."downsellProductId" END) IS DISTINCT FROM NEW."targetProductId"
     OR (CASE NEW."kind" WHEN 'upsell' THEN COALESCE(source_product."upsellDiscountCents", 0) ELSE 0 END) <> NEW."offerDiscountCents"
     OR NEW."invalidatedAt" IS NOT NULL OR NEW."releasedAt" IS NOT NULL
     OR NOT EXISTS (SELECT 1 FROM "BuyerSupportOrderGrant" WHERE "vendorId" = NEW."vendorId" AND "orderId" = NEW."sourceOrderId" AND "id" = NEW."buyerGrantId" AND "revokedAt" IS NULL AND "expiresAt" > CURRENT_TIMESTAMP)
     OR (SELECT count(*) FROM "CommerceOrderItem" WHERE "vendorId" = NEW."vendorId" AND "orderId" = NEW."sourceOrderId") <> 1
     OR NOT EXISTS (SELECT 1 FROM "CommerceOrderItem" WHERE "vendorId" = NEW."vendorId" AND "orderId" = NEW."sourceOrderId" AND "productId" = NEW."sourceProductId" AND "quantity" = 1)
     OR (SELECT count(*) FROM "CommerceOrderItem" WHERE "vendorId" = NEW."vendorId" AND "orderId" = NEW."targetOrderId") <> 1
     OR NOT EXISTS (SELECT 1 FROM "CommerceOrderItem" WHERE "vendorId" = NEW."vendorId" AND "orderId" = NEW."targetOrderId" AND "productId" = NEW."targetProductId" AND "quantity" = 1)
     OR EXISTS (SELECT 1 FROM "PostPurchaseCredit" WHERE "vendorId" = NEW."vendorId" AND "targetOrderId" = NEW."sourceOrderId") THEN
    RAISE EXCEPTION 'Post purchase source or target terms unavailable' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;

-- Only the source's single unreleased credit follows a source refund.
CREATE OR REPLACE FUNCTION invalidate_refunded_post_purchase_credit() RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE target_id TEXT;
BEGIN
  IF NEW."refundedAmountCents" > OLD."refundedAmountCents" THEN
    UPDATE "PostPurchaseCredit" SET "invalidatedAt" = COALESCE("invalidatedAt", CURRENT_TIMESTAMP)
      WHERE "vendorId" = NEW."vendorId" AND "sourceOrderId" = NEW."id" AND "releasedAt" IS NULL RETURNING "targetOrderId" INTO target_id;
    IF target_id IS NOT NULL THEN
      PERFORM revoke_post_purchase_target(NEW."vendorId", target_id);
    END IF;
  END IF;
  RETURN NEW;
END $$;

CREATE FUNCTION revoke_released_post_purchase_target() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  -- A late provider payment on a released target persists money truth but
  -- must never deliver against the returned credit.
  PERFORM revoke_post_purchase_target(NEW."vendorId", NEW."targetOrderId");
  RETURN NEW;
END $$;
CREATE TRIGGER "PostPurchaseCredit_release_revokes_target" AFTER UPDATE OF "releasedAt" ON "PostPurchaseCredit"
  FOR EACH ROW WHEN (OLD."releasedAt" IS NULL AND NEW."releasedAt" IS NOT NULL)
  EXECUTE FUNCTION revoke_released_post_purchase_target();
