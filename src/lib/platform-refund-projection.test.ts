import { describe, expect, it, vi } from "vitest";
import { applyPlatformRefundProjection } from "@/lib/platform-refund-projection";

const refundedSubscriptionTransaction = {
  id: "payment-saas-1",
  vendorId: "vendor-1",
  paymentMode: "platform",
  grossAmountCents: 1_000,
  currency: "TWD",
  status: "refunded",
  refundedAmountCents: 1_000,
  refundedAt: new Date("2026-09-04T00:00:00.000Z"),
  metadata: {
    billingPurpose: "platform_subscription_checkout",
    platformSubscriptionId: "subscription-1",
    billingPlanId: "plan-1",
  },
};

function fakeTx(input: {
  subscription?: Record<string, unknown> | null;
  otherActiveSubscription?: Record<string, unknown> | null;
  invoice?: Record<string, unknown> | null;
  usageLimit?: Record<string, unknown> | null;
  subscriptionUpdateCount?: number;
  invoiceUpdateCount?: number;
} = {}) {
  return {
    vendorSubscription: {
      findUnique: vi.fn().mockResolvedValue(input.subscription ?? {
        id: "subscription-1",
        vendorId: "vendor-1",
        planId: "plan-1",
        paymentMode: "platform",
        status: "active",
      }),
      updateMany: vi.fn().mockResolvedValue({ count: input.subscriptionUpdateCount ?? 1 }),
      findFirst: vi.fn().mockResolvedValue(input.otherActiveSubscription ?? null),
    },
    vendorUsageLimit: {
      findUnique: vi.fn().mockResolvedValue(input.usageLimit ?? {
        billingPlanId: "plan-1", streamMinutesLimit: 100, storageMinutesLimit: 20, creditsLimit: 10,
      }),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
    },
    invoice: {
      findFirst: vi.fn().mockResolvedValue(input.invoice ?? null),
      updateMany: vi.fn().mockResolvedValue({ count: input.invoiceUpdateCount ?? 1 }),
    },
  };
}

describe("platform refund projection", () => {
  it("terminates only the trusted fully-refunded SaaS subscription and revokes its matching quota", async () => {
    const tx = fakeTx();

    await expect(applyPlatformRefundProjection(tx as never, refundedSubscriptionTransaction as never, new Date("2026-09-04T01:00:00.000Z")))
      .resolves.toEqual({ subscription: { id: "subscription-1", status: "payment_refunded" }, invoice: null });

    expect(tx.vendorSubscription.updateMany).toHaveBeenCalledWith({
      where: expect.objectContaining({
        id: "subscription-1",
        vendorId: "vendor-1",
        planId: "plan-1",
        paymentMode: "platform",
        status: { in: ["active", "ended", "payment_superseded"] },
      }),
      data: expect.objectContaining({ status: "payment_refunded" }),
    });
    expect(tx.vendorUsageLimit.updateMany).toHaveBeenCalledWith({
      where: { vendorId: "vendor-1", billingPlanId: "plan-1" },
      data: {
        billingPlanId: null,
        streamMinutesLimit: 0,
        storageMinutesLimit: 0,
        creditsLimit: 0,
      },
    });
  });

  it("keeps SaaS quota unchanged for a partial refund", async () => {
    const tx = fakeTx();
    const partial = { ...refundedSubscriptionTransaction, status: "partially_refunded", refundedAmountCents: 400 };

    await expect(applyPlatformRefundProjection(tx as never, partial as never, new Date())).resolves.toEqual({ subscription: null, invoice: null });

    expect(tx.vendorSubscription.findUnique).toHaveBeenCalledOnce();
    expect(tx.vendorSubscription.updateMany).not.toHaveBeenCalled();
    expect(tx.vendorUsageLimit.updateMany).not.toHaveBeenCalled();
  });

  it("ends the refunded historical subscription but never clears a newer active plan quota", async () => {
    const tx = fakeTx({ otherActiveSubscription: { id: "subscription-newer" } });

    await applyPlatformRefundProjection(tx as never, refundedSubscriptionTransaction as never, new Date());

    expect(tx.vendorSubscription.updateMany).toHaveBeenCalledOnce();
    expect(tx.vendorUsageLimit.updateMany).not.toHaveBeenCalled();
  });

  it("rejects a cross-tenant SaaS snapshot without writes", async () => {
    const tx = fakeTx({ subscription: {
      id: "subscription-1",
      vendorId: "vendor-other",
      planId: "plan-1",
      paymentMode: "platform",
      status: "active",
    } });

    await expect(applyPlatformRefundProjection(tx as never, refundedSubscriptionTransaction as never, new Date())).rejects.toMatchObject({ reason: "subscription_identity" });

    expect(tx.vendorSubscription.updateMany).not.toHaveBeenCalled();
    expect(tx.vendorUsageLimit.updateMany).not.toHaveBeenCalled();
  });

  it.each([
    { label: "SaaS", metadata: refundedSubscriptionTransaction.metadata },
    { label: "invoice", metadata: { billingPurpose: "invoice_payment", invoiceId: "invoice-1" } },
  ])("rejects a full %s platform purpose with the wrong payment mode before any projection write", async ({ metadata }) => {
    const tx = fakeTx();
    const wrongMode = { ...refundedSubscriptionTransaction, paymentMode: "byo", metadata };

    await expect(applyPlatformRefundProjection(tx as never, wrongMode as never, new Date())).rejects.toMatchObject({ reason: "payment_mode" });

    expect(tx.vendorSubscription.findUnique).not.toHaveBeenCalled();
    expect(tx.vendorSubscription.updateMany).not.toHaveBeenCalled();
    expect(tx.vendorUsageLimit.findUnique).not.toHaveBeenCalled();
    expect(tx.vendorUsageLimit.updateMany).not.toHaveBeenCalled();
    expect(tx.invoice.findFirst).not.toHaveBeenCalled();
    expect(tx.invoice.updateMany).not.toHaveBeenCalled();
  });

  it("keeps an unknown billing purpose as a no-op", async () => {
    const tx = fakeTx();
    const unknown = { ...refundedSubscriptionTransaction, paymentMode: "byo", metadata: { billingPurpose: "buyer_order" } };

    await expect(applyPlatformRefundProjection(tx as never, unknown as never, new Date())).resolves.toEqual({ subscription: null, invoice: null });
    expect(tx.vendorSubscription.findUnique).not.toHaveBeenCalled();
    expect(tx.invoice.findFirst).not.toHaveBeenCalled();
  });

  it("uses the immutable transaction amount after the current plan price changes", async () => {
    const tx = fakeTx({ subscription: {
      id: "subscription-1", vendorId: "vendor-1", planId: "plan-1", paymentMode: "platform", status: "active",
      plan: { monthlyPriceCents: 9_999 },
    } });

    await expect(applyPlatformRefundProjection(tx as never, refundedSubscriptionTransaction as never, new Date()))
      .resolves.toMatchObject({ subscription: { id: "subscription-1", status: "payment_refunded" } });
    expect(tx.vendorUsageLimit.updateMany).toHaveBeenCalledOnce();
  });

  it("repairs a matching retained quota after a prior full refund without touching another active plan", async () => {
    const tx = fakeTx({ subscription: {
      id: "subscription-1", vendorId: "vendor-1", planId: "plan-1", paymentMode: "platform", status: "payment_refunded",
    } });

    await applyPlatformRefundProjection(tx as never, refundedSubscriptionTransaction as never, new Date());

    expect(tx.vendorSubscription.updateMany).not.toHaveBeenCalled();
    expect(tx.vendorUsageLimit.updateMany).toHaveBeenCalledOnce();
  });

  it("accepts a verified full refund even when provider fee settlement makes net differ from gross", async () => {
    const tx = fakeTx();
    const providerFeeSettlement = { ...refundedSubscriptionTransaction, netAmountCents: 900, gatewayFeeCents: 100 };

    await expect(applyPlatformRefundProjection(tx as never, providerFeeSettlement as never, new Date()))
      .resolves.toMatchObject({ subscription: { status: "payment_refunded" } });
  });

  it("fails closed for a recognized SaaS purpose with an invalid server-owned amount snapshot", async () => {
    const tx = fakeTx();
    const malformed = { ...refundedSubscriptionTransaction, currency: "USD" };

    await expect(applyPlatformRefundProjection(tx as never, malformed as never, new Date())).rejects.toMatchObject({ reason: "subscription_amount" });
    expect(tx.vendorSubscription.updateMany).not.toHaveBeenCalled();
  });

  it.each(["ended", "payment_superseded"] as const)("marks a historical %s subscription refunded without clearing a newer same-plan quota", async (status) => {
    const tx = fakeTx({
      subscription: {
        id: "subscription-1", vendorId: "vendor-1", planId: "plan-1", paymentMode: "platform", status,
      },
      otherActiveSubscription: { id: "subscription-newer" },
    });

    await expect(applyPlatformRefundProjection(tx as never, refundedSubscriptionTransaction as never, new Date()))
      .resolves.toMatchObject({ subscription: { id: "subscription-1", status: "payment_refunded" } });

    expect(tx.vendorSubscription.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ id: "subscription-1", status: { in: ["active", "ended", "payment_superseded"] } }),
    }));
    expect(tx.vendorUsageLimit.updateMany).not.toHaveBeenCalled();
  });

  it("projects a tenant-bound invoice partial refund without changing historical totals", async () => {
    const tx = fakeTx({ invoice: { id: "invoice-1", vendorId: "vendor-1", totalCents: 1_000, status: "paid" } });
    const partial = {
      ...refundedSubscriptionTransaction,
      status: "partially_refunded",
      refundedAmountCents: 250,
      metadata: { billingPurpose: "invoice_payment", invoiceId: "invoice-1" },
    };

    await expect(applyPlatformRefundProjection(tx as never, partial as never, new Date())).resolves.toEqual({ subscription: null, invoice: { id: "invoice-1", status: "partially_refunded" } });

    expect(tx.invoice.updateMany).toHaveBeenCalledWith({
      where: { id: "invoice-1", vendorId: "vendor-1", totalCents: 1_000, status: "paid" },
      data: { status: "partially_refunded" },
    });
  });

  it("projects a tenant-bound invoice full refund and rejects a mismatched invoice amount", async () => {
    const tx = fakeTx({ invoice: { id: "invoice-1", vendorId: "vendor-1", totalCents: 1_000, status: "partially_refunded" } });
    const invoicePayment = {
      ...refundedSubscriptionTransaction,
      metadata: { billingPurpose: "invoice_payment", invoiceId: "invoice-1" },
    };

    await expect(applyPlatformRefundProjection(tx as never, invoicePayment as never, new Date())).resolves.toEqual({ subscription: null, invoice: { id: "invoice-1", status: "refunded" } });
    expect(tx.invoice.updateMany).toHaveBeenCalledWith({
      where: {
        id: "invoice-1",
        vendorId: "vendor-1",
        totalCents: 1_000,
        status: { in: ["paid", "partially_refunded"] },
      },
      data: { status: "refunded" },
    });

    const mismatch = fakeTx({ invoice: { id: "invoice-1", vendorId: "vendor-1", totalCents: 999, status: "paid" } });
    await expect(applyPlatformRefundProjection(mismatch as never, invoicePayment as never, new Date())).rejects.toMatchObject({ reason: "invoice_amount" });
    expect(mismatch.invoice.updateMany).not.toHaveBeenCalled();
  });
});
