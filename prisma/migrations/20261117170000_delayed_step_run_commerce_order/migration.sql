-- Q-09: delayed steps for `payment_paid` automation rules
-- (docs/product/delayed-steps-design.md §8, docs/domain-workflows.md
-- 「付款完成」). The subject of such a run is the canonical order, so
-- DelayedStepRun gets an order reference next to the registration and the
-- booking. Existing runs keep every value: the new column is NULL for all of
-- them and nothing is backfilled.
--
-- Forward-only, in two migrations because Prisma runs each file as one
-- transaction (the same pattern as 20261114090000 / 20261114090100):
--   1. this file adds the column, its index, the foreign key and the new
--      subject CHECK, all constraints NOT VALID (no scan of existing rows; new
--      writes are checked at once);
--   2. 20261117170100_delayed_step_run_commerce_order_validate validates them
--      under SHARE UPDATE EXCLUSIVE, then drops the F-4 subject CHECK and
--      gives the new one its name.
-- Between the two, both subject CHECKs apply: the F-4 one still requires a
-- registration or a booking, so no order run can be written before 2 is
-- applied (the code that writes them is deployed after both).
--
-- Locks (all within lock_timeout 5s, held until this file commits):
--   * ACCESS EXCLUSIVE on "DelayedStepRun" (ADD COLUMN, CREATE INDEX, ADD
--     CONSTRAINT); metadata only, the table is not rewritten. The index is
--     built inside the same lock; the table is small during the closed beta.
--   * SHARE ROW EXCLUSIVE on "CommerceOrder" for the new foreign key: order
--     writes (checkout, payment webhooks) wait until this file commits, reads
--     do not. The foreign key is the last statement, so that lock is taken
--     only right before the commit. "Vendor" is not touched.
DO $$
BEGIN
  PERFORM pg_catalog.set_config('lock_timeout', '5s', true);
END
$$;

-- AlterTable
ALTER TABLE "DelayedStepRun" ADD COLUMN     "commerceOrderId" TEXT;

-- CreateIndex
-- Foreign-key lookups of the cascade below, and the worker's read of an order's run.
CREATE INDEX "DelayedStepRun_vendorId_commerceOrderId_idx" ON "DelayedStepRun"("vendorId", "commerceOrderId");

-- Replaces "DelayedStepRun_automation_reference_check" (registration or
-- booking), which the next migration drops after validating this one and then
-- renames this one to that name. An automation run always knows its
-- triggering execution, the customer key its tags use, and exactly one subject
-- to re-read the recipient from: a registration, a booking or an order; only
-- an automation run names a booking or an order.
ALTER TABLE "DelayedStepRun" ADD CONSTRAINT "DelayedStepRun_automation_subject_check"
  CHECK (
    (("automationRuleId" IS NULL) = ("sourceExecutionLogId" IS NULL))
    AND ("automationRuleId" IS NULL OR ("subjectKeyHash" IS NOT NULL AND num_nonnulls("formSubmissionId", "consultationBookingId", "commerceOrderId") = 1))
    AND ("automationRuleId" IS NOT NULL OR num_nonnulls("consultationBookingId", "commerceOrderId") = 0)
  ) NOT VALID;

-- AddForeignKey
-- Composite with vendorId: a run can only name an order of its own vendor.
-- Deleting the order removes the run, like deleting a registration or a
-- booking does. NOT VALID here, validated in the next migration (every
-- existing row has NULL in this column).
ALTER TABLE "DelayedStepRun" ADD CONSTRAINT "DelayedStepRun_vendorId_commerceOrderId_fkey" FOREIGN KEY ("vendorId", "commerceOrderId") REFERENCES "CommerceOrder"("vendorId", "id") ON DELETE CASCADE ON UPDATE CASCADE NOT VALID;
