-- A-2 05: PayUni pending-payment reconciler (src/lib/payment-pending-reconciliation.ts).
--
-- When a PayUni callback is lost, nothing asked the provider about the still
-- pending checkout. The reconciliation job queries PayUni by merchant order
-- number with a bounded back-off and applies a paid/failed decision through
-- the payment webhook pipeline. This table only keeps the query loop's state:
-- attempts, the next due time (which is also the claim), and a bounded outcome
-- code. One row per payment, bound to the payment's own (vendorId, id).
--
-- Forward-only and additive: one new table, no existing row changes.
DO $$
BEGIN
  PERFORM pg_catalog.set_config('lock_timeout', '5s', true);
END
$$;

-- CreateTable
CREATE TABLE "PaymentPendingReconciliation" (
    "id" TEXT NOT NULL,
    "vendorId" TEXT NOT NULL,
    "paymentTransactionId" TEXT NOT NULL,
    "providerName" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'active',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "lastQueriedAt" TIMESTAMP(3),
    "nextQueryAt" TIMESTAMP(3) NOT NULL,
    "lastOutcome" TEXT,
    "resolvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PaymentPendingReconciliation_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "PaymentPendingReconciliation_status_check" CHECK ("status" IN ('active', 'settled', 'closed', 'needs_manual_review')),
    -- PAYMENT_RECONCILE_MAX_ATTEMPTS is far below this; the CHECK only bounds a runaway writer.
    CONSTRAINT "PaymentPendingReconciliation_attempts_check" CHECK ("attempts" BETWEEN 0 AND 100),
    -- Fixed outcome codes only, never provider text.
    CONSTRAINT "PaymentPendingReconciliation_lastOutcome_check" CHECK ("lastOutcome" IS NULL OR "lastOutcome" ~ '^[a-z_]{1,64}$'),
    -- A terminal row records when it stopped; an active row has not stopped.
    CONSTRAINT "PaymentPendingReconciliation_resolved_check" CHECK (("status" = 'active') = ("resolvedAt" IS NULL))
);

-- CreateIndex
-- One row per payment: the first claim's insert conflicts for every concurrent run.
CREATE UNIQUE INDEX "PaymentPendingReconciliation_vendorId_paymentTransactionId_key" ON "PaymentPendingReconciliation"("vendorId", "paymentTransactionId");

-- CreateIndex
CREATE INDEX "PaymentPendingReconciliation_status_nextQueryAt_idx" ON "PaymentPendingReconciliation"("status", "nextQueryAt");

-- AddForeignKey
-- The payment's own (vendorId, id) key: a row can only name a payment of its vendor.
ALTER TABLE "PaymentPendingReconciliation" ADD CONSTRAINT "PaymentPendingReconciliation_vendorId_paymentTransactionId_fkey" FOREIGN KEY ("vendorId", "paymentTransactionId") REFERENCES "PaymentTransaction"("vendorId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Same defense in depth as every other public table (20261020090000).
ALTER TABLE "PaymentPendingReconciliation" ENABLE ROW LEVEL SECURITY;
