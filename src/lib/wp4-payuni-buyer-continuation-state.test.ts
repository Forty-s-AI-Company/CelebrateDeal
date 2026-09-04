import { beforeEach, describe, expect, it, vi } from "vitest";
import { readWp4BuyerContinuationState } from "./wp4-payuni-buyer-continuation-state";
import { WP4_CURRENT_BUYER_CALLBACK_SOURCE_SHA } from "./wp4-payuni-buyer-callback-retry";
import { WP4_SANDBOX_FIXTURE } from "./wp4-sandbox-fixture";
const mocks = vi.hoisted(() => ({ tx: vi.fn(), order: vi.fn(), reservation: vi.fn(), email: vi.fn(), refund: vi.fn() }));
const db = { paymentTransaction: { findMany: mocks.tx }, commerceOrder: { findFirst: mocks.order }, inventoryReservation: { findUnique: mocks.reservation }, emailDelivery: { count: mocks.email }, commerceOrderRefund: { count: mocks.refund } } as never;
const row = (status = "paid", metadata: Record<string, unknown> = { wp4SourceCommit: WP4_CURRENT_BUYER_CALLBACK_SOURCE_SHA, billingPurpose: "buyer_order", productId: WP4_SANDBOX_FIXTURE.productId, wp4PaymentSubmissionReserved: true }) => ({ id: "tx", vendorId: WP4_SANDBOX_FIXTURE.vendorId, providerName: "payuni", orderNumber: "ORDER", grossAmountCents: 100, refundedAmountCents: 0, status, metadata });
beforeEach(() => { vi.clearAllMocks(); mocks.tx.mockResolvedValue([row()]); mocks.order.mockResolvedValue({ id: "order", status: "paid", paidAmountCents: 100, totalAmountCents: 100, refundedAmountCents: 0 }); mocks.reservation.mockResolvedValue({ vendorId: WP4_SANDBOX_FIXTURE.vendorId, productId: WP4_SANDBOX_FIXTURE.productId, status: "committed" }); mocks.email.mockResolvedValue(1); mocks.refund.mockResolvedValue(0); });
describe("fixed buyer continuation state", () => {
  it("requires matching lifecycle phases and exact order notification identity", async () => {
    mocks.order.mockResolvedValue({ id: "order", status: "refunded", paidAmountCents: 100, totalAmountCents: 100, refundedAmountCents: 100 });
    await expect(readWp4BuyerContinuationState(db)).resolves.toMatchObject({ status: "UNAVAILABLE" });
    expect(mocks.email).toHaveBeenCalledWith({ where: {
      vendorId: WP4_SANDBOX_FIXTURE.vendorId, idempotencyKey: "order-paid:v1:order", status: { in: ["queued", "sent"] },
    } });
    mocks.tx.mockResolvedValue([{ ...row("refunded"), refundedAmountCents: 100 }]);
    mocks.refund.mockResolvedValue(1);
    await expect(readWp4BuyerContinuationState(db)).resolves.toMatchObject({ status: "VERIFIED", paymentStatus: "REFUNDED", refundReconciled: true });
    expect(mocks.refund).toHaveBeenCalledWith({ where: {
      vendorId: WP4_SANDBOX_FIXTURE.vendorId, orderId: "order", paymentTransactionId: "tx", amountCents: 100, status: "processed",
    } });
    mocks.order.mockResolvedValue({ id: "order", status: "refunded", paidAmountCents: 100, totalAmountCents: 100, refundedAmountCents: 0 });
    await expect(readWp4BuyerContinuationState(db)).resolves.toMatchObject({ status: "UNAVAILABLE", refundReconciled: false });
  });
  it("verifies complete paid state without exposing identifiers", async () => { await expect(readWp4BuyerContinuationState(db)).resolves.toEqual({ status: "VERIFIED", paymentStatus: "PAID", orderPaid: true, inventoryCommitted: true, notificationQueued: true, refundReconciled: false }); });
  it("does not count another order's notification or an incomplete refund", async () => { mocks.email.mockResolvedValue(0); await expect(readWp4BuyerContinuationState(db)).resolves.toMatchObject({ status: "UNAVAILABLE", notificationQueued: false }); mocks.tx.mockResolvedValue([row("refunded", { refundedAmountCents: 100 })]); mocks.order.mockResolvedValue({ id: "order", status: "refunded", paidAmountCents: 100, totalAmountCents: 100, refundedAmountCents: 0 }); mocks.email.mockResolvedValue(1); mocks.refund.mockResolvedValue(1); await expect(readWp4BuyerContinuationState(db)).resolves.toMatchObject({ status: "UNAVAILABLE", refundReconciled: false }); });
  it("fails closed for wrong identity, ambiguity, or missing delivery state", async () => { mocks.tx.mockResolvedValue([row("paid", { wp4SourceCommit: "b".repeat(40) })]); await expect(readWp4BuyerContinuationState(db)).resolves.toMatchObject({ status: "UNAVAILABLE" }); mocks.tx.mockResolvedValue([row(), row()]); await expect(readWp4BuyerContinuationState(db)).resolves.toMatchObject({ status: "AMBIGUOUS" }); mocks.tx.mockResolvedValue([row()]); mocks.reservation.mockResolvedValue(null); await expect(readWp4BuyerContinuationState(db)).resolves.toMatchObject({ status: "UNAVAILABLE", paymentStatus: "PAID" }); });
});
