import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { retryQ1OriginalBuyerCallback, retryWp4HistoricalBuyerCallback } from "./wp4-buyer-callback-retry";
import { wp4HistoricalBuyerWhere } from "./wp4-buyer-recovery";
import { WP4_SANDBOX_FIXTURE } from "./wp4-sandbox-fixture";
import { retryWebhookEvent } from "./webhook-retry";

vi.mock("./webhook-retry", () => ({ retryWebhookEvent: vi.fn() }));
beforeEach(() => vi.clearAllMocks());

function fixedRetryFixture(retryCount: number, maxRetries: number) {
  const payment = { id: "synthetic-original-payment", vendorId: WP4_SANDBOX_FIXTURE.vendorId,
    orderNumber: "synthetic-original-order", providerName: "payuni", providerTradeNo: null, grossAmountCents: 100, currency: "TWD",
    metadata: { wp4PaymentSubmissionReserved: true } };
  const event = { id: "synthetic-original-event", eventId: "synthetic-provider-event", vendorId: null, status: "failed",
    retryCount, maxRetries, updatedAt: new Date("2026-10-10T00:00:00Z"), payload: { normalized: {
      provider: "payuni", eventId: "synthetic-provider-event", eventType: "paid", orderNumber: payment.orderNumber,
      providerTradeNo: "synthetic-trade", grossAmountCents: 100, currency: "TWD",
    } } };
  const reservePayment = vi.fn().mockResolvedValue(payment);
  const fenceEvent = vi.fn().mockResolvedValue({ count: 1 });
  const tx = { paymentTransaction: { findMany: vi.fn().mockResolvedValue([payment]), update: reservePayment },
    webhookEvent: { findMany: vi.fn().mockResolvedValue([event]), updateMany: fenceEvent } };
  const db = { $transaction: vi.fn(async (work: (value: typeof tx) => unknown) => work(tx)) } as unknown as Pick<PrismaClient, "$transaction">;
  return { db, event, payment, reservePayment, fenceEvent };
}

describe("catalog-owned original callback selectors", () => {
  it("binds Q1 to the paid original source and preserves the historical selector", async () => {
    const findMany = vi.fn().mockResolvedValue([]);
    const db = { $transaction: vi.fn(async (work: (tx: unknown) => unknown) =>
      work({ paymentTransaction: { findMany } })) } as unknown as Pick<PrismaClient, "$transaction">;
    await expect(retryQ1OriginalBuyerCallback(db)).resolves.toMatchObject({
      status: "FIXTURE_UNAVAILABLE", retryAttempts: 0,
    });
    expect(findMany).toHaveBeenLastCalledWith({
      where: wp4HistoricalBuyerWhere("9acfe8d2dba62430e950cff2c0387841ab91f44b"), take: 2,
    });
    await retryWp4HistoricalBuyerCallback(db);
    expect(findMany).toHaveBeenLastCalledWith({ where: wp4HistoricalBuyerWhere(), take: 2 });
  });

  it("rejects ambiguous original payments before reading or dispatching callbacks", async () => {
    const callbacks = vi.fn();
    const db = { $transaction: vi.fn(async (work: (tx: unknown) => unknown) => work({
      paymentTransaction: { findMany: vi.fn().mockResolvedValue([{}, {}]) },
      webhookEvent: { findMany: callbacks },
    })) } as unknown as Pick<PrismaClient, "$transaction">;
    await expect(retryQ1OriginalBuyerCallback(db)).resolves.toMatchObject({
      status: "CANDIDATE_AMBIGUOUS", retryAttempts: 0,
    });
    expect(callbacks).not.toHaveBeenCalled();
  });
});

describe("fixed callback uses the remaining event budget without resetting it", () => {
  it.each([2, 4])("permits one reserved recovery after %i prior failed deliveries", async retryCount => {
    const { db, event, payment, reservePayment, fenceEvent } = fixedRetryFixture(retryCount, 5);
    vi.mocked(retryWebhookEvent).mockResolvedValueOnce({ status: "processed" } as Awaited<ReturnType<typeof retryWebhookEvent>>);
    await expect(retryQ1OriginalBuyerCallback(db)).resolves.toMatchObject({ status: "PROCESSED", retryAttempts: 1 });
    expect(fenceEvent).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ where: {
      id: event.id, status: "failed", retryCount, updatedAt: event.updatedAt,
    } }));
    expect(reservePayment).toHaveBeenCalledExactlyOnceWith({ where: { id: payment.id, vendorId: payment.vendorId },
      data: { metadata: { wp4PaymentSubmissionReserved: true, wp4CallbackRetryReserved: true } } });
    expect(retryWebhookEvent).toHaveBeenCalledExactlyOnceWith(event.id, "wp4_sandbox_fixed_callback_retry", {
      retryCount, updatedAt: expect.any(Date), paymentScope: { vendorId: payment.vendorId,
        paymentTransactionId: payment.id, providerName: "payuni", orderNumber: payment.orderNumber },
    });
  });
  it.each([[-1, 5], [1.5, 5], [5, 5], [2, 0]])("rejects invalid/exhausted count %s budget %s before writes", async (count, budget) => {
    const { db, reservePayment, fenceEvent } = fixedRetryFixture(count, budget);
    await expect(retryQ1OriginalBuyerCallback(db)).resolves.toMatchObject({ status: "RETRY_REJECTED", retryAttempts: 0 });
    expect(reservePayment).not.toHaveBeenCalled(); expect(fenceEvent).not.toHaveBeenCalled();
    expect(retryWebhookEvent).not.toHaveBeenCalled();
  });
});
