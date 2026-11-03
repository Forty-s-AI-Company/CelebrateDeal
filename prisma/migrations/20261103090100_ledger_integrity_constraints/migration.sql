-- F-062 / B04-07 (DB-I09, DB-I02) and F-066 / B04-12: database-level
-- integrity for the core ledger tables.
--
-- 1. Partial unique indexes (Prisma 6 cannot declare or diff them; registered
--    in scripts/prisma-drift-allowlist.json and asserted by
--    src/lib/prisma-unmanaged-indexes.db.test.ts):
--      * RefundRecord ("paymentTransactionId","providerEventId") when the event
--        id is set: one refund row per provider event of a payment. Scoped to
--        the payment because provider refund serials (CloseNo/RefundNo, or the
--        TradeNo fallback) only identify a refund within one trade.
--      * PayoutItem ("vendorId","settlementId") when the settlement is set: a
--        settlement is paid out at most once even if payoutBatchId is cleared.
--    CREATE UNIQUE INDEX fails on duplicates, so a preflight first aborts with
--    counts only (no ids, amounts or tenants) before either index is built.
-- 2. PaymentTransaction.status defaults to 'pending' instead of 'paid'. Every
--    application write path already sets status explicitly; the default only
--    matters for a write that forgets it, which must never look paid.
-- 3. Amount and status CHECK constraints on PaymentTransaction, RefundRecord,
--    PayoutBatch, Settlement and PayoutItem. They are added NOT VALID here, so
--    this file never scans existing rows (new writes are checked at once);
--    20261103090200_ledger_integrity_constraints_validate validates them in a
--    separate transaction that only takes SHARE UPDATE EXCLUSIVE. Run the
--    read-only preflight in docs/operations/prisma-migration-guards-runbook.md
--    section 7 first: a violating row makes the VALIDATE migration fail.
--    Status lists are exactly the values the application writes:
--      PaymentTransaction: checkout/invoice/plan create 'pending'; webhooks and
--        refunds move it to paid/failed/expired/partially_refunded/refunded
--        (resolvePaymentStatus, inventory-reservations, refund paths).
--      RefundRecord: pending (PayUni reservation), processed, failed.
--      PayoutBatch: draft, exported, retrying, failed, completed
--        (derivePayoutBatchStatus).
--      Settlement: draft (generate), locked, ready_for_payout (batch claim),
--        paid (payout item paid).
--      PayoutItem: pending, paid, failed, retrying (canTransitionPayoutItem).
--    Signed columns stay unconstrained on purpose: Settlement.grossRevenueCents
--    and payoutableAmountCents go negative after refunds (F-039),
--    adjustmentAmountCents is signed, carriedIn/OutCents already have CHECKs.
--
-- Locks: the two CREATE UNIQUE INDEX statements take SHARE (block writes to
-- RefundRecord / PayoutItem while building); each ALTER TABLE below takes
-- ACCESS EXCLUSIVE (catalog-only, no scan). All are held until this file
-- commits. The ALTERs come last, and PayoutBatch -> Settlement -> PayoutItem
-- follow the order createPayoutBatchAction writes them.
DO $$
BEGIN
  -- Transaction-scoped: bounds every lock wait in this file.
  PERFORM pg_catalog.set_config('lock_timeout', '5s', true);
END
$$;

DO $$
DECLARE
  refund_groups bigint;
  refund_rows bigint;
  payout_groups bigint;
  payout_rows bigint;
BEGIN
  SELECT count(*), coalesce(sum(group_rows), 0) INTO refund_groups, refund_rows
    FROM (
      SELECT count(*) AS group_rows
        FROM "RefundRecord"
       WHERE "providerEventId" IS NOT NULL
       GROUP BY "paymentTransactionId", "providerEventId"
      HAVING count(*) > 1
    ) duplicates;
  SELECT count(*), coalesce(sum(group_rows), 0) INTO payout_groups, payout_rows
    FROM (
      SELECT count(*) AS group_rows
        FROM "PayoutItem"
       WHERE "settlementId" IS NOT NULL
       GROUP BY "vendorId", "settlementId"
      HAVING count(*) > 1
    ) duplicates;
  IF refund_groups > 0 OR payout_groups > 0 THEN
    RAISE EXCEPTION 'ledger_integrity_preflight_failed: RefundRecord duplicate provider events % groups / % rows; PayoutItem duplicate settlements % groups / % rows. See docs/operations/prisma-migration-guards-runbook.md section 7.',
      refund_groups, refund_rows, payout_groups, payout_rows;
  END IF;
END
$$;

CREATE UNIQUE INDEX "RefundRecord_paymentTransactionId_providerEventId_key"
  ON "RefundRecord"("paymentTransactionId", "providerEventId")
  WHERE "providerEventId" IS NOT NULL;

CREATE UNIQUE INDEX "PayoutItem_vendorId_settlementId_key"
  ON "PayoutItem"("vendorId", "settlementId")
  WHERE "settlementId" IS NOT NULL;

ALTER TABLE "PaymentTransaction"
  ALTER COLUMN "status" SET DEFAULT 'pending',
  ADD CONSTRAINT "PaymentTransaction_status_check"
    CHECK ("status" IN ('pending', 'paid', 'failed', 'expired', 'partially_refunded', 'refunded')) NOT VALID,
  ADD CONSTRAINT "PaymentTransaction_amounts_check"
    CHECK ("grossAmountCents" >= 0
       AND "gatewayFeeCents" >= 0
       AND "platformFeeCents" >= 0
       AND "netAmountCents" >= 0
       AND "refundedAmountCents" >= 0
       AND "refundedAmountCents" <= "grossAmountCents") NOT VALID;

ALTER TABLE "RefundRecord"
  ADD CONSTRAINT "RefundRecord_status_check"
    CHECK ("status" IN ('pending', 'processed', 'failed')) NOT VALID,
  ADD CONSTRAINT "RefundRecord_amounts_check"
    CHECK ("refundAmountCents" > 0
       AND "gatewayFeeRefundCents" >= 0
       AND "platformFeeRefundCents" >= 0) NOT VALID;

ALTER TABLE "PayoutBatch"
  ADD CONSTRAINT "PayoutBatch_status_check"
    CHECK ("status" IN ('draft', 'exported', 'retrying', 'failed', 'completed')) NOT VALID,
  ADD CONSTRAINT "PayoutBatch_amounts_check"
    CHECK ("totalAmountCents" >= 0 AND "totalCount" >= 0) NOT VALID;

ALTER TABLE "Settlement"
  ADD CONSTRAINT "Settlement_status_check"
    CHECK ("status" IN ('draft', 'locked', 'ready_for_payout', 'paid')) NOT VALID,
  ADD CONSTRAINT "Settlement_amounts_check"
    CHECK ("monthlyFeeCents" >= 0
       AND "overflowFeeCents" >= 0
       AND "paymentServiceFeeCents" >= 0
       AND "transactionServiceFeeCents" >= 0
       AND "affiliateManagementFeeCents" >= 0
       AND "paymentGatewayFeeCents" >= 0
       AND "finalPayoutAmountCents" >= 0) NOT VALID;

ALTER TABLE "PayoutItem"
  ADD CONSTRAINT "PayoutItem_status_check"
    CHECK ("status" IN ('pending', 'paid', 'failed', 'retrying')) NOT VALID,
  ADD CONSTRAINT "PayoutItem_amounts_check"
    CHECK ("payoutAmountCents" >= 0 AND "retryCount" >= 0) NOT VALID;
