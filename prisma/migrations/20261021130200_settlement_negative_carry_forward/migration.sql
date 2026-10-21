-- F-039 / B03-03 (owner decision D-32): negative settlement balances carry
-- forward instead of being truncated to zero.
--
-- Before this change a refund booked into a month whose revenue was smaller
-- than the refund was clamped by Math.max(0, ...), and a refund recorded
-- into an already locked month was never settled at all. Refund months now
-- come from the server's refund completion time (moved past locked months),
-- and a negative payable is written here as a carry into the next open month.
--
-- Forward-only and additive: three Settlement columns with default 0 and a
-- new ledger table. No existing row changes. Existing unlocked settlements
-- keep refundAmountCents = 0, so locking one that has processed refunds asks
-- for a regeneration first (stale-input check in lockSettlementAction).
DO $$
BEGIN
  -- Transaction-scoped: bounds the ALTER TABLE lock wait.
  PERFORM pg_catalog.set_config('lock_timeout', '5s', true);
END
$$;

ALTER TABLE "Settlement"
  ADD COLUMN "refundAmountCents" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "carriedInCents" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "carriedOutCents" INTEGER NOT NULL DEFAULT 0;

ALTER TABLE "Settlement"
  ADD CONSTRAINT "Settlement_refund_amount_check" CHECK ("refundAmountCents" >= 0),
  ADD CONSTRAINT "Settlement_carried_in_check" CHECK ("carriedInCents" <= 0),
  -- A carry exists only when nothing is paid out for the month.
  ADD CONSTRAINT "Settlement_carried_out_check"
    CHECK ("carriedOutCents" <= 0 AND ("carriedOutCents" = 0 OR "finalPayoutAmountCents" = 0));

CREATE TABLE "SettlementAdjustmentLedgerEntry" (
    "id" TEXT NOT NULL,
    "vendorId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "sourceMonthKey" TEXT NOT NULL,
    "targetMonthKey" TEXT NOT NULL,
    "amountCents" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SettlementAdjustmentLedgerEntry_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "SettlementAdjustmentLedgerEntry_kind_check"
        CHECK ("kind" IN ('negative_balance_carry_forward')),
    CONSTRAINT "SettlementAdjustmentLedgerEntry_month_check"
        CHECK ("sourceMonthKey" ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'
           AND "targetMonthKey" ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'
           AND "targetMonthKey" > "sourceMonthKey"),
    -- A carry is a deduction; zero means the source month no longer carries.
    CONSTRAINT "SettlementAdjustmentLedgerEntry_amount_check" CHECK ("amountCents" <= 0)
);

CREATE UNIQUE INDEX "SettlementAdjustmentLedgerEntry_vendorId_kind_sourceMonthKe_key" ON "SettlementAdjustmentLedgerEntry"("vendorId", "kind", "sourceMonthKey");

CREATE INDEX "SettlementAdjustmentLedgerEntry_vendorId_targetMonthKey_idx" ON "SettlementAdjustmentLedgerEntry"("vendorId", "targetMonthKey");

ALTER TABLE "SettlementAdjustmentLedgerEntry" ADD CONSTRAINT "SettlementAdjustmentLedgerEntry_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "Vendor"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Same defense in depth as every other public table (20261020090000).
ALTER TABLE "SettlementAdjustmentLedgerEntry" ENABLE ROW LEVEL SECURITY;

-- Review M-1: a commission refund reversal is settled in the month of its
-- RefundRecord, not in the (possibly locked) month of the original sale.
-- Existing rows stay NULL and keep the old rule (the commission's month).
ALTER TABLE "AffiliateCommissionLedgerEntry" ADD COLUMN "settlementMonthKey" TEXT;
ALTER TABLE "AffiliateCommissionLedgerEntry"
  ADD CONSTRAINT "AffiliateCommissionLedgerEntry_settlement_month_check"
    CHECK ("settlementMonthKey" IS NULL OR ("entryType" = 'refund' AND "settlementMonthKey" ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'));
CREATE INDEX "AffiliateCommissionLedger_v_settlement_month_idx" ON "AffiliateCommissionLedgerEntry"("vendorId", "settlementMonthKey");
