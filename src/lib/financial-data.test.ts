import { describe, expect, it } from "vitest";
import { canTransitionPayoutItem, isValidRefundAmount, maskBankAccount, safeCsvCell } from "@/lib/financial-data";

describe("maskBankAccount", () => {
  it("shows only the final four account digits", () => {
    expect(maskBankAccount("012345678901")).toBe("********8901");
    expect(maskBankAccount("1234")).toBe("****1234");
    expect(maskBankAccount(null)).toBe("未設定");
  });
});

describe("safeCsvCell", () => {
  it.each(["=2+2", "+cmd", "-10+20", "@SUM(A1:A2)"])("neutralizes spreadsheet formula %s", (value) => {
    expect(safeCsvCell(value)).toBe(`"'${value}"`);
  });

  it("escapes quotes and preserves ordinary values", () => {
    expect(safeCsvCell('ACME "Taiwan"')).toBe('"ACME ""Taiwan"""');
    expect(safeCsvCell(123)).toBe('"123"');
  });
});

describe("financial state guards", () => {
  it("allows only monotonic payout operations", () => {
    expect(canTransitionPayoutItem("pending", "paid")).toBe(true);
    expect(canTransitionPayoutItem("failed", "retrying")).toBe(true);
    expect(canTransitionPayoutItem("retrying", "paid")).toBe(true);
    expect(canTransitionPayoutItem("paid", "failed")).toBe(false);
    expect(canTransitionPayoutItem("pending", "retrying")).toBe(false);
  });

  it("rejects zero, negative, and over-refund amounts", () => {
    expect(isValidRefundAmount(10000, 2000, 8000)).toBe(true);
    expect(isValidRefundAmount(10000, 2000, 8001)).toBe(false);
    expect(isValidRefundAmount(10000, 2000, 0)).toBe(false);
  });
});
