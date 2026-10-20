import { describe, expect, it } from "vitest";

import { parseWholeYuanToCents, parseYuanWithCentsToCents } from "@/lib/money-input";

describe("strict finance amount parsing (F-049)", () => {
  it.each([
    ["0", 0],
    ["40", 4_000],
    [" 1200 ", 120_000],
    ["1,000", 100_000],
    ["12,345,678", 1_234_567_800],
    ["999999999", 99_999_999_900],
  ])("parses whole NT$ %j", (raw, cents) => {
    expect(parseWholeYuanToCents(raw)).toBe(cents);
  });

  it.each(["", "1e3", "12abc", "40.5", "40.", "1,00", "1,0000", ",100", "+5", "-5", "1 000", "0x10", "1000000000", "Infinity", "NaN"])(
    "rejects %j as a whole NT$ amount",
    (raw) => {
      expect(parseWholeYuanToCents(raw)).toBeNull();
    },
  );

  it("accepts a sign only when negatives are allowed", () => {
    expect(parseWholeYuanToCents("-1,500", { allowNegative: true })).toBe(-150_000);
    expect(parseWholeYuanToCents("-0", { allowNegative: true })).toBe(0);
    expect(parseWholeYuanToCents("--5", { allowNegative: true })).toBeNull();
  });

  it.each([
    ["0", 0],
    ["4", 400],
    ["4.5", 450],
    ["4.01", 401],
    ["1,234.56", 123_456],
  ])("parses a fee amount %j with at most two decimals", (raw, cents) => {
    expect(parseYuanWithCentsToCents(raw)).toBe(cents);
  });

  it.each(["", "4.001", "1e1", "-1", ".5", "4.", "abc"])("rejects %j as a fee amount", (raw) => {
    expect(parseYuanWithCentsToCents(raw)).toBeNull();
  });
});
