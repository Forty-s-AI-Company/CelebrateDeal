-- G7-26: preserve an explicit, immutable link for every canonical refund used
-- to satisfy a support handoff. One refund may prove only one handoff.

CREATE TABLE "SupportRefundHandoffRefund" (
  "vendorId" TEXT NOT NULL,
  "handoffId" TEXT NOT NULL,
  "orderId" TEXT NOT NULL,
  "refundId" TEXT NOT NULL,
  "amountCentsSnapshot" INTEGER NOT NULL,
  "linkedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "SupportRefundHandoffRefund_pkey" PRIMARY KEY ("vendorId", "handoffId", "refundId"),
  CONSTRAINT "SupportRefundHandoffRefund_amount_check" CHECK ("amountCentsSnapshot" > 0)
);

CREATE UNIQUE INDEX "SupportRefundHandoffRefund_vendorId_refundId_key"
ON "SupportRefundHandoffRefund"("vendorId", "refundId");
CREATE INDEX "SupportRefundHandoffRefund_vendorId_handoffId_linkedAt_idx"
ON "SupportRefundHandoffRefund"("vendorId", "handoffId", "linkedAt");

ALTER TABLE "SupportRefundHandoffRefund" ADD CONSTRAINT "SupportRefundHandoffRefund_handoff_tenant_fkey"
FOREIGN KEY ("vendorId", "handoffId") REFERENCES "SupportRefundHandoff"("vendorId", "id")
ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "SupportRefundHandoffRefund" ADD CONSTRAINT "SupportRefundHandoffRefund_refund_order_tenant_fkey"
FOREIGN KEY ("vendorId", "orderId", "refundId") REFERENCES "CommerceOrderRefund"("vendorId", "orderId", "id")
ON DELETE RESTRICT ON UPDATE CASCADE;

-- Fail closed if a legacy completion cannot satisfy the strengthened payment
-- transaction boundary. Omitting it from the backfill would leave a completed
-- handoff with no valid proof after this migration.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "SupportRefundHandoff" AS handoff
    LEFT JOIN "CommerceOrderRefund" AS refund
      ON refund."vendorId" = handoff."vendorId"
      AND refund."orderId" = handoff."orderId"
      AND refund."id" = handoff."completedRefundId"
    WHERE handoff."status" = 'completed'
      AND (
        refund."id" IS NULL
        OR refund."status" IS DISTINCT FROM 'processed'
        OR refund."amountCents" IS DISTINCT FROM handoff."requestedAmountCents"
        OR refund."paymentTransactionId" IS DISTINCT FROM handoff."paymentTransactionId"
      )
  ) THEN
    RAISE EXCEPTION 'G7-26 backfill rejected an invalid legacy support refund completion.'
      USING ERRCODE = '23514', CONSTRAINT = 'SupportRefundHandoff_backfill_check';
  END IF;
END;
$$;

-- Preserve every valid existing single-refund completion as the first link.
INSERT INTO "SupportRefundHandoffRefund" (
  "vendorId", "handoffId", "orderId", "refundId", "amountCentsSnapshot", "linkedAt"
)
SELECT
  handoff."vendorId",
  handoff."id",
  handoff."orderId",
  refund."id",
  refund."amountCents",
  COALESCE(handoff."completedAt", handoff."updatedAt")
FROM "SupportRefundHandoff" AS handoff
JOIN "CommerceOrderRefund" AS refund
  ON refund."vendorId" = handoff."vendorId"
  AND refund."orderId" = handoff."orderId"
  AND refund."id" = handoff."completedRefundId"
WHERE handoff."status" = 'completed';

CREATE FUNCTION enforce_support_refund_handoff_refund() RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  handoff_status "SupportRefundHandoffStatus";
  handoff_order_id TEXT;
  handoff_payment_id TEXT;
  refund_amount INTEGER;
  refund_status "CommerceOrderRefundStatus";
  refund_payment_id TEXT;
BEGIN
  IF TG_OP IN ('UPDATE', 'DELETE') THEN
    RAISE EXCEPTION 'Support refund completion links are immutable.'
      USING ERRCODE = '23514', CONSTRAINT = 'SupportRefundHandoffRefund_immutable_check';
  END IF;

  SELECT "status", "orderId", "paymentTransactionId"
  INTO handoff_status, handoff_order_id, handoff_payment_id
  FROM "SupportRefundHandoff"
  WHERE "vendorId" = NEW."vendorId" AND "id" = NEW."handoffId";

  SELECT "amountCents", "status", "paymentTransactionId"
  INTO refund_amount, refund_status, refund_payment_id
  FROM "CommerceOrderRefund"
  WHERE "vendorId" = NEW."vendorId"
    AND "orderId" = NEW."orderId"
    AND "id" = NEW."refundId";

  IF handoff_status IS DISTINCT FROM 'reviewing'
    OR handoff_order_id IS DISTINCT FROM NEW."orderId"
    OR refund_status IS DISTINCT FROM 'processed'
    OR refund_payment_id IS DISTINCT FROM handoff_payment_id
    OR refund_amount IS DISTINCT FROM NEW."amountCentsSnapshot"
  THEN
    RAISE EXCEPTION 'Support refund link must reference a matching processed canonical refund.'
      USING ERRCODE = '23514', CONSTRAINT = 'SupportRefundHandoffRefund_reference_check';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "SupportRefundHandoffRefund_reference_trigger"
BEFORE INSERT OR UPDATE OR DELETE ON "SupportRefundHandoffRefund"
FOR EACH ROW EXECUTE FUNCTION enforce_support_refund_handoff_refund();

CREATE FUNCTION enforce_linked_commerce_order_refund_immutable() RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "SupportRefundHandoffRefund" AS link
    WHERE link."vendorId" = OLD."vendorId" AND link."refundId" = OLD."id"
  ) AND (
    NEW."vendorId" IS DISTINCT FROM OLD."vendorId"
    OR NEW."orderId" IS DISTINCT FROM OLD."orderId"
    OR NEW."id" IS DISTINCT FROM OLD."id"
    OR NEW."paymentTransactionId" IS DISTINCT FROM OLD."paymentTransactionId"
    OR NEW."amountCents" IS DISTINCT FROM OLD."amountCents"
    OR NEW."status" IS DISTINCT FROM OLD."status"
  ) THEN
    RAISE EXCEPTION 'A canonical refund used by a support handoff is immutable.'
      USING ERRCODE = '23514', CONSTRAINT = 'CommerceOrderRefund_support_link_immutable_check';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "CommerceOrderRefund_support_link_immutable_trigger"
BEFORE UPDATE OF "vendorId", "orderId", "id", "paymentTransactionId", "amountCents", "status"
ON "CommerceOrderRefund"
FOR EACH ROW EXECUTE FUNCTION enforce_linked_commerce_order_refund_immutable();

CREATE OR REPLACE FUNCTION enforce_support_refund_handoff_order() RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  order_payment_id TEXT;
  order_status "CommerceOrderStatus";
  order_paid INTEGER;
  order_refunded INTEGER;
  completion_link_count INTEGER;
  completion_amount INTEGER;
  invalid_completion_count INTEGER;
BEGIN
  SELECT "primaryPaymentTransactionId", "status", "paidAmountCents", "refundedAmountCents"
  INTO order_payment_id, order_status, order_paid, order_refunded
  FROM "CommerceOrder"
  WHERE "vendorId" = NEW."vendorId" AND "id" = NEW."orderId";

  IF NOT FOUND
    OR order_payment_id IS DISTINCT FROM NEW."paymentTransactionId"
    OR order_status NOT IN ('paid', 'partially_refunded', 'refunded')
  THEN
    RAISE EXCEPTION 'Support refund handoff does not match a refundable canonical order.'
      USING ERRCODE = '23514', CONSTRAINT = 'SupportRefundHandoff_order_check';
  END IF;

  IF TG_OP = 'UPDATE' AND (
    NEW."vendorId" IS DISTINCT FROM OLD."vendorId"
    OR NEW."supportCaseId" IS DISTINCT FROM OLD."supportCaseId"
    OR NEW."orderId" IS DISTINCT FROM OLD."orderId"
    OR NEW."paymentTransactionId" IS DISTINCT FROM OLD."paymentTransactionId"
    OR NEW."requestedByMemberId" IS DISTINCT FROM OLD."requestedByMemberId"
    OR NEW."requestedAmountCents" IS DISTINCT FROM OLD."requestedAmountCents"
    OR NEW."reasonEncryptedEnvelope" IS DISTINCT FROM OLD."reasonEncryptedEnvelope"
    OR NEW."createdAt" IS DISTINCT FROM OLD."createdAt"
  ) THEN
    RAISE EXCEPTION 'Support refund handoff commercial identity is immutable.'
      USING ERRCODE = '23514', CONSTRAINT = 'SupportRefundHandoff_immutable_check';
  END IF;

  IF TG_OP = 'INSERT' AND NEW."requestedAmountCents" > order_paid - order_refunded THEN
    RAISE EXCEPTION 'Support refund handoff exceeds the remaining refundable amount.'
      USING ERRCODE = '23514', CONSTRAINT = 'SupportRefundHandoff_remaining_check';
  END IF;

  IF NEW."status" = 'completed' THEN
    SELECT
      COUNT(*)::INTEGER,
      COALESCE(SUM(link."amountCentsSnapshot"), 0)::INTEGER,
      COUNT(*) FILTER (
        WHERE refund."id" IS NULL
          OR refund."status" IS DISTINCT FROM 'processed'
          OR refund."paymentTransactionId" IS DISTINCT FROM NEW."paymentTransactionId"
          OR refund."amountCents" IS DISTINCT FROM link."amountCentsSnapshot"
      )::INTEGER
    INTO completion_link_count, completion_amount, invalid_completion_count
    FROM "SupportRefundHandoffRefund" AS link
    LEFT JOIN "CommerceOrderRefund" AS refund
      ON refund."vendorId" = link."vendorId"
      AND refund."orderId" = link."orderId"
      AND refund."id" = link."refundId"
    WHERE link."vendorId" = NEW."vendorId"
      AND link."handoffId" = NEW."id"
      AND link."orderId" = NEW."orderId";

    IF completion_link_count < 1
      OR completion_amount <> NEW."requestedAmountCents"
      OR invalid_completion_count > 0
      OR NOT EXISTS (
        SELECT 1
        FROM "SupportRefundHandoffRefund" AS anchor
        WHERE anchor."vendorId" = NEW."vendorId"
          AND anchor."handoffId" = NEW."id"
          AND anchor."refundId" = NEW."completedRefundId"
      )
    THEN
      RAISE EXCEPTION 'Support refund completion requires exact processed canonical refund links.'
        USING ERRCODE = '23514', CONSTRAINT = 'SupportRefundHandoff_completion_check';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
