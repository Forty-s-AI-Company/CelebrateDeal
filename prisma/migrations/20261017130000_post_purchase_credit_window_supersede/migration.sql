-- Owner rules for post-purchase credit:
--  1. A source order funds an upgrade only within 24 hours of its paid time.
--     The window is POST_PURCHASE_CREDIT_WINDOW_MS in
--     src/lib/post-purchase-upsell-access.ts; change both together.
--  2. Replace semantics: when the target payment is finalized as paid, the
--     credit is superseded and the SOURCE order's delivery is revoked in the
--     same transaction, so the buyer keeps only the target.
--  3. A physical source that has left the merchant (any status that requires
--     "shippedAt") cannot be upgraded.
-- Money recorded on a target that will never be delivered (paid after its
-- credit was released or invalidated, or a paid target revoked by a source
-- refund) is flagged to the merchant as a CommerceOrderEvent
-- "post_purchase.manual_review_required". Nothing is refunded automatically.
--
-- Source refund after supersede (decision): the refund trigger still revokes
-- the target. The returned source money was what funded the target, so the
-- target must not stay delivered on the difference alone; the source's own
-- delivery is already revoked, so revocation is idempotent and the merchant
-- receives a manual-review flag to refund the difference or re-grant.
--
-- New timestamps and the window use timezone('UTC', CURRENT_TIMESTAMP) because
-- Prisma stores TIMESTAMP(3) values in UTC regardless of the session zone.

ALTER TABLE "PostPurchaseCredit" ADD COLUMN "supersededAt" TIMESTAMP(3);

-- Generalizes revoke_post_purchase_target(): revokes delivery prepared for any
-- order bound by a credit (the target on refund/release, the source on supersede).
CREATE FUNCTION revoke_post_purchase_order(p_vendor_id TEXT, p_order_id TEXT) RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  UPDATE "CommerceEntitlement" SET "status" = 'revoked', "revokedAt" = CURRENT_TIMESTAMP,
    "accessEncryptedEnvelope" = NULL, "accessMaskedSummary" = NULL, "revision" = "revision" + 1
    WHERE "vendorId" = p_vendor_id AND "status" IN ('pending', 'granted')
    AND "orderItemId" IN (SELECT "id" FROM "CommerceOrderItem" WHERE "vendorId" = p_vendor_id AND "orderId" = p_order_id);
  UPDATE "CommerceOrderItemDeliverySnapshot" SET "revokedAt" = CURRENT_TIMESTAMP
    WHERE "vendorId" = p_vendor_id AND "orderId" = p_order_id AND "revokedAt" IS NULL;
  UPDATE "ShippingFulfillment" SET "status" = CASE WHEN "status" = 'shipped' THEN 'refund_review'::"ShippingFulfillmentStatus" ELSE 'cancelled'::"ShippingFulfillmentStatus" END,
    "cancelledAt" = CASE WHEN "status" <> 'shipped' THEN CURRENT_TIMESTAMP ELSE "cancelledAt" END,
    "refundReviewAt" = CASE WHEN "status" = 'shipped' THEN CURRENT_TIMESTAMP ELSE "refundReviewAt" END, "revision" = "revision" + 1
    WHERE "vendorId" = p_vendor_id AND "status" IN ('pending', 'packing', 'shipped')
    AND "orderItemId" IN (SELECT "id" FROM "CommerceOrderItem" WHERE "vendorId" = p_vendor_id AND "orderId" = p_order_id);
  UPDATE "ServiceFulfillment" SET "status" = 'cancelled', "cancelledAt" = CURRENT_TIMESTAMP, "revision" = "revision" + 1
    WHERE "vendorId" = p_vendor_id AND "status" IN ('pending', 'scheduling', 'scheduled')
    AND "orderItemId" IN (SELECT "id" FROM "CommerceOrderItem" WHERE "vendorId" = p_vendor_id AND "orderId" = p_order_id);
END $$;

-- One merchant-visible, deduplicated flag per credit and reason.
CREATE FUNCTION flag_post_purchase_manual_review(p_vendor_id TEXT, p_order_id TEXT, p_credit_id TEXT, p_reason TEXT, p_paid_amount_cents INTEGER)
RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO "CommerceOrderEvent" ("id", "vendorId", "orderId", "dedupKey", "eventType", "actorType", "sanitizedData", "occurredAt", "createdAt")
  VALUES (gen_random_uuid()::TEXT, p_vendor_id, p_order_id, 'post_purchase.manual_review:' || p_reason || ':' || p_credit_id,
    'post_purchase.manual_review_required', 'system',
    jsonb_build_object('reason', p_reason, 'creditId', p_credit_id, 'paidAmountCents', p_paid_amount_cents, 'autoRefund', false),
    timezone('UTC', CURRENT_TIMESTAMP), timezone('UTC', CURRENT_TIMESTAMP))
  ON CONFLICT ("vendorId", "orderId", "dedupKey") DO NOTHING;
END $$;

CREATE OR REPLACE FUNCTION validate_post_purchase_credit() RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE source_order "CommerceOrder"%ROWTYPE;
DECLARE target_order "CommerceOrder"%ROWTYPE;
DECLARE source_product "Product"%ROWTYPE;
DECLARE target_product "Product"%ROWTYPE;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    -- Money and bindings are immutable. invalidatedAt, releasedAt and
    -- supersededAt are each set at most once. A released credit is final; a
    -- superseded credit may still be invalidated by a later source refund.
    IF (to_jsonb(NEW) - 'invalidatedAt' - 'releasedAt' - 'supersededAt') IS DISTINCT FROM (to_jsonb(OLD) - 'invalidatedAt' - 'releasedAt' - 'supersededAt')
       OR (OLD."invalidatedAt" IS NOT NULL AND NEW."invalidatedAt" IS DISTINCT FROM OLD."invalidatedAt")
       OR (OLD."releasedAt" IS NOT NULL AND (NEW."releasedAt" IS DISTINCT FROM OLD."releasedAt"
         OR NEW."invalidatedAt" IS DISTINCT FROM OLD."invalidatedAt" OR NEW."supersededAt" IS DISTINCT FROM OLD."supersededAt"))
       OR (OLD."supersededAt" IS NOT NULL AND (NEW."supersededAt" IS DISTINCT FROM OLD."supersededAt"
         OR NEW."releasedAt" IS DISTINCT FROM OLD."releasedAt")) THEN
      RAISE EXCEPTION 'Post purchase credit snapshot is immutable' USING ERRCODE = '23514';
    END IF;
    IF OLD."releasedAt" IS NULL AND NEW."releasedAt" IS NOT NULL THEN
      -- Release only a valid credit whose own target ended without money.
      SELECT * INTO target_order FROM "CommerceOrder" WHERE "vendorId" = NEW."vendorId" AND "id" = NEW."targetOrderId" FOR UPDATE;
      IF NEW."invalidatedAt" IS NOT NULL OR NEW."supersededAt" IS NOT NULL OR target_order."id" IS NULL
         OR target_order."status" NOT IN ('payment_failed', 'expired')
         OR target_order."paidAmountCents" <> 0 OR target_order."refundedAmountCents" <> 0
         OR NOT EXISTS (SELECT 1 FROM "PaymentTransaction" WHERE "vendorId" = NEW."vendorId"
           AND "id" = target_order."primaryPaymentTransactionId" AND "status" IN ('failed', 'expired') AND "refundedAmountCents" = 0) THEN
        RAISE EXCEPTION 'Post purchase credit release unavailable' USING ERRCODE = '23514';
      END IF;
    END IF;
    IF OLD."supersededAt" IS NULL AND NEW."supersededAt" IS NOT NULL THEN
      -- Supersede only an active credit whose target is now fully paid.
      SELECT * INTO target_order FROM "CommerceOrder" WHERE "vendorId" = NEW."vendorId" AND "id" = NEW."targetOrderId" FOR UPDATE;
      IF NEW."releasedAt" IS NOT NULL OR NEW."invalidatedAt" IS NOT NULL OR target_order."id" IS NULL
         OR target_order."status" <> 'paid' OR target_order."paidAmountCents" <> target_order."totalAmountCents"
         OR target_order."refundedAmountCents" <> 0 THEN
        RAISE EXCEPTION 'Post purchase credit supersede unavailable' USING ERRCODE = '23514';
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
     -- POST_PURCHASE_CREDIT_WINDOW_MS (src/lib/post-purchase-upsell-access.ts): 24 hours, inclusive.
     OR source_order."paidAt" IS NULL OR source_order."paidAt" < timezone('UTC', CURRENT_TIMESTAMP) - INTERVAL '24 hours'
     OR source_order."currency" <> NEW."currency" OR target_order."currency" <> NEW."currency"
     OR target_order."status" <> 'pending_payment' OR target_order."isTestOrder" OR target_order."totalAmountCents" <> NEW."checkoutAmountCents"
     OR target_product."priceCents" <> NEW."targetPriceCents" OR NOT target_product."isActive" OR target_product."checkoutUrl" IS NOT NULL
     OR target_product."currency" <> NEW."currency" OR source_product."currency" <> NEW."currency"
     OR NOT target_product."fulfillmentTypeConfirmed" OR NOT source_product."isActive"
     OR (CASE NEW."kind" WHEN 'upsell' THEN source_product."upsellProductId" ELSE source_product."downsellProductId" END) IS DISTINCT FROM NEW."targetProductId"
     OR (CASE NEW."kind" WHEN 'upsell' THEN COALESCE(source_product."upsellDiscountCents", 0) ELSE 0 END) <> NEW."offerDiscountCents"
     OR NEW."invalidatedAt" IS NOT NULL OR NEW."releasedAt" IS NOT NULL OR NEW."supersededAt" IS NOT NULL
     OR NOT EXISTS (SELECT 1 FROM "BuyerSupportOrderGrant" WHERE "vendorId" = NEW."vendorId" AND "orderId" = NEW."sourceOrderId" AND "id" = NEW."buyerGrantId" AND "revokedAt" IS NULL AND "expiresAt" > CURRENT_TIMESTAMP)
     OR (SELECT count(*) FROM "CommerceOrderItem" WHERE "vendorId" = NEW."vendorId" AND "orderId" = NEW."sourceOrderId") <> 1
     OR NOT EXISTS (SELECT 1 FROM "CommerceOrderItem" WHERE "vendorId" = NEW."vendorId" AND "orderId" = NEW."sourceOrderId" AND "productId" = NEW."sourceProductId" AND "quantity" = 1)
     -- POST_PURCHASE_SHIPPED_SOURCE_STATUSES: every status that requires "shippedAt".
     OR EXISTS (SELECT 1 FROM "ShippingFulfillment" sf JOIN "CommerceOrderItem" item ON item."vendorId" = sf."vendorId" AND item."id" = sf."orderItemId"
       WHERE item."vendorId" = NEW."vendorId" AND item."orderId" = NEW."sourceOrderId" AND sf."status" IN ('shipped', 'refund_review', 'delivered', 'returned'))
     OR (SELECT count(*) FROM "CommerceOrderItem" WHERE "vendorId" = NEW."vendorId" AND "orderId" = NEW."targetOrderId") <> 1
     OR NOT EXISTS (SELECT 1 FROM "CommerceOrderItem" WHERE "vendorId" = NEW."vendorId" AND "orderId" = NEW."targetOrderId" AND "productId" = NEW."targetProductId" AND "quantity" = 1)
     OR EXISTS (SELECT 1 FROM "PostPurchaseCredit" WHERE "vendorId" = NEW."vendorId" AND "targetOrderId" = NEW."sourceOrderId") THEN
    RAISE EXCEPTION 'Post purchase source or target terms unavailable' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;

-- Only the source's single unreleased credit follows a source refund. Its
-- target is revoked even when already superseded (see header); a target that
-- had recorded money is flagged for manual merchant review.
CREATE OR REPLACE FUNCTION invalidate_refunded_post_purchase_credit() RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE target_id TEXT;
DECLARE credit_id TEXT;
DECLARE target_paid INTEGER;
BEGIN
  IF NEW."refundedAmountCents" > OLD."refundedAmountCents" THEN
    UPDATE "PostPurchaseCredit" SET "invalidatedAt" = COALESCE("invalidatedAt", CURRENT_TIMESTAMP)
      WHERE "vendorId" = NEW."vendorId" AND "sourceOrderId" = NEW."id" AND "releasedAt" IS NULL
      RETURNING "id", "targetOrderId" INTO credit_id, target_id;
    IF target_id IS NOT NULL THEN
      PERFORM revoke_post_purchase_order(NEW."vendorId", target_id);
      SELECT "paidAmountCents" INTO target_paid FROM "CommerceOrder" WHERE "vendorId" = NEW."vendorId" AND "id" = target_id;
      IF target_paid > 0 THEN
        PERFORM flag_post_purchase_manual_review(NEW."vendorId", target_id, credit_id, 'paid_target_revoked_by_source_refund', target_paid);
      END IF;
    END IF;
  END IF;
  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION revoke_released_post_purchase_target() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  -- A late provider payment on a released target persists money truth but
  -- must never deliver against the returned credit.
  PERFORM revoke_post_purchase_order(NEW."vendorId", NEW."targetOrderId");
  RETURN NEW;
END $$;
DROP FUNCTION revoke_post_purchase_target(TEXT, TEXT);

CREATE FUNCTION revoke_superseded_post_purchase_source() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  -- Replace semantics: the buyer keeps the paid target only.
  PERFORM revoke_post_purchase_order(NEW."vendorId", NEW."sourceOrderId");
  RETURN NEW;
END $$;
CREATE TRIGGER "PostPurchaseCredit_supersede_revokes_source" AFTER UPDATE OF "supersededAt" ON "PostPurchaseCredit"
  FOR EACH ROW WHEN (OLD."supersededAt" IS NULL AND NEW."supersededAt" IS NOT NULL)
  EXECUTE FUNCTION revoke_superseded_post_purchase_source();

-- Fires on the same UPDATE that reconcileCommerceOrderPaymentTransition uses
-- to mark an order paid (webhook, expiry reconciliation or any later path),
-- i.e. inside the transaction that grants the target's entitlements.
CREATE FUNCTION settle_paid_post_purchase_target() RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE credit "PostPurchaseCredit"%ROWTYPE;
BEGIN
  SELECT * INTO credit FROM "PostPurchaseCredit" WHERE "vendorId" = NEW."vendorId" AND "targetOrderId" = NEW."id" FOR UPDATE;
  IF credit."id" IS NULL OR credit."supersededAt" IS NOT NULL THEN
    RETURN NEW;
  END IF;
  IF credit."releasedAt" IS NULL AND credit."invalidatedAt" IS NULL THEN
    UPDATE "PostPurchaseCredit" SET "supersededAt" = timezone('UTC', CURRENT_TIMESTAMP)
      WHERE "vendorId" = NEW."vendorId" AND "id" = credit."id";
  ELSE
    -- Money recorded, nothing delivered: the merchant must decide.
    PERFORM flag_post_purchase_manual_review(NEW."vendorId", NEW."id", credit."id",
      CASE WHEN credit."releasedAt" IS NOT NULL THEN 'paid_after_credit_released' ELSE 'paid_after_source_refund' END,
      NEW."paidAmountCents");
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "CommerceOrder_post_purchase_paid_settle" AFTER UPDATE OF "status" ON "CommerceOrder"
  FOR EACH ROW WHEN (NEW."status" = 'paid' AND OLD."status" IS DISTINCT FROM 'paid')
  EXECUTE FUNCTION settle_paid_post_purchase_target();
