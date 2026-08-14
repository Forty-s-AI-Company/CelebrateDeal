-- G7-09B: tenant-scoped merchant support workflow and refund handoff.
-- Free-form support content is encrypted by the application; these tables
-- contain only workflow metadata, opaque envelopes and canonical references.

CREATE TYPE "SupportCaseStatus" AS ENUM ('open', 'in_progress', 'waiting_customer', 'waiting_finance', 'resolved', 'closed');
CREATE TYPE "SupportCasePriority" AS ENUM ('p0', 'p1', 'p2');
CREATE TYPE "SupportCaseCategory" AS ENUM ('payment', 'refund', 'fulfillment', 'access', 'general');
CREATE TYPE "SupportCaseEventType" AS ENUM ('created', 'note_added', 'status_changed', 'assignment_changed', 'refund_requested', 'refund_review_started', 'refund_declined', 'refund_completed');
CREATE TYPE "SupportRefundHandoffStatus" AS ENUM ('requested', 'reviewing', 'declined', 'completed');

CREATE TABLE "SupportCase" (
  "id" TEXT NOT NULL,
  "vendorId" TEXT NOT NULL,
  "orderId" TEXT NOT NULL,
  "caseNumber" TEXT NOT NULL,
  "intakeKey" TEXT NOT NULL,
  "category" "SupportCaseCategory" NOT NULL,
  "priority" "SupportCasePriority" NOT NULL,
  "status" "SupportCaseStatus" NOT NULL DEFAULT 'open',
  "revision" INTEGER NOT NULL DEFAULT 1,
  "createdByMemberId" TEXT NOT NULL,
  "assignedMemberId" TEXT,
  "firstRespondedAt" TIMESTAMP(3),
  "resolvedAt" TIMESTAMP(3),
  "closedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "SupportCase_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "SupportCaseEvent" (
  "id" TEXT NOT NULL,
  "vendorId" TEXT NOT NULL,
  "supportCaseId" TEXT NOT NULL,
  "dedupKey" TEXT NOT NULL,
  "eventType" "SupportCaseEventType" NOT NULL,
  "actorMemberId" TEXT,
  "actorUserId" TEXT,
  "payloadEncryptedEnvelope" TEXT,
  "sanitizedData" JSONB,
  "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "SupportCaseEvent_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "SupportRefundHandoff" (
  "id" TEXT NOT NULL,
  "vendorId" TEXT NOT NULL,
  "supportCaseId" TEXT NOT NULL,
  "orderId" TEXT NOT NULL,
  "paymentTransactionId" TEXT NOT NULL,
  "requestedByMemberId" TEXT NOT NULL,
  "requestedAmountCents" INTEGER NOT NULL,
  "reasonEncryptedEnvelope" TEXT NOT NULL,
  "status" "SupportRefundHandoffStatus" NOT NULL DEFAULT 'requested',
  "revision" INTEGER NOT NULL DEFAULT 1,
  "completedRefundId" TEXT,
  "reviewedByActorId" TEXT,
  "reviewedAt" TIMESTAMP(3),
  "completedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "SupportRefundHandoff_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "SupportCase"
ADD CONSTRAINT "SupportCase_revision_check" CHECK ("revision" > 0),
ADD CONSTRAINT "SupportCase_number_check" CHECK ("caseNumber" ~ '^SC-[0-9]{8}-[A-F0-9]{8}$'),
ADD CONSTRAINT "SupportCase_intake_key_check" CHECK ("intakeKey" ~ '^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'),
ADD CONSTRAINT "SupportCase_lifecycle_check" CHECK (
  (
    "status" IN ('open', 'in_progress', 'waiting_customer', 'waiting_finance')
    AND "resolvedAt" IS NULL
    AND "closedAt" IS NULL
  )
  OR ("status" = 'resolved' AND "resolvedAt" IS NOT NULL AND "closedAt" IS NULL)
  OR ("status" = 'closed' AND "resolvedAt" IS NOT NULL AND "closedAt" IS NOT NULL)
);

ALTER TABLE "SupportCaseEvent"
ADD CONSTRAINT "SupportCaseEvent_dedup_check" CHECK (length(btrim("dedupKey")) BETWEEN 1 AND 160),
ADD CONSTRAINT "SupportCaseEvent_payload_check" CHECK (
  "payloadEncryptedEnvelope" IS NULL OR length("payloadEncryptedEnvelope") > 0
),
ADD CONSTRAINT "SupportCaseEvent_actor_check" CHECK (
  ("actorMemberId" IS NOT NULL AND "actorUserId" IS NULL)
  OR ("actorMemberId" IS NULL AND "actorUserId" IS NOT NULL)
);

ALTER TABLE "SupportRefundHandoff"
ADD CONSTRAINT "SupportRefundHandoff_revision_check" CHECK ("revision" > 0),
ADD CONSTRAINT "SupportRefundHandoff_amount_check" CHECK ("requestedAmountCents" > 0),
ADD CONSTRAINT "SupportRefundHandoff_reason_check" CHECK (length("reasonEncryptedEnvelope") > 0),
ADD CONSTRAINT "SupportRefundHandoff_lifecycle_check" CHECK (
  (
    "status" = 'requested'
    AND "reviewedByActorId" IS NULL
    AND "reviewedAt" IS NULL
    AND "completedRefundId" IS NULL
    AND "completedAt" IS NULL
  )
  OR (
    "status" IN ('reviewing', 'declined')
    AND "reviewedByActorId" IS NOT NULL
    AND "reviewedAt" IS NOT NULL
    AND "completedRefundId" IS NULL
    AND "completedAt" IS NULL
  )
  OR (
    "status" = 'completed'
    AND "reviewedByActorId" IS NOT NULL
    AND "reviewedAt" IS NOT NULL
    AND "completedRefundId" IS NOT NULL
    AND "completedAt" IS NOT NULL
  )
);

CREATE UNIQUE INDEX "CommerceOrderRefund_vendorId_orderId_id_key" ON "CommerceOrderRefund"("vendorId", "orderId", "id");
CREATE UNIQUE INDEX "SupportCase_vendorId_id_key" ON "SupportCase"("vendorId", "id");
CREATE UNIQUE INDEX "SupportCase_vendorId_caseNumber_key" ON "SupportCase"("vendorId", "caseNumber");
CREATE UNIQUE INDEX "SupportCase_vendorId_intakeKey_key" ON "SupportCase"("vendorId", "intakeKey");
CREATE INDEX "SupportCase_vendorId_status_priority_updatedAt_idx" ON "SupportCase"("vendorId", "status", "priority", "updatedAt");
CREATE INDEX "SupportCase_vendorId_assignedMemberId_status_idx" ON "SupportCase"("vendorId", "assignedMemberId", "status");
CREATE INDEX "SupportCase_vendorId_orderId_createdAt_idx" ON "SupportCase"("vendorId", "orderId", "createdAt");

CREATE UNIQUE INDEX "SupportCaseEvent_vendorId_id_key" ON "SupportCaseEvent"("vendorId", "id");
CREATE UNIQUE INDEX "SupportCaseEvent_vendorId_supportCaseId_dedupKey_key" ON "SupportCaseEvent"("vendorId", "supportCaseId", "dedupKey");
CREATE INDEX "SupportCaseEvent_vendorId_supportCaseId_occurredAt_idx" ON "SupportCaseEvent"("vendorId", "supportCaseId", "occurredAt");
CREATE INDEX "SupportCaseEvent_vendorId_eventType_occurredAt_idx" ON "SupportCaseEvent"("vendorId", "eventType", "occurredAt");

CREATE UNIQUE INDEX "SupportRefundHandoff_vendorId_id_key" ON "SupportRefundHandoff"("vendorId", "id");
CREATE UNIQUE INDEX "SupportRefundHandoff_vendorId_supportCaseId_key" ON "SupportRefundHandoff"("vendorId", "supportCaseId");
CREATE UNIQUE INDEX "SupportRefundHandoff_vendorId_completedRefundId_key" ON "SupportRefundHandoff"("vendorId", "completedRefundId");
CREATE UNIQUE INDEX "SupportRefundHandoff_vendorId_orderId_completedRefundId_key" ON "SupportRefundHandoff"("vendorId", "orderId", "completedRefundId");
CREATE INDEX "SupportRefundHandoff_status_createdAt_idx" ON "SupportRefundHandoff"("status", "createdAt");
CREATE INDEX "SupportRefundHandoff_vendorId_orderId_status_idx" ON "SupportRefundHandoff"("vendorId", "orderId", "status");
CREATE INDEX "SupportRefundHandoff_vendorId_paymentTransactionId_idx" ON "SupportRefundHandoff"("vendorId", "paymentTransactionId");

ALTER TABLE "SupportCase" ADD CONSTRAINT "SupportCase_vendorId_fkey"
FOREIGN KEY ("vendorId") REFERENCES "Vendor"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SupportCase" ADD CONSTRAINT "SupportCase_order_tenant_fkey"
FOREIGN KEY ("vendorId", "orderId") REFERENCES "CommerceOrder"("vendorId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "SupportCase" ADD CONSTRAINT "SupportCase_createdBy_tenant_fkey"
FOREIGN KEY ("vendorId", "createdByMemberId") REFERENCES "VendorMember"("vendorId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "SupportCase" ADD CONSTRAINT "SupportCase_assignee_tenant_fkey"
FOREIGN KEY ("vendorId", "assignedMemberId") REFERENCES "VendorMember"("vendorId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "SupportCaseEvent" ADD CONSTRAINT "SupportCaseEvent_vendorId_fkey"
FOREIGN KEY ("vendorId") REFERENCES "Vendor"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SupportCaseEvent" ADD CONSTRAINT "SupportCaseEvent_case_tenant_fkey"
FOREIGN KEY ("vendorId", "supportCaseId") REFERENCES "SupportCase"("vendorId", "id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SupportCaseEvent" ADD CONSTRAINT "SupportCaseEvent_actor_tenant_fkey"
FOREIGN KEY ("vendorId", "actorMemberId") REFERENCES "VendorMember"("vendorId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "SupportCaseEvent" ADD CONSTRAINT "SupportCaseEvent_platform_actor_fkey"
FOREIGN KEY ("actorUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "SupportRefundHandoff" ADD CONSTRAINT "SupportRefundHandoff_vendorId_fkey"
FOREIGN KEY ("vendorId") REFERENCES "Vendor"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SupportRefundHandoff" ADD CONSTRAINT "SupportRefundHandoff_case_tenant_fkey"
FOREIGN KEY ("vendorId", "supportCaseId") REFERENCES "SupportCase"("vendorId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "SupportRefundHandoff" ADD CONSTRAINT "SupportRefundHandoff_order_tenant_fkey"
FOREIGN KEY ("vendorId", "orderId") REFERENCES "CommerceOrder"("vendorId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "SupportRefundHandoff" ADD CONSTRAINT "SupportRefundHandoff_payment_tenant_fkey"
FOREIGN KEY ("vendorId", "paymentTransactionId") REFERENCES "PaymentTransaction"("vendorId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "SupportRefundHandoff" ADD CONSTRAINT "SupportRefundHandoff_requestedBy_tenant_fkey"
FOREIGN KEY ("vendorId", "requestedByMemberId") REFERENCES "VendorMember"("vendorId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "SupportRefundHandoff" ADD CONSTRAINT "SupportRefundHandoff_reviewedBy_fkey"
FOREIGN KEY ("reviewedByActorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "SupportRefundHandoff" ADD CONSTRAINT "SupportRefundHandoff_completedRefund_order_tenant_fkey"
FOREIGN KEY ("vendorId", "orderId", "completedRefundId") REFERENCES "CommerceOrderRefund"("vendorId", "orderId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE FUNCTION enforce_support_refund_handoff_order() RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  order_payment_id TEXT;
  order_status "CommerceOrderStatus";
  order_paid INTEGER;
  order_refunded INTEGER;
  completed_refund_amount INTEGER;
  completed_refund_status "CommerceOrderRefundStatus";
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

  -- Availability is claimed when the merchant creates the handoff. On
  -- completion, the canonical order projection already includes this refund,
  -- so rechecking the then-current remaining balance would reject valid full
  -- refunds. Completion is instead bound below to one exact processed ledger row.
  IF TG_OP = 'INSERT' AND NEW."requestedAmountCents" > order_paid - order_refunded THEN
    RAISE EXCEPTION 'Support refund handoff exceeds the remaining refundable amount.'
      USING ERRCODE = '23514', CONSTRAINT = 'SupportRefundHandoff_remaining_check';
  END IF;

  IF NEW."status" = 'completed' THEN
    SELECT "amountCents", "status"
    INTO completed_refund_amount, completed_refund_status
    FROM "CommerceOrderRefund"
    WHERE "vendorId" = NEW."vendorId"
      AND "orderId" = NEW."orderId"
      AND "id" = NEW."completedRefundId";
    IF NOT FOUND
      OR completed_refund_status <> 'processed'
      OR completed_refund_amount <> NEW."requestedAmountCents"
    THEN
      RAISE EXCEPTION 'Support refund completion must match one processed canonical refund.'
        USING ERRCODE = '23514', CONSTRAINT = 'SupportRefundHandoff_completion_check';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER "SupportRefundHandoff_order_trigger"
BEFORE INSERT OR UPDATE ON "SupportRefundHandoff"
FOR EACH ROW EXECUTE FUNCTION enforce_support_refund_handoff_order();
