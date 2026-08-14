import { describe, expect, it } from "vitest";
import {
  assertValidCommerceOrderStatusTransition,
  deriveRefundOrderStatus,
  initialFulfillmentStatusForPaidOrder,
  isValidCommerceOrderStatusTransition,
} from "@/lib/commerce-order-domain";

describe("CommerceOrder domain contract", () => {
  it("accepts only canonical and idempotent order status transitions", () => {
    expect(isValidCommerceOrderStatusTransition("draft", "pending_payment")).toBe(true);
    expect(isValidCommerceOrderStatusTransition("pending_payment", "paid")).toBe(true);
    expect(isValidCommerceOrderStatusTransition("paid", "partially_refunded")).toBe(true);
    expect(isValidCommerceOrderStatusTransition("partially_refunded", "refunded")).toBe(true);
    expect(isValidCommerceOrderStatusTransition("pending_payment", "payment_failed")).toBe(true);
    expect(isValidCommerceOrderStatusTransition("pending_payment", "expired")).toBe(true);
    expect(isValidCommerceOrderStatusTransition("payment_failed", "pending_payment")).toBe(true);
    expect(isValidCommerceOrderStatusTransition("payment_failed", "paid")).toBe(true);
    expect(isValidCommerceOrderStatusTransition("expired", "paid")).toBe(true);
    expect(isValidCommerceOrderStatusTransition("paid", "paid")).toBe(true);
    expect(isValidCommerceOrderStatusTransition("paid", "pending_payment")).toBe(false);
    expect(isValidCommerceOrderStatusTransition("refunded", "paid")).toBe(false);
    expect(() => assertValidCommerceOrderStatusTransition("cancelled", "paid")).toThrow(
      "cancelled -> paid",
    );
  });

  it("initializes paid fulfillment status by product type", () => {
    expect(initialFulfillmentStatusForPaidOrder("physical")).toBe("pending");
    expect(initialFulfillmentStatusForPaidOrder("service")).toBe("pending");
    expect(initialFulfillmentStatusForPaidOrder("digital")).toBe("granted");
    expect(initialFulfillmentStatusForPaidOrder("course")).toBe("granted");
  });

  it("derives partial and full refunds without exceeding paid or total amounts", () => {
    expect(deriveRefundOrderStatus({ paidAmountCents: 1_000, totalAmountCents: 1_000, refundedAmountCents: 0 })).toBe("paid");
    expect(deriveRefundOrderStatus({ paidAmountCents: 1_000, totalAmountCents: 1_000, refundedAmountCents: 1 })).toBe("partially_refunded");
    expect(deriveRefundOrderStatus({ paidAmountCents: 1_000, totalAmountCents: 1_000, refundedAmountCents: 1_000 })).toBe("refunded");
    expect(deriveRefundOrderStatus({ paidAmountCents: 800, totalAmountCents: 1_000, refundedAmountCents: 800 })).toBe("refunded");
    expect(() => deriveRefundOrderStatus({ paidAmountCents: 800, totalAmountCents: 1_000, refundedAmountCents: 801 })).toThrow("cannot exceed");
    expect(() => deriveRefundOrderStatus({ paidAmountCents: 1_000, totalAmountCents: 1_000, refundedAmountCents: -1 })).toThrow("non-negative");
  });
});
