import type { Prisma } from "@prisma/client";

/**
 * Monthly stream usage totals (F-092 / B06-06).
 *
 * `StreamUsageLedgerEntry` stays the immutable, append-only record of every
 * heartbeat. Quota admission reads and increments one derived row per
 * vendor-month instead of summing that ledger in a Serializable transaction,
 * so concurrent viewers never abort each other and a conflict can never look
 * like an exhausted quota.
 */

type CounterClient = Pick<Prisma.TransactionClient, "$queryRaw">;

type CounterRow = { watchSeconds: number };

export type StreamUsageReservation =
  | { admitted: true; previousSeconds: number; totalSeconds: number }
  | { admitted: false };

export type StreamUsageReservationInput = {
  vendorId: string;
  monthKey: string;
  /** Seconds this heartbeat adds; validated by the caller (1..60). */
  seconds: number;
  /** Finite quota in seconds, or null when the vendor has no finite quota. */
  limitSeconds: number | null;
  /** Legacy `VendorUsageLimit.streamMinutesUsed` (in seconds) still in force. */
  floorSeconds: number;
};

function assertReservationInput(input: StreamUsageReservationInput) {
  if (!Number.isInteger(input.seconds) || input.seconds < 1) throw new Error("Invalid stream usage reservation.");
  if (input.limitSeconds !== null && (!Number.isInteger(input.limitSeconds) || input.limitSeconds < 1)) {
    throw new Error("Invalid stream usage limit.");
  }
  if (!Number.isInteger(input.floorSeconds) || input.floorSeconds < 0) throw new Error("Invalid stream usage floor.");
}

function admittedReservation(totalSeconds: number, seconds: number): StreamUsageReservation {
  return { admitted: true, previousSeconds: totalSeconds - seconds, totalSeconds };
}

function fitsLimit(currentSeconds: number, input: StreamUsageReservationInput) {
  return input.limitSeconds === null
    || Math.max(currentSeconds, input.floorSeconds) + input.seconds <= input.limitSeconds;
}

/**
 * Atomically adds `seconds` to the vendor-month total when it still fits the
 * quota. A successful reservation keeps that row locked until the caller's
 * transaction ends, which serializes the rest of the vendor's heartbeat
 * (scoped quota checks, ledger insert) in READ COMMITTED. A rolled-back
 * transaction also rolls the increment back.
 */
export async function reserveVendorStreamSeconds(
  tx: CounterClient,
  input: StreamUsageReservationInput,
): Promise<StreamUsageReservation> {
  assertReservationInput(input);
  const { vendorId, monthKey, seconds, limitSeconds, floorSeconds } = input;

  // Each step is retried once: a row created by a concurrent first heartbeat
  // between our UPDATE and the follow-up read must not read as exhaustion.
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const updated = await tx.$queryRaw<CounterRow[]>`
      UPDATE "StreamUsageMonthlyCounter"
      SET "watchSeconds" = "watchSeconds" + ${seconds}::integer, "updatedAt" = CURRENT_TIMESTAMP
      WHERE "vendorId" = ${vendorId}
        AND "monthKey" = ${monthKey}
        AND (${limitSeconds}::integer IS NULL
          OR GREATEST("watchSeconds", ${floorSeconds}::integer) + ${seconds}::integer <= ${limitSeconds}::integer)
      RETURNING "watchSeconds"`;
    const updatedRow = updated[0];
    if (updatedRow) return admittedReservation(updatedRow.watchSeconds, seconds);

    const existing = await tx.$queryRaw<CounterRow[]>`
      SELECT "watchSeconds" FROM "StreamUsageMonthlyCounter"
      WHERE "vendorId" = ${vendorId} AND "monthKey" = ${monthKey}`;
    const existingRow = existing[0];
    if (existingRow) {
      // The total only grows, so a failed fit is final for this heartbeat.
      if (!fitsLimit(existingRow.watchSeconds, input)) return { admitted: false };
      continue;
    }

    // First heartbeat of this vendor-month: seed once from the immutable
    // ledger. A concurrent first heartbeat waits on our insert and then takes
    // the conditional DO UPDATE branch against the committed total.
    const inserted = await tx.$queryRaw<CounterRow[]>`
      INSERT INTO "StreamUsageMonthlyCounter" ("vendorId", "monthKey", "watchSeconds", "updatedAt")
      SELECT ${vendorId}, ${monthKey}, seed."watchSeconds" + ${seconds}::integer, CURRENT_TIMESTAMP
      FROM (
        SELECT COALESCE(SUM("watchSeconds"), 0)::integer AS "watchSeconds"
        FROM "StreamUsageLedgerEntry"
        WHERE "vendorId" = ${vendorId} AND "monthKey" = ${monthKey}
      ) AS seed
      WHERE ${limitSeconds}::integer IS NULL
        OR GREATEST(seed."watchSeconds", ${floorSeconds}::integer) + ${seconds}::integer <= ${limitSeconds}::integer
      ON CONFLICT ("vendorId", "monthKey") DO UPDATE
      SET "watchSeconds" = "StreamUsageMonthlyCounter"."watchSeconds" + ${seconds}::integer,
          "updatedAt" = CURRENT_TIMESTAMP
      WHERE ${limitSeconds}::integer IS NULL
        OR GREATEST("StreamUsageMonthlyCounter"."watchSeconds", ${floorSeconds}::integer) + ${seconds}::integer <= ${limitSeconds}::integer
      RETURNING "watchSeconds"`;
    const insertedRow = inserted[0];
    return insertedRow ? admittedReservation(insertedRow.watchSeconds, seconds) : { admitted: false };
  }
  return { admitted: false };
}

/**
 * Current vendor-month usage for read-only quota checks (viewer admission).
 * Falls back to the ledger sum until the month's first heartbeat seeds the row.
 */
export async function readVendorStreamUsageSeconds(
  db: Pick<Prisma.TransactionClient, "streamUsageMonthlyCounter" | "streamUsageLedgerEntry">,
  input: { vendorId: string; monthKey: string },
) {
  const counter = await db.streamUsageMonthlyCounter.findUnique({
    where: { vendorId_monthKey: { vendorId: input.vendorId, monthKey: input.monthKey } },
    select: { watchSeconds: true },
  });
  if (counter) return counter.watchSeconds;
  const ledger = await db.streamUsageLedgerEntry.aggregate({
    where: { vendorId: input.vendorId, monthKey: input.monthKey },
    _sum: { watchSeconds: true },
  });
  return ledger._sum.watchSeconds ?? 0;
}
