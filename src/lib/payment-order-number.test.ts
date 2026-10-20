import { Prisma } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";

import {
  generatePaymentOrderNumber,
  isPaymentOrderNumberConflict,
  PAYMENT_ORDER_NUMBER_PATTERN,
  withPaymentOrderNumberRetry,
} from "@/lib/payment-order-number";

// Mirrors PAYUNI_ORDER_NUMBER in src/lib/payment-providers/payuni.ts.
const PAYUNI_ORDER_NUMBER = /^[A-Za-z0-9_-]{1,25}$/;

function uniqueConflict(target: unknown) {
  return new Prisma.PrismaClientKnownRequestError("Unique constraint failed", {
    code: "P2002",
    clientVersion: "test",
    meta: { target },
  });
}

describe("payment order number (F-050)", () => {
  it("uses a UTC date stamp and 14 Crockford base32 characters within PayUni's MerTradeNo contract", () => {
    const value = generatePaymentOrderNumber(new Date("2026-10-21T23:59:59.000Z"));
    expect(value).toMatch(/^CD-261021-[0-9A-HJKMNP-TV-Z]{14}$/);
    expect(value).toMatch(PAYMENT_ORDER_NUMBER_PATTERN);
    expect(value).toMatch(PAYUNI_ORDER_NUMBER);
    expect(value.length).toBeLessThanOrEqual(25);
  });

  it("does not repeat across many draws in the same second", () => {
    const now = new Date("2026-10-21T00:00:00.000Z");
    const values = new Set(Array.from({ length: 5000 }, () => generatePaymentOrderNumber(now)));
    expect(values.size).toBe(5000);
  });

  it("recognizes only order-number unique violations", () => {
    expect(isPaymentOrderNumberConflict(uniqueConflict(["providerName", "orderNumber"]))).toBe(true);
    expect(isPaymentOrderNumberConflict(uniqueConflict(["vendorId", "orderNumber"]))).toBe(true);
    expect(isPaymentOrderNumberConflict(uniqueConflict("PaymentTransaction_providerName_orderNumber_key"))).toBe(true);
    expect(isPaymentOrderNumberConflict(uniqueConflict(["vendorId", "checkoutIdempotencyKey"]))).toBe(false);
    expect(isPaymentOrderNumberConflict(new Error("orderNumber"))).toBe(false);
    expect(isPaymentOrderNumberConflict(new Prisma.PrismaClientKnownRequestError("serialization", {
      code: "P2034", clientVersion: "test", meta: { target: ["orderNumber"] },
    }))).toBe(false);
  });

  it("retries exactly once with a fresh number after an order-number collision", async () => {
    const generate = vi.fn().mockReturnValueOnce("CD-FIRST").mockReturnValueOnce("CD-SECOND").mockReturnValueOnce("CD-THIRD");
    const operation = vi.fn(async (orderNumber: string) => {
      if (orderNumber === "CD-FIRST") throw uniqueConflict(["providerName", "orderNumber"]);
      return orderNumber;
    });
    await expect(withPaymentOrderNumberRetry(operation, generate)).resolves.toBe("CD-SECOND");
    expect(operation.mock.calls.map(([value]) => value)).toEqual(["CD-FIRST", "CD-SECOND"]);
  });

  it("surfaces a second collision and never retries other errors", async () => {
    const collide = vi.fn(async () => { throw uniqueConflict(["providerName", "orderNumber"]); });
    await expect(withPaymentOrderNumberRetry(collide)).rejects.toMatchObject({ code: "P2002" });
    expect(collide).toHaveBeenCalledTimes(2);

    const idempotency = vi.fn(async () => { throw uniqueConflict(["vendorId", "checkoutIdempotencyKey"]); });
    await expect(withPaymentOrderNumberRetry(idempotency)).rejects.toMatchObject({ code: "P2002" });
    expect(idempotency).toHaveBeenCalledTimes(1);
  });
});
