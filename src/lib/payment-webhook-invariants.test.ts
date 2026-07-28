import { describe, expect, it } from "vitest";
import {
  resolvePaymentStatus,
  validatePaymentWebhookInvariants,
  type ExistingPaymentSnapshot,
} from "./payment-webhook-invariants";

function payment(overrides: Partial<ExistingPaymentSnapshot> = {}): ExistingPaymentSnapshot {
  return {
    status: "paid",
    grossAmountCents: 100_000,
    refundedAmountCents: 0,
    currency: "TWD",
    refunds: [],
    ...overrides,
  };
}

describe("payment webhook invariants", () => {
  it.each([
    ["paid", "failed", "paid"],
    ["partially_refunded", "failed", "partially_refunded"],
    ["partially_refunded", "paid", "partially_refunded"],
    ["refunded", "failed", "refunded"],
    ["refunded", "paid", "refunded"],
  ])("prevents %s from regressing on a late %s event", (current, eventType, expected) => {
    expect(resolvePaymentStatus(current, eventType as "paid" | "failed")).toBe(expected);
  });

  it("allows forward payment and refund transitions", () => {
    expect(resolvePaymentStatus("pending", "paid")).toBe("paid");
    expect(resolvePaymentStatus("failed", "paid")).toBe("paid");
    expect(resolvePaymentStatus("paid", "partially_refunded")).toBe("partially_refunded");
    expect(resolvePaymentStatus("partially_refunded", "refunded")).toBe("refunded");
  });

  it("rejects a refund without an existing payment transaction", () => {
    expect(() => validatePaymentWebhookInvariants({
      eventId: "evt-refund",
      eventType: "refunded",
      refundAmountCents: 100_000,
    }, null)).toThrow("找不到既存付款交易");
  });

  it("rejects amount and currency mismatches", () => {
    expect(() => validatePaymentWebhookInvariants({
      eventId: "evt-paid",
      eventType: "paid",
      grossAmountCents: 99_999,
      refundAmountCents: 0,
    }, payment())).toThrow("金額");

    expect(() => validatePaymentWebhookInvariants({
      eventId: "evt-paid",
      eventType: "paid",
      currency: "USD",
      refundAmountCents: 0,
    }, payment())).toThrow("幣別");
  });

  it("rejects refunds that exceed or contradict the remaining refundable amount", () => {
    const partiallyRefunded = payment({
      status: "partially_refunded",
      refundedAmountCents: 40_000,
      refunds: [{ providerEventId: "evt-first", refundAmountCents: 40_000 }],
    });

    expect(() => validatePaymentWebhookInvariants({
      eventId: "evt-over",
      eventType: "partially_refunded",
      refundAmountCents: 70_000,
    }, partiallyRefunded)).toThrow("剩餘可退款額度");

    expect(() => validatePaymentWebhookInvariants({
      eventId: "evt-full",
      eventType: "refunded",
      refundAmountCents: 50_000,
    }, partiallyRefunded)).toThrow("必須等於");

    expect(() => validatePaymentWebhookInvariants({
      eventId: "evt-partial",
      eventType: "partially_refunded",
      refundAmountCents: 60_000,
    }, partiallyRefunded)).toThrow("部分退款");
  });

  it("allows an exact duplicate refund event but rejects a mutated duplicate", () => {
    const existing = payment({
      status: "partially_refunded",
      refundedAmountCents: 20_000,
      refunds: [{ providerEventId: "evt-refund", refundAmountCents: 20_000 }],
    });

    expect(validatePaymentWebhookInvariants({
      eventId: "evt-refund",
      eventType: "partially_refunded",
      refundAmountCents: 20_000,
    }, existing)).toMatchObject({ duplicateRefundEvent: true });

    expect(() => validatePaymentWebhookInvariants({
      eventId: "evt-refund",
      eventType: "partially_refunded",
      refundAmountCents: 30_000,
    }, existing)).toThrow("事件金額");
  });
});
