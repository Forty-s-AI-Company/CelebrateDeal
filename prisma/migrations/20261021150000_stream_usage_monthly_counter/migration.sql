-- F-092 / B06-06: stream quota admission without a Serializable month scan.
--
-- Every playback heartbeat used to SUM the vendor's whole month of
-- "StreamUsageLedgerEntry" inside a Serializable transaction. Concurrent
-- viewers of one vendor then aborted each other (P2034), and that conflict was
-- reported to the browser as "stream minutes exhausted", pausing playback.
--
-- The heartbeat now runs in READ COMMITTED and admits quota with one atomic,
-- conditional increment of this row:
--   UPDATE ... SET "watchSeconds" = "watchSeconds" + n
--   WHERE GREATEST("watchSeconds", legacy) + n <= limit
-- The row lock it takes serializes the rest of that vendor's heartbeat
-- (scoped member/page quota checks and the ledger insert) without SSI aborts.
--
-- The ledger stays the immutable source of truth. The first heartbeat of a
-- vendor-month seeds this row once from the ledger sum
-- (INSERT ... SELECT SUM(...) ON CONFLICT DO UPDATE), so no backfill is needed
-- here and months that never see a new heartbeat keep no row.
--
-- Forward-only and additive: a new table, no existing table, column or row
-- changes.
CREATE TABLE "StreamUsageMonthlyCounter" (
    "vendorId" TEXT NOT NULL,
    "monthKey" TEXT NOT NULL,
    "watchSeconds" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StreamUsageMonthlyCounter_pkey" PRIMARY KEY ("vendorId","monthKey"),
    CONSTRAINT "StreamUsageMonthlyCounter_month_check"
        CHECK ("monthKey" ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
    CONSTRAINT "StreamUsageMonthlyCounter_watch_seconds_check" CHECK ("watchSeconds" >= 0)
);

ALTER TABLE "StreamUsageMonthlyCounter" ADD CONSTRAINT "StreamUsageMonthlyCounter_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "Vendor"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Same defense in depth as every other public table (20261020090000).
ALTER TABLE "StreamUsageMonthlyCounter" ENABLE ROW LEVEL SECURITY;
