import type { PrismaClient } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";
import {
  calculateVoucherDiscount,
  pickLuckyDrawWinner,
  pollPercentages,
  resolveEligibleVoucherClaim,
} from "./live-interaction";

describe("advanced live interaction algorithms", () => {
  it("calculates bounded percentage and fixed discounts without producing a free order", () => {
    expect(calculateVoucherDiscount(10_000, {
      kind: "flash_voucher", durationSec: 60, maxClaims: 10,
      discountType: "percentage", discountValue: 15, productId: null,
    })).toBe(1_500);
    expect(calculateVoucherDiscount(1_000, {
      kind: "flash_voucher", durationSec: 60, maxClaims: 10,
      discountType: "fixed", discountValue: 5_000, productId: null,
    })).toBe(999);
    expect(calculateVoucherDiscount(9_900, {
      kind: "flash_voucher", durationSec: 60, maxClaims: 10,
      discountType: "percentage", discountValue: 15, productId: null,
    }, "TWD")).toBe(1_400);
  });

  it("selects only an existing draw entry and handles an empty draw", () => {
    expect(pickLuckyDrawWinner(["a", "b", "c"], () => 1)).toBe("b");
    expect(pickLuckyDrawWinner([], () => 0)).toBeNull();
  });

  it("projects dynamic poll percentages from canonical option identifiers", () => {
    expect(pollPercentages([
      { id: "option-1", label: "藍色" },
      { id: "option-2", label: "紅色" },
    ], ["option-1", "option-1", "option-2"])).toEqual([
      { id: "option-1", label: "藍色", votes: 2, percentage: 67 },
      { id: "option-2", label: "紅色", votes: 1, percentage: 33 },
    ]);
  });

  it("accepts only a matching, unused and unexpired voucher bearer", async () => {
    const findUnique = vi.fn().mockResolvedValue({
      id: "claim-1",
      vendorId: "vendor-1",
      eventType: "flash_voucher",
      usedOrderId: null,
      expiresAt: new Date("2026-09-07T00:00:00.000Z"),
      productId: "product-1",
      run: {
        eventType: "flash_voucher",
        title: "限時紅包",
        configuration: {
          kind: "flash_voucher", durationSec: 60, maxClaims: 10,
          discountType: "percentage", discountValue: 15, productId: "product-1",
        },
      },
    });
    const db = { liveInteractionResponse: { findUnique } } as unknown as PrismaClient;

    await expect(resolveEligibleVoucherClaim(db, "A".repeat(43), {
      vendorId: "vendor-1",
      productId: "product-1",
      priceCents: 9_900,
      currency: "TWD",
      now: new Date("2026-09-06T00:00:00.000Z"),
    })).resolves.toEqual({ id: "claim-1", discountAmountCents: 1_400 });

    await expect(resolveEligibleVoucherClaim(db, "A".repeat(43), {
      vendorId: "vendor-1",
      productId: "another-product",
      priceCents: 9_900,
      currency: "TWD",
      now: new Date("2026-09-06T00:00:00.000Z"),
    })).resolves.toBeNull();
  });
});
