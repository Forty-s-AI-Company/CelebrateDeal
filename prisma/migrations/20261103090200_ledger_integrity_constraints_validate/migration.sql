-- F-062 / B04-07: validate the ledger CHECK constraints added NOT VALID by
-- 20261103090100_ledger_integrity_constraints.
--
-- Prisma runs each migration file as one transaction, so VALIDATE must live in
-- its own file: here each scan holds only SHARE UPDATE EXCLUSIVE on the table
-- and does not block reads or writes. A row that violates a constraint makes
-- this migration fail and roll back (the constraints stay NOT VALID and keep
-- checking new writes). Run the read-only preflight in
-- docs/operations/prisma-migration-guards-runbook.md section 7 before deploying.
DO $$
BEGIN
  PERFORM pg_catalog.set_config('lock_timeout', '5s', true);
END
$$;

ALTER TABLE "PaymentTransaction" VALIDATE CONSTRAINT "PaymentTransaction_status_check";
ALTER TABLE "PaymentTransaction" VALIDATE CONSTRAINT "PaymentTransaction_amounts_check";
ALTER TABLE "RefundRecord" VALIDATE CONSTRAINT "RefundRecord_status_check";
ALTER TABLE "RefundRecord" VALIDATE CONSTRAINT "RefundRecord_amounts_check";
ALTER TABLE "PayoutBatch" VALIDATE CONSTRAINT "PayoutBatch_status_check";
ALTER TABLE "PayoutBatch" VALIDATE CONSTRAINT "PayoutBatch_amounts_check";
ALTER TABLE "Settlement" VALIDATE CONSTRAINT "Settlement_status_check";
ALTER TABLE "Settlement" VALIDATE CONSTRAINT "Settlement_amounts_check";
ALTER TABLE "PayoutItem" VALIDATE CONSTRAINT "PayoutItem_status_check";
ALTER TABLE "PayoutItem" VALIDATE CONSTRAINT "PayoutItem_amounts_check";
