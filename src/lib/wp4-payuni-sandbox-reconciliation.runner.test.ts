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
    metadata: { billingPurpose: "buyer_order", productId: WP4_SANDBOX_FIXTURE.productId, wp4SourceCommit: "a".repeat(40) },
    ...overrides,
  };
}

describe("WP4 PayUni Sandbox refund projection", () => {
  const findMany = vi.fn();
  const db = { paymentTransaction: { findMany } };

  beforeEach(() => {
    vi.clearAllMocks();
    findMany.mockResolvedValue([candidate()]);
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
    findMany.mockResolvedValueOnce([]);

    await expect(reconcileWp4PayUniSandboxRefund(db as never, "a".repeat(40))).resolves.toEqual({
      reconciled: false,
      status: "FIXTURE_UNAVAILABLE",
    });
    expect(mocks.getProvider).not.toHaveBeenCalled();
  });

  it("rejects caller-like cross-fixture rows before provider access", async () => {
    findMany.mockResolvedValueOnce([candidate({ metadata: { billingPurpose: "buyer_order", productId: "other" } })]);

    await expect(reconcileWp4PayUniSandboxRefund(db as never, "a".repeat(40))).resolves.toEqual({
      reconciled: false,
      status: "FIXTURE_UNAVAILABLE",
    });
    expect(mocks.getProvider).not.toHaveBeenCalled();
  });

  it("fails closed before provider access when the current-source buyer flow is ambiguous", async () => {
    findMany.mockResolvedValueOnce([candidate(), candidate({ id: "wp4-transaction-2" })]);

    await expect(reconcileWp4PayUniSandboxRefund(db as never, "a".repeat(40))).resolves.toEqual({
      reconciled: false,
      status: "CANDIDATE_AMBIGUOUS",
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

    await expect(reconcileWp4PayUniSandboxRefund(db as never, "a".repeat(40))).resolves.toEqual({
      reconciled: false,
      status: "REFUND_NOT_CONFIRMED",
    });
    expect(mocks.reconcile).not.toHaveBeenCalled();
  });

  it("reconciles a confirmed refund through the existing accounting core", async () => {
    await expect(reconcileWp4PayUniSandboxRefund(db as never, "a".repeat(40))).resolves.toEqual({
      reconciled: true,
      status: "RECONCILED",
    });
    expect(mocks.reconcile).toHaveBeenCalledWith(expect.objectContaining({
      transactionId: "wp4-transaction",
      actor: { id: WP4_SANDBOX_FIXTURE.userId, label: "wp4_sandbox_runner" },
    }));
  });

  it("verifies an already-completed local refund against the provider snapshot", async () => {
    findMany.mockResolvedValueOnce([candidate({ status: "refunded" })]);
    mocks.reconcile.mockResolvedValueOnce({ disposition: "already_reconciled" });

    await expect(reconcileWp4PayUniSandboxRefund(db as never, "a".repeat(40))).resolves.toEqual({
      reconciled: true,
      status: "RECONCILED",
    });
  });

  it("fails closed when a pending reservation cannot be reconciled", async () => {
    mocks.reconcile.mockRejectedValueOnce(new Error("not exposed"));

    await expect(reconcileWp4PayUniSandboxRefund(db as never, "a".repeat(40))).resolves.toEqual({
      reconciled: false,
      status: "PENDING_RESERVATION_UNAVAILABLE",
    });
  });
});
