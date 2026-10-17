-- Recovery guard and merchant signals for post-purchase credit (forward-only;
-- 20261017120000 and 20261017130000 are unchanged).
--  * Resume never bypasses the 24-hour window or the shipped-source rule; the
--    application refuses and releases such a credit. The existing release guard
--    already accepts any unpaid payment_failed/expired target, which is the only
--    state resume acts on, so "recovery lapsed" needs no new guard. Pending
--    targets stay non-releasable because the provider may still settle them.
--  * Supersede never moves a source shipment that has already left the
--    merchant: it is left as-is and flagged `superseded_source_already_shipped`.
--  * Supersede records `post_purchase.superseded` on the source timeline.
--  * A refund of a superseded target flags both orders
--    (`superseded_target_refunded`). Nothing is refunded or restored automatically.
--  * New timestamps and clock comparisons use timezone('UTC', CURRENT_TIMESTAMP)
--    because Prisma stores TIMESTAMP(3) in UTC.

-- p_shipped_to_review=true (refund/release of a target): a shipped item moves to
-- refund_review. false (supersede of a source): shipped-state items are untouched.
CREATE FUNCTION revoke_post_purchase_order(p_vendor_id TEXT, p_order_id TEXT, p_shipped_to_review BOOLEAN) RETURNS VOID LANGUAGE plpgsql AS $$
DECLARE now_utc TIMESTAMP(3) := timezone('UTC', CURRENT_TIMESTAMP);
BEGIN
  UPDATE "CommerceEntitlement" SET "status" = 'revoked', "revokedAt" = now_utc,
    "accessEncryptedEnvelope" = NULL, "accessMaskedSummary" = NULL, "revision" = "revision" + 1
    WHERE "vendorId" = p_vendor_id AND "status" IN ('pending', 'granted')
    AND "orderItemId" IN (SELECT "id" FROM "CommerceOrderItem" WHERE "vendorId" = p_vendor_id AND "orderId" = p_order_id);
  UPDATE "CommerceOrderItemDeliverySnapshot" SET "revokedAt" = now_utc
    WHERE "vendorId" = p_vendor_id AND "orderId" = p_order_id AND "revokedAt" IS NULL;
  UPDATE "ShippingFulfillment" SET "status" = CASE WHEN "status" = 'shipped' THEN 'refund_review'::"ShippingFulfillmentStatus" ELSE 'cancelled'::"ShippingFulfillmentStatus" END,
    "cancelledAt" = CASE WHEN "status" <> 'shipped' THEN now_utc ELSE "cancelledAt" END,
    "refundReviewAt" = CASE WHEN "status" = 'shipped' THEN now_utc ELSE "refundReviewAt" END, "revision" = "revision" + 1
    WHERE "vendorId" = p_vendor_id
    AND ("status" IN ('pending', 'packing') OR (p_shipped_to_review AND "status" = 'shipped'))
    AND "orderItemId" IN (SELECT "id" FROM "CommerceOrderItem" WHERE "vendorId" = p_vendor_id AND "orderId" = p_order_id);
  UPDATE "ServiceFulfillment" SET "status" = 'cancelled', "cancelledAt" = now_utc, "revision" = "revision" + 1
    WHERE "vendorId" = p_vendor_id AND "status" IN ('pending', 'scheduling', 'scheduled')
    AND "orderItemId" IN (SELECT "id" FROM "CommerceOrderItem" WHERE "vendorId" = p_vendor_id AND "orderId" = p_order_id);
END $$;

-- One merchant-visible, deduplicated flag per order, credit and reason.
-- p_data carries only server-owned identifiers and amounts.
CREATE FUNCTION flag_post_purchase_manual_review(p_vendor_id TEXT, p_order_id TEXT, p_credit_id TEXT, p_reason TEXT, p_data JSONB)
RETURNS VOID LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO "CommerceOrderEvent" ("id", "vendorId", "orderId", "dedupKey", "eventType", "actorType", "sanitizedData", "occurredAt", "createdAt")
  VALUES (gen_random_uuid()::TEXT, p_vendor_id, p_order_id, 'post_purchase.manual_review:' || p_reason || ':' || p_credit_id,
    'post_purchase.manual_review_required', 'system',
    jsonb_build_object('reason', p_reason, 'creditId', p_credit_id, 'autoRefund', false) || COALESCE(p_data, '{}'::JSONB),
    timezone('UTC', CURRENT_TIMESTAMP), timezone('UTC', CURRENT_TIMESTAMP))
  ON CONFLICT ("vendorId", "orderId", "dedupKey") DO NOTHING;
END $$;

-- Unchanged from 20261017130000 except the grant expiry compares UTC with UTC.
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
     OR NOT EXISTS (SELECT 1 FROM "BuyerSupportOrderGrant" WHERE "vendorId" = NEW."vendorId" AND "orderId" = NEW."sourceOrderId" AND "id" = NEW."buyerGrantId" AND "revokedAt" IS NULL AND "expiresAt" > timezone('UTC', CURRENT_TIMESTAMP))
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

-- Source refund: the single unreleased credit follows it (see 20261017130000).
-- Target refund: a superseded target's refund leaves the buyer with neither
-- order delivered, so both orders are flagged for manual merchant review.
CREATE OR REPLACE FUNCTION invalidate_refunded_post_purchase_credit() RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE target_id TEXT;
DECLARE credit_id TEXT;
DECLARE target_paid INTEGER;
DECLARE superseded "PostPurchaseCredit"%ROWTYPE;
BEGIN
  IF NEW."refundedAmountCents" > OLD."refundedAmountCents" THEN
    UPDATE "PostPurchaseCredit" SET "invalidatedAt" = COALESCE("invalidatedAt", timezone('UTC', CURRENT_TIMESTAMP))
      WHERE "vendorId" = NEW."vendorId" AND "sourceOrderId" = NEW."id" AND "releasedAt" IS NULL
      RETURNING "id", "targetOrderId" INTO credit_id, target_id;
    IF target_id IS NOT NULL THEN
      PERFORM revoke_post_purchase_order(NEW."vendorId", target_id, TRUE);
      SELECT "paidAmountCents" INTO target_paid FROM "CommerceOrder" WHERE "vendorId" = NEW."vendorId" AND "id" = target_id;
      IF target_paid > 0 THEN
        PERFORM flag_post_purchase_manual_review(NEW."vendorId", target_id, credit_id, 'paid_target_revoked_by_source_refund',
          jsonb_build_object('paidAmountCents', target_paid));
      END IF;
    END IF;
    SELECT * INTO superseded FROM "PostPurchaseCredit"
      WHERE "vendorId" = NEW."vendorId" AND "targetOrderId" = NEW."id" AND "supersededAt" IS NOT NULL;
    IF superseded."id" IS NOT NULL THEN
      PERFORM flag_post_purchase_manual_review(NEW."vendorId", NEW."id", superseded."id", 'superseded_target_refunded',
        jsonb_build_object('sourceOrderId', superseded."sourceOrderId", 'targetOrderId', NEW."id",
          'creditAmountCents', superseded."creditAmountCents", 'targetRefundedAmountCents', NEW."refundedAmountCents"));
      PERFORM flag_post_purchase_manual_review(NEW."vendorId", superseded."sourceOrderId", superseded."id", 'superseded_target_refunded',
        jsonb_build_object('sourceOrderId', superseded."sourceOrderId", 'targetOrderId', NEW."id",
          'creditAmountCents', superseded."creditAmountCents", 'targetRefundedAmountCents', NEW."refundedAmountCents"));
    END IF;
  END IF;
  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION revoke_released_post_purchase_target() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  -- A late provider payment on a released target persists money truth but
  -- must never deliver against the returned credit.
  PERFORM revoke_post_purchase_order(NEW."vendorId", NEW."targetOrderId", TRUE);
  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION revoke_superseded_post_purchase_source() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  -- Replace semantics: the buyer keeps the paid target only. The source
  -- timeline records why its delivery was revoked.
  INSERT INTO "CommerceOrderEvent" ("id", "vendorId", "orderId", "dedupKey", "eventType", "actorType", "sanitizedData", "occurredAt", "createdAt")
  VALUES (gen_random_uuid()::TEXT, NEW."vendorId", NEW."sourceOrderId", 'post_purchase.superseded:' || NEW."id",
    'post_purchase.superseded', 'system',
    jsonb_build_object('creditId', NEW."id", 'targetOrderId', NEW."targetOrderId", 'kind', NEW."kind"),
    timezone('UTC', CURRENT_TIMESTAMP), timezone('UTC', CURRENT_TIMESTAMP))
  ON CONFLICT ("vendorId", "orderId", "dedupKey") DO NOTHING;
  -- A source shipped after the credit was taken stays as-is (the goods have
  -- left); the merchant decides on return or charge-back.
  IF EXISTS (SELECT 1 FROM "ShippingFulfillment" sf JOIN "CommerceOrderItem" item ON item."vendorId" = sf."vendorId" AND item."id" = sf."orderItemId"
      WHERE item."vendorId" = NEW."vendorId" AND item."orderId" = NEW."sourceOrderId"
      AND sf."status" IN ('shipped', 'refund_review', 'delivered', 'returned')) THEN
    PERFORM flag_post_purchase_manual_review(NEW."vendorId", NEW."sourceOrderId", NEW."id", 'superseded_source_already_shipped',
      jsonb_build_object('sourceOrderId', NEW."sourceOrderId", 'targetOrderId', NEW."targetOrderId", 'creditAmountCents', NEW."creditAmountCents"));
  END IF;
  PERFORM revoke_post_purchase_order(NEW."vendorId", NEW."sourceOrderId", FALSE);
  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION settle_paid_post_purchase_target() RETURNS TRIGGER LANGUAGE plpgsql AS $$
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
      jsonb_build_object('paidAmountCents', NEW."paidAmountCents"));
  END IF;
  RETURN NEW;
END $$;

DROP FUNCTION revoke_post_purchase_order(TEXT, TEXT);
DROP FUNCTION flag_post_purchase_manual_review(TEXT, TEXT, TEXT, TEXT, INTEGER);
