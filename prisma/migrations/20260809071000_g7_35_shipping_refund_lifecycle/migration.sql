-- G7-35B: add timestamps and enforce evidence for the new refund-aware states.

ALTER TABLE "ShippingFulfillment"
ADD COLUMN "refundReviewAt" TIMESTAMP(3),
ADD COLUMN "returnedAt" TIMESTAMP(3);

ALTER TABLE "ShippingFulfillment"
DROP CONSTRAINT "ShippingFulfillment_timestamps_check",
ADD CONSTRAINT "ShippingFulfillment_timestamps_check" CHECK (
  ("status" NOT IN ('shipped', 'refund_review', 'delivered', 'returned') OR "shippedAt" IS NOT NULL)
  AND ("status" <> 'refund_review' OR "refundReviewAt" IS NOT NULL)
  AND ("status" <> 'delivered' OR "deliveredAt" IS NOT NULL)
  AND ("status" <> 'returned' OR "returnedAt" IS NOT NULL)
  AND ("status" <> 'cancelled' OR "cancelledAt" IS NOT NULL)
);
