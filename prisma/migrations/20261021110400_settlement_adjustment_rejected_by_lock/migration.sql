-- PR #455 review m-4 (F-049): locking a settlement closes its pending
-- adjustment request as "rejected_by_lock" in the same transaction (with an
-- AuditLog row), so a request can never wait forever on a locked settlement.
-- Forward-only: widens the status CHECK; no row changes.
ALTER TABLE "SettlementAdjustmentRequest" DROP CONSTRAINT "SettlementAdjustmentRequest_status_check";

ALTER TABLE "SettlementAdjustmentRequest" ADD CONSTRAINT "SettlementAdjustmentRequest_status_check"
    CHECK ("status" IN ('pending', 'approved', 'rejected', 'superseded', 'rejected_by_lock'));
