import type { PrismaClient } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/sensitive-data", () => ({
  deriveSensitiveDataKey: vi.fn(() => Buffer.alloc(32, 11)),
}));

import {
  calculateVoucherDiscount,
  createLuckyDrawClaimCode,
  filterEligibleLuckyDrawEntries,
  hashLuckyDrawClaimCode,
  isLuckyDrawClaimCode,
  luckyDrawClaimHashesMatch,
  maskCustomerName,
  pickLuckyDrawWinner,
  pollPercentages,
  resolveEligibleVoucherClaim,
  resolveEligibleAutomationVoucherClaim,
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

  it("creates CSPRNG-shaped claim codes that are verifiable only by their stored hash", () => {
    const codes = new Set(Array.from({ length: 32 }, () => createLuckyDrawClaimCode()));
    expect(codes).toHaveLength(32);
    for (const code of codes) {
      expect(code).toMatch(/^CD-WIN-[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}$/u);
      expect(isLuckyDrawClaimCode(code)).toBe(true);
      expect(luckyDrawClaimHashesMatch(hashLuckyDrawClaimCode(code), code)).toBe(true);
      expect(luckyDrawClaimHashesMatch(hashLuckyDrawClaimCode(code), "CD-WIN-0000-0000")).toBe(code === "CD-WIN-0000-0000");
    }
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

  it("applies the same bounded checkout discount to automation voucher grants", async () => {
    const db = { automationVoucherGrant: { findUnique: vi.fn().mockResolvedValue({
      id: "grant-1",
      vendorId: "vendor-1",
      productId: "product-1",
      usedOrderId: null,
      expiresAt: new Date("2026-09-07T00:00:00.000Z"),
      currency: "TWD",
      discountType: "percentage",
      discountValue: 15,
    }) } } as unknown as PrismaClient;
    await expect(resolveEligibleAutomationVoucherClaim(db, "B".repeat(43), {
      vendorId: "vendor-1",
      productId: "product-1",
      priceCents: 9_900,
      currency: "TWD",
      now: new Date("2026-09-06T00:00:00.000Z"),
    })).resolves.toEqual({ id: "grant-1", source: "automation", discountAmountCents: 1_400 });
  });

  it("masks customer names cleanly for real-time broadcasts without leaking plaintext PII", () => {
    expect(maskCustomerName("王")).toBe("王*");
    expect(maskCustomerName("陳明")).toBe("陳*");
    expect(maskCustomerName("張小芬")).toBe("張*芬");
    expect(maskCustomerName("諸葛孔明")).toBe("諸**明");
    expect(maskCustomerName("")).toBe("熱門學員");
  });

  it("filters eligible lucky draw entries excluding previous winner participant hashes", () => {
    const entries = [
      { id: "1", participantHash: "hash-a" },
      { id: "2", participantHash: "hash-b" },
      { id: "3", participantHash: "hash-c" },
    ];
    const excluded = new Set(["hash-a", "hash-c"]);
    const eligible = filterEligibleLuckyDrawEntries(entries, { excludedParticipantHashes: excluded });
    expect(eligible).toEqual([{ id: "2", participantHash: "hash-b" }]);

    expect(filterEligibleLuckyDrawEntries(entries)).toHaveLength(3);
  });
});
