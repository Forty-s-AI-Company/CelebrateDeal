import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getProvider: vi.fn(),
  reconcile: vi.fn(),
}));

vi.mock("@/lib/payment-providers", () => ({ getPaymentProvider: mocks.getProvider }));
vi.mock("@/lib/payuni-refund-reconciliation", () => ({ reconcilePayUniRefund: mocks.reconcile }));

import { reconcileWp4PayUniSandboxRefund } from "@/lib/wp4-payuni-sandbox-reconciliation";
import { WP4_SANDBOX_FIXTURE } from "@/lib/wp4-sandbox-fixture";

function candidate(overrides: Record<string, unknown> = {}) {
  return {
    id: "wp4-transaction",
    vendorId: WP4_SANDBOX_FIXTURE.vendorId,
    providerName: "payuni",
    providerTradeNo: "opaque-provider-reference",
    orderNumber: "opaque-order-reference",
    grossAmountCents: 100,
    status: "paid",
    metadata: { billingPurpose: "buyer_order", productId: WP4_SANDBOX_FIXTURE.productId },
    ...overrides,
  };
}

describe("WP4 PayUni Sandbox refund projection", () => {
  const findFirst = vi.fn();
  const db = { paymentTransaction: { findFirst } };

  beforeEach(() => {
    vi.clearAllMocks();
    findFirst.mockResolvedValue(candidate());
    mocks.getProvider.mockReturnValue({
      queryPayment: vi.fn().mockResolvedValue({
        providerTradeNo: "opaque-provider-reference",
        orderNumber: "opaque-order-reference",
        grossAmountCents: 100,
        refundedAmountCents: 100,
        remainingRefundableAmountCents: 0,
        status: "refunded",
      }),
    });
    mocks.reconcile.mockResolvedValue({ disposition: "reconciled" });
  });

  it("does not query a provider when no fixed-fixture transaction is eligible", async () => {
    findFirst.mockResolvedValueOnce(null);

    await expect(reconcileWp4PayUniSandboxRefund(db as never)).resolves.toEqual({
      reconciled: false,
      status: "FIXTURE_UNAVAILABLE",
    });
    expect(mocks.getProvider).not.toHaveBeenCalled();
  });

  it("rejects caller-like cross-fixture rows before provider access", async () => {
    findFirst.mockResolvedValueOnce(candidate({ metadata: { billingPurpose: "buyer_order", productId: "other" } }));

    await expect(reconcileWp4PayUniSandboxRefund(db as never)).resolves.toEqual({
      reconciled: false,
      status: "FIXTURE_UNAVAILABLE",
    });
    expect(mocks.getProvider).not.toHaveBeenCalled();
  });

  it("requires provider refund confirmation before local reconciliation", async () => {
    mocks.getProvider.mockReturnValueOnce({
      queryPayment: vi.fn().mockResolvedValue({
        providerTradeNo: "opaque-provider-reference",
        orderNumber: "opaque-order-reference",
        grossAmountCents: 100,
        refundedAmountCents: 0,
        remainingRefundableAmountCents: 100,
        status: "paid",
      }),
    });

    await expect(reconcileWp4PayUniSandboxRefund(db as never)).resolves.toEqual({
      reconciled: false,
      status: "REFUND_NOT_CONFIRMED",
    });
    expect(mocks.reconcile).not.toHaveBeenCalled();
  });

  it("reconciles a confirmed refund through the existing accounting core", async () => {
    await expect(reconcileWp4PayUniSandboxRefund(db as never)).resolves.toEqual({
      reconciled: true,
      status: "RECONCILED",
    });
    expect(mocks.reconcile).toHaveBeenCalledWith(expect.objectContaining({
      transactionId: "wp4-transaction",
      actor: { id: WP4_SANDBOX_FIXTURE.userId, label: "wp4_sandbox_runner" },
    }));
  });

  it("fails closed when a pending reservation cannot be reconciled", async () => {
    mocks.reconcile.mockRejectedValueOnce(new Error("not exposed"));

    await expect(reconcileWp4PayUniSandboxRefund(db as never)).resolves.toEqual({
      reconciled: false,
      status: "PENDING_RESERVATION_UNAVAILABLE",
    });
  });
});
