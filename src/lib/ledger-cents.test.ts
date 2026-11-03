import { describe, expect, it } from "vitest";

import {
  LedgerAmountRangeError,
  ledgerCentsToBigInt,
  ledgerCentsToNumber,
  ledgerRowToNumbers,
  sumLedgerCents,
} from "@/lib/ledger-cents";

const MAX = Number.MAX_SAFE_INTEGER;

describe("ledger cents conversion (F-068)", () => {
  it("reads BigInt aggregates as exact numbers, including beyond int4", () => {
    expect(ledgerCentsToNumber(BigInt(2_147_483_648))).toBe(2_147_483_648);
    expect(ledgerCentsToNumber(BigInt(-15_000))).toBe(-15_000);
    expect(ledgerCentsToNumber(BigInt(MAX))).toBe(MAX);
    expect(ledgerCentsToNumber(BigInt(-MAX))).toBe(-MAX);
    expect(ledgerCentsToNumber(1_234)).toBe(1_234);
  });

  it("fails closed instead of rounding an unsafe or fractional amount", () => {
    expect(() => ledgerCentsToNumber(BigInt(MAX) + BigInt(1))).toThrow(LedgerAmountRangeError);
    expect(() => ledgerCentsToNumber(BigInt(-MAX) - BigInt(1))).toThrow(LedgerAmountRangeError);
    expect(() => ledgerCentsToNumber(MAX + 1)).toThrow(LedgerAmountRangeError);
    expect(() => ledgerCentsToNumber(10.5)).toThrow(LedgerAmountRangeError);
    expect(() => ledgerCentsToNumber(Number.NaN)).toThrow("ledger_amount_out_of_range");
    expect(() => ledgerCentsToBigInt(0.1)).toThrow(LedgerAmountRangeError);
    expect(() => ledgerCentsToBigInt(Number.POSITIVE_INFINITY)).toThrow(LedgerAmountRangeError);
  });

  it("writes exact integers as bigint", () => {
    expect(ledgerCentsToBigInt(3_000_000_000)).toBe(BigInt(3_000_000_000));
    expect(ledgerCentsToBigInt(-1)).toBe(BigInt(-1));
    expect(ledgerCentsToBigInt(BigInt(7))).toBe(BigInt(7));
  });

  it("sums a mix of bigint and number amounts exactly", () => {
    expect(sumLedgerCents([])).toBe(BigInt(0));
    expect(sumLedgerCents([BigInt(2_147_483_647), 1, BigInt(MAX)])).toBe(BigInt(2_147_483_648) + BigInt(MAX));
    expect(() => sumLedgerCents([1, 0.5])).toThrow(LedgerAmountRangeError);
  });

  it("converts only a row's own bigint fields", () => {
    const createdAt = new Date("2026-10-01T00:00:00.000Z");
    const nested = { totalAmountCents: BigInt(5) };
    const row = ledgerRowToNumbers({ id: "s1", finalPayoutAmountCents: BigInt(9_000_000_000), status: "draft", createdAt, payoutBatch: nested, lockedAt: null });
    expect(row).toEqual({ id: "s1", finalPayoutAmountCents: 9_000_000_000, status: "draft", createdAt, payoutBatch: nested, lockedAt: null });
    expect(row.payoutBatch.totalAmountCents).toBe(BigInt(5));
  });
});
