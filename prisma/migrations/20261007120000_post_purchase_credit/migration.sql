-- An upgrade consumes settled original money once, in the target checkout's
-- transaction. Refunds remain real provider events and invalidate access.
CREATE TABLE "PostPurchaseCredit" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "vendorId" TEXT NOT NULL,
  "sourceOrderId" TEXT NOT NULL,
  "targetOrderId" TEXT NOT NULL,
  "buyerGrantId" TEXT NOT NULL,
  "sourceProductId" TEXT NOT NULL,
  "targetProductId" TEXT NOT NULL,
  "kind" TEXT NOT NULL,
  "currency" TEXT NOT NULL,
  "creditAmountCents" INTEGER NOT NULL,
  "offerDiscountCents" INTEGER NOT NULL,
  "targetPriceCents" INTEGER NOT NULL,
  "checkoutAmountCents" INTEGER NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "invalidatedAt" TIMESTAMP(3),
  CONSTRAINT "PostPurchaseCredit_vendorId_id_key" UNIQUE ("vendorId", "id"),
  CONSTRAINT "PostPurchaseCredit_vendorId_sourceOrderId_key" UNIQUE ("vendorId", "sourceOrderId"),
  CONSTRAINT "PostPurchaseCredit_vendorId_targetOrderId_key" UNIQUE ("vendorId", "targetOrderId"),
  CONSTRAINT "PostPurchaseCredit_source_fkey" FOREIGN KEY ("vendorId", "sourceOrderId") REFERENCES "CommerceOrder"("vendorId", "id") ON DELETE RESTRICT,
  CONSTRAINT "PostPurchaseCredit_target_fkey" FOREIGN KEY ("vendorId", "targetOrderId") REFERENCES "CommerceOrder"("vendorId", "id") ON DELETE RESTRICT,
  CONSTRAINT "PostPurchaseCredit_grant_fkey" FOREIGN KEY ("vendorId", "sourceOrderId", "buyerGrantId") REFERENCES "BuyerSupportOrderGrant"("vendorId", "orderId", "id") ON DELETE RESTRICT,
  CONSTRAINT "PostPurchaseCredit_source_product_fkey" FOREIGN KEY ("vendorId", "sourceProductId") REFERENCES "Product"("vendorId", "id") ON DELETE RESTRICT,
  CONSTRAINT "PostPurchaseCredit_target_product_fkey" FOREIGN KEY ("vendorId", "targetProductId") REFERENCES "Product"("vendorId", "id") ON DELETE RESTRICT,
  CONSTRAINT "PostPurchaseCredit_amounts_check" CHECK (
    "creditAmountCents" > 0 AND "offerDiscountCents" >= 0 AND "targetPriceCents" > 0 AND "checkoutAmountCents" > 0
    AND "creditAmountCents"::BIGINT + "offerDiscountCents"::BIGINT + "checkoutAmountCents"::BIGINT = "targetPriceCents"::BIGINT
  ),
  CONSTRAINT "PostPurchaseCredit_scope_check" CHECK (
    "sourceOrderId" <> "targetOrderId" AND "sourceProductId" <> "targetProductId"
    AND "kind" IN ('upsell', 'downsell') AND "currency" ~ '^[A-Z]{3}$'
    AND ("kind" <> 'downsell' OR "offerDiscountCents" = 0)
  )
);
ALTER TABLE "PostPurchaseCredit" ENABLE ROW LEVEL SECURITY;

CREATE FUNCTION validate_post_purchase_credit() RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE source_order "CommerceOrder"%ROWTYPE;
DECLARE target_order "CommerceOrder"%ROWTYPE;
DECLARE source_product "Product"%ROWTYPE;
DECLARE target_product "Product"%ROWTYPE;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF (to_jsonb(NEW) - 'invalidatedAt') IS DISTINCT FROM (to_jsonb(OLD) - 'invalidatedAt')
       OR (OLD."invalidatedAt" IS NOT NULL AND NEW."invalidatedAt" IS DISTINCT FROM OLD."invalidatedAt") THEN
      RAISE EXCEPTION 'Post purchase credit snapshot is immutable' USING ERRCODE = '23514';
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
     OR NEW."invalidatedAt" IS NOT NULL
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
CREATE TRIGGER "PostPurchaseCredit_snapshot_guard" BEFORE INSERT OR UPDATE ON "PostPurchaseCredit"
  FOR EACH ROW EXECUTE FUNCTION validate_post_purchase_credit();

CREATE FUNCTION invalidate_refunded_post_purchase_credit() RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE target_id TEXT;
BEGIN
  IF NEW."refundedAmountCents" > OLD."refundedAmountCents" THEN
    UPDATE "PostPurchaseCredit" SET "invalidatedAt" = COALESCE("invalidatedAt", CURRENT_TIMESTAMP)
      WHERE "vendorId" = NEW."vendorId" AND "sourceOrderId" = NEW."id" RETURNING "targetOrderId" INTO target_id;
    IF target_id IS NOT NULL THEN
      UPDATE "CommerceEntitlement" SET "status" = 'revoked', "revokedAt" = CURRENT_TIMESTAMP,
        "accessEncryptedEnvelope" = NULL, "accessMaskedSummary" = NULL, "revision" = "revision" + 1
        WHERE "vendorId" = NEW."vendorId" AND "status" IN ('pending', 'granted')
        AND "orderItemId" IN (SELECT "id" FROM "CommerceOrderItem" WHERE "vendorId" = NEW."vendorId" AND "orderId" = target_id);
      UPDATE "CommerceOrderItemDeliverySnapshot" SET "revokedAt" = CURRENT_TIMESTAMP
        WHERE "vendorId" = NEW."vendorId" AND "orderId" = target_id AND "revokedAt" IS NULL;
      UPDATE "ShippingFulfillment" SET "status" = CASE WHEN "status" = 'shipped' THEN 'refund_review'::"ShippingFulfillmentStatus" ELSE 'cancelled'::"ShippingFulfillmentStatus" END,
        "cancelledAt" = CASE WHEN "status" <> 'shipped' THEN CURRENT_TIMESTAMP ELSE "cancelledAt" END,
        "refundReviewAt" = CASE WHEN "status" = 'shipped' THEN CURRENT_TIMESTAMP ELSE "refundReviewAt" END, "revision" = "revision" + 1
        WHERE "vendorId" = NEW."vendorId" AND "status" IN ('pending', 'packing', 'shipped')
        AND "orderItemId" IN (SELECT "id" FROM "CommerceOrderItem" WHERE "vendorId" = NEW."vendorId" AND "orderId" = target_id);
      UPDATE "ServiceFulfillment" SET "status" = 'cancelled', "cancelledAt" = CURRENT_TIMESTAMP, "revision" = "revision" + 1
        WHERE "vendorId" = NEW."vendorId" AND "status" IN ('pending', 'scheduling', 'scheduled')
        AND "orderItemId" IN (SELECT "id" FROM "CommerceOrderItem" WHERE "vendorId" = NEW."vendorId" AND "orderId" = target_id);
    END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "CommerceOrder_post_purchase_refund_guard" AFTER UPDATE OF "refundedAmountCents" ON "CommerceOrder"
  FOR EACH ROW EXECUTE FUNCTION invalidate_refunded_post_purchase_credit();
