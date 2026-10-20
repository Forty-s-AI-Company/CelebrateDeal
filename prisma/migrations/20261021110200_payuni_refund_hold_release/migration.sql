-- F-046 / B03-11: a PayUni refund reservation whose provider outcome was
-- ambiguous stays pending (and blocks further refunds) until a finance admin
-- proves it never happened. These columns record the consecutive provider
-- queries that confirmed "no refund" for the pending reservation and when the
-- hold was released by hand. Nothing releases a hold automatically; the
-- release action (src/lib/payuni-refund-hold-release.ts) requires the
-- configured streak, the time window and a fresh confirming query, and writes
-- an AuditLog row in the same transaction.
--
-- Forward-only and additive: existing rows get count 0 and NULL timestamps.
ALTER TABLE "RefundRecord"
  ADD COLUMN "providerNoRefundCheckCount" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "providerNoRefundFirstCheckedAt" TIMESTAMP(3),
  ADD COLUMN "providerNoRefundLastCheckedAt" TIMESTAMP(3),
  ADD COLUMN "holdReleasedAt" TIMESTAMP(3);

ALTER TABLE "RefundRecord"
  ADD CONSTRAINT "RefundRecord_provider_no_refund_check" CHECK (
    "providerNoRefundCheckCount" >= 0
    AND ("providerNoRefundCheckCount" = 0) = ("providerNoRefundFirstCheckedAt" IS NULL)
    AND ("providerNoRefundFirstCheckedAt" IS NULL) = ("providerNoRefundLastCheckedAt" IS NULL)
    AND ("providerNoRefundLastCheckedAt" IS NULL OR "providerNoRefundLastCheckedAt" >= "providerNoRefundFirstCheckedAt")
  ),
  ADD CONSTRAINT "RefundRecord_hold_release_check" CHECK (
    "holdReleasedAt" IS NULL OR "status" = 'failed'
  );
