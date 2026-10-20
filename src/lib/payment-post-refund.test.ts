import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  applyPaymentInventoryTransition: vi.fn(),
  reconcileElectronicInvoiceAfterPayment: vi.fn(),
}));

vi.mock("@/lib/inventory-reservations", () => ({ applyPaymentInventoryTransition: mocks.applyPaymentInventoryTransition }));
vi.mock("@/lib/taiwan-electronic-invoice", () => ({ reconcileElectronicInvoiceAfterPayment: mocks.reconcileElectronicInvoiceAfterPayment }));

import {
  applyPostRefundAfterCommit,
  applyPostRefundInTransaction,
  postRefundEventType,
} from "@/lib/payment-post-refund";

const occurredAt = new Date("2026-10-21T00:00:00.000Z");
const db = {} as Parameters<typeof applyPostRefundAfterCommit>[0];

describe("shared post-refund hook (F-045)", () => {
  beforeEach(() => {
    mocks.applyPaymentInventoryTransition.mockReset().mockResolvedValue("released");
    mocks.reconcileElectronicInvoiceAfterPayment.mockReset().mockResolvedValue({ status: "voided" });
  });

  it("classifies full and partial refunds from server totals", () => {
    expect(postRefundEventType(1_200, 1_200)).toBe("refunded");
    expect(postRefundEventType(400, 1_200)).toBe("partially_refunded");
  });

  it("drives the inventory transition with the trusted checkout metadata", async () => {
    const tx = {} as Parameters<typeof applyPostRefundInTransaction>[0];
    await expect(applyPostRefundInTransaction(tx, {
      transaction: { id: "transaction-1", vendorId: "vendor-1" },
      eventType: "refunded",
      trustedCheckoutMetadata: { productId: "product-1" },
      occurredAt,
    })).resolves.toBe("released");
    expect(mocks.applyPaymentInventoryTransition).toHaveBeenCalledWith(tx, {
      transaction: { id: "transaction-1", vendorId: "vendor-1" },
      eventType: "refunded",
      trustedCheckoutMetadata: { productId: "product-1" },
      now: occurredAt,
    });
  });

  it("queues the invoice void or allowance for the canonical order refund", async () => {
    await applyPostRefundAfterCommit(db, {
      vendorId: "vendor-1", paymentTransactionId: "transaction-1", eventType: "partially_refunded", occurredAt,
      refundAmountCents: 400, previousRefundedAmountCents: 200,
      commerceOrderRefund: { orderId: "order-1", refundId: "refund-1" },
    });
    expect(mocks.reconcileElectronicInvoiceAfterPayment).toHaveBeenCalledWith(db, {
      vendorId: "vendor-1", paymentTransactionId: "transaction-1", eventType: "partially_refunded", occurredAt,
      refund: { id: "refund-1", orderId: "order-1", amountCents: 400, cumulativeAmountCents: 600 },
    });
  });

  it("prefers the order's cumulative refund total and skips orderless payments", async () => {
    await applyPostRefundAfterCommit(db, {
      vendorId: "vendor-1", paymentTransactionId: "transaction-1", eventType: "refunded", occurredAt,
      refundAmountCents: 800, previousRefundedAmountCents: 0,
      commerceOrderRefund: { orderId: "order-1", refundId: "refund-2", refundedAmountCents: 1_200 },
    });
    expect(mocks.reconcileElectronicInvoiceAfterPayment.mock.calls[0]?.[1]).toMatchObject({ refund: { cumulativeAmountCents: 1_200 } });

    mocks.reconcileElectronicInvoiceAfterPayment.mockClear();
    await expect(applyPostRefundAfterCommit(db, {
      vendorId: "vendor-1", paymentTransactionId: "transaction-1", eventType: "refunded", occurredAt,
      refundAmountCents: 800, previousRefundedAmountCents: 0, commerceOrderRefund: null,
    })).resolves.toBeNull();
    expect(mocks.reconcileElectronicInvoiceAfterPayment).not.toHaveBeenCalled();
  });

  it("never lets an invoice failure escape after the refund committed", async () => {
    mocks.reconcileElectronicInvoiceAfterPayment.mockRejectedValue(new Error("adapter down"));
    await expect(applyPostRefundAfterCommit(db, {
      vendorId: "vendor-1", paymentTransactionId: "transaction-1", eventType: "refunded", occurredAt,
      refundAmountCents: 800, previousRefundedAmountCents: 400,
      commerceOrderRefund: { orderId: "order-1", refundId: "refund-3" },
    })).resolves.toBeNull();
  });
});
