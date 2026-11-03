-- F-068 / B04-15: monthly and batch aggregate money columns become BIGINT.
--
-- An int4 cent column tops out at NT$21,474,836.47. A vendor whose monthly
-- revenue, refunds or carry-forward pass that amount, or a payout batch whose
-- total does, failed with `integer out of range` and blocked the month's
-- settlement or the payout batch. Single-transaction columns
-- (PaymentTransaction, RefundRecord, CommerceOrder ...) stay INTEGER.
--
-- Covered aggregates:
--   * every money column on Settlement (one vendor-month);
--   * PayoutBatch.totalAmountCents (sum over vendors);
--   * PayoutItem.payoutAmountCents (copies Settlement.finalPayoutAmountCents);
--   * SettlementAdjustmentLedgerEntry.amountCents (a month's negative balance).
--
-- Forward-only. int4 -> int8 widening never loses a value, keeps defaults
-- and existing CHECK constraints, and rewrites only these four small tables
-- under ACCESS EXCLUSIVE for the duration of this file.
DO $$
BEGIN
  -- Transaction-scoped: bounds the ALTER TABLE lock wait.
  PERFORM pg_catalog.set_config('lock_timeout', '5s', true);
END
$$;

ALTER TABLE "Settlement"
  ALTER COLUMN "monthlyFeeCents" SET DATA TYPE BIGINT,
  ALTER COLUMN "overflowFeeCents" SET DATA TYPE BIGINT,
  ALTER COLUMN "paymentServiceFeeCents" SET DATA TYPE BIGINT,
  ALTER COLUMN "transactionServiceFeeCents" SET DATA TYPE BIGINT,
  ALTER COLUMN "affiliateManagementFeeCents" SET DATA TYPE BIGINT,
  ALTER COLUMN "paymentGatewayFeeCents" SET DATA TYPE BIGINT,
  ALTER COLUMN "grossRevenueCents" SET DATA TYPE BIGINT,
  ALTER COLUMN "payoutableAmountCents" SET DATA TYPE BIGINT,
  ALTER COLUMN "adjustmentAmountCents" SET DATA TYPE BIGINT,
  ALTER COLUMN "refundAmountCents" SET DATA TYPE BIGINT,
  ALTER COLUMN "carriedInCents" SET DATA TYPE BIGINT,
  ALTER COLUMN "carriedOutCents" SET DATA TYPE BIGINT,
  ALTER COLUMN "finalPayoutAmountCents" SET DATA TYPE BIGINT;

ALTER TABLE "PayoutBatch"
  ALTER COLUMN "totalAmountCents" SET DATA TYPE BIGINT;

ALTER TABLE "PayoutItem"
  ALTER COLUMN "payoutAmountCents" SET DATA TYPE BIGINT;

ALTER TABLE "SettlementAdjustmentLedgerEntry"
  ALTER COLUMN "amountCents" SET DATA TYPE BIGINT;
