/**
 * F-068 / B04-15: monthly and batch aggregate money columns are PostgreSQL
 * BIGINT (Prisma `BigInt`, JS `bigint`): every money column on Settlement,
 * PayoutBatch.totalAmountCents, PayoutItem.payoutAmountCents and
 * SettlementAdjustmentLedgerEntry.amountCents. Single-transaction columns stay
 * `Int`.
 *
 * Settlement arithmetic keeps using JS numbers, which are exact for integers up
 * to Number.MAX_SAFE_INTEGER cents (about NT$90 trillion). These helpers are
 * the only crossing points between the two representations and fail closed
 * instead of silently rounding: a value outside the safe range, or a value
 * that is not an integer, throws LedgerAmountRangeError.
 *
 * A raw `bigint` must never reach JSON.stringify (route handlers, audit
 * snapshots): convert it with ledgerCentsToNumber first.
 */
export class LedgerAmountRangeError extends Error {
  constructor() {
    super("ledger_amount_out_of_range");
    this.name = "LedgerAmountRangeError";
  }
}

/** Read side: a BigInt aggregate column (or an already-number value) as an exact JS number. */
export function ledgerCentsToNumber(value: bigint | number): number {
  if (typeof value === "number") {
    if (!Number.isSafeInteger(value)) throw new LedgerAmountRangeError();
    return value;
  }
  if (value > BigInt(Number.MAX_SAFE_INTEGER) || value < BigInt(Number.MIN_SAFE_INTEGER)) {
    throw new LedgerAmountRangeError();
  }
  return Number(value);
}

/** Write side: an exact integer number of cents as a bigint for a BigInt column. */
export function ledgerCentsToBigInt(value: bigint | number): bigint {
  if (typeof value === "bigint") return value;
  if (!Number.isSafeInteger(value)) throw new LedgerAmountRangeError();
  return BigInt(value);
}

/** Sums aggregate amounts exactly, whatever mix of bigint and number they arrive in. */
export function sumLedgerCents(values: Iterable<bigint | number>): bigint {
  let total = BigInt(0);
  for (const value of values) total += ledgerCentsToBigInt(value);
  return total;
}

type BigIntFieldsAsNumbers<T> = { [K in keyof T]: T[K] extends bigint ? number : T[K] };

/**
 * Shallow copy of a Prisma row whose own bigint fields become exact numbers,
 * for pages and props that format or add amounts. Nested relations are left
 * as they are.
 */
export function ledgerRowToNumbers<T extends object>(row: T): BigIntFieldsAsNumbers<T> {
  return Object.fromEntries(
    Object.entries(row).map(([key, value]) => [key, typeof value === "bigint" ? ledgerCentsToNumber(value) : value]),
  ) as BigIntFieldsAsNumbers<T>;
}
