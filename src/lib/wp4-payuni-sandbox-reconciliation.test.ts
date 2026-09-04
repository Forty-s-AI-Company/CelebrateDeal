import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getPaymentProvider: vi.fn(),
  queryPayment: vi.fn(),
  reconcilePayUniRefund: vi.fn(),
}));

vi.mock("@/lib/payment-providers", () => ({ getPaymentProvider: mocks.getPaymentProvider }));
vi.mock("@/lib/payuni-refund-reconciliation", () => ({ reconcilePayUniRefund: mocks.reconcilePayUniRefund }));

import {
  isWp4PayUniSandboxTransactionForSource,
  isWp4PayUniSandboxTransaction,
  reconcileWp4PayUniSandboxRefund,
  reconcileWp4PayUniSandboxSubscriptionRefund,
  wp4SourceCommitFromMetadata,
  wp4PayUniPurposeFromMetadata,
} from "@/lib/wp4-payuni-sandbox-reconciliation";
import { WP4_SANDBOX_FIXTURE } from "@/lib/wp4-sandbox-fixture";
import { PaymentQueryProviderError } from "@/lib/payment-providers/types";

const sourceCommit = "a".repeat(40);

function reconciliationRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "opaque-transaction",
    vendorId: WP4_SANDBOX_FIXTURE.vendorId,
    providerName: "payuni",
    grossAmountCents: 100,
    status: "paid",
    providerTradeNo: "trade-no",
    orderNumber: "order-no",
    metadata: {
      billingPurpose: "platform_subscription_checkout",
      platformSubscriptionId: "wp4_synthetic_subscription_v1",
      billingPlanId: WP4_SANDBOX_FIXTURE.planId,
      wp4SourceCommit: sourceCommit,
    },
    ...overrides,
  };
}

describe("WP4 PayUni Sandbox transaction boundary", () => {
  it("recognizes only the fixed server-owned purposes", () => {
    expect(wp4PayUniPurposeFromMetadata({ billingPurpose: "buyer_order" })).toBe("buyer_order");
    expect(wp4PayUniPurposeFromMetadata({ billingPurpose: "platform_subscription_checkout" })).toBe("platform_subscription");
    expect(wp4PayUniPurposeFromMetadata({ billingPurpose: "invoice_payment" })).toBe("invoice_payment");
    expect(wp4PayUniPurposeFromMetadata({ billingPurpose: "anything_else" })).toBeNull();
    expect(wp4PayUniPurposeFromMetadata(null)).toBeNull();
  });

  it.each([
    ["buyer_order", { productId: WP4_SANDBOX_FIXTURE.productId }],
    ["platform_subscription_checkout", {
      platformSubscriptionId: "wp4_synthetic_subscription_v1",
      billingPlanId: WP4_SANDBOX_FIXTURE.planId,
    }],
    ["invoice_payment", { invoiceId: WP4_SANDBOX_FIXTURE.invoiceId }],
  ] as const)("accepts the matching %s fixture transaction", (billingPurpose, fixtureIdentity) => {
    expect(isWp4PayUniSandboxTransaction({
      vendorId: WP4_SANDBOX_FIXTURE.vendorId,
      providerName: "payuni",
      grossAmountCents: 100,
      status: "paid",
      metadata: { billingPurpose, ...fixtureIdentity },
    })).toBe(true);
  });

  it("rejects cross-tenant, caller-shaped, and terminally invalid candidates", () => {
    const base = {
      vendorId: WP4_SANDBOX_FIXTURE.vendorId,
      providerName: "payuni",
      grossAmountCents: 100,
      status: "paid",
      metadata: { billingPurpose: "buyer_order", productId: WP4_SANDBOX_FIXTURE.productId },
    };
    expect(isWp4PayUniSandboxTransaction({ ...base, vendorId: "other-vendor" })).toBe(false);
    expect(isWp4PayUniSandboxTransaction({ ...base, providerName: "demo" })).toBe(false);
    expect(isWp4PayUniSandboxTransaction({ ...base, grossAmountCents: 0 })).toBe(false);
    expect(isWp4PayUniSandboxTransaction({ ...base, status: "pending" })).toBe(false);
    expect(isWp4PayUniSandboxTransaction({ ...base, metadata: { billingPurpose: "buyer_order", productId: "caller-value" } })).toBe(false);
    const platformCheckout = {
      ...base,
      metadata: {
        billingPurpose: "platform_subscription_checkout",
        platformSubscriptionId: "wp4_synthetic_subscription_v1",
        billingPlanId: WP4_SANDBOX_FIXTURE.planId,
      },
    };
    expect(isWp4PayUniSandboxTransaction(platformCheckout)).toBe(true);
    expect(isWp4PayUniSandboxTransaction({ ...platformCheckout, metadata: { ...platformCheckout.metadata, platformSubscriptionId: "" } })).toBe(false);
    expect(isWp4PayUniSandboxTransaction({ ...platformCheckout, metadata: { ...platformCheckout.metadata, billingPlanId: "caller-plan" } })).toBe(false);
  });

  it("requires an exact server-owned source marker for a current run", () => {
    const sourceCommit = "a".repeat(40);
    const candidate = {
      vendorId: WP4_SANDBOX_FIXTURE.vendorId,
      providerName: "payuni",
      grossAmountCents: 100,
      status: "paid",
      metadata: {
        billingPurpose: "buyer_order",
        productId: WP4_SANDBOX_FIXTURE.productId,
        wp4SourceCommit: sourceCommit,
      },
    };
    expect(wp4SourceCommitFromMetadata(candidate.metadata)).toBe(sourceCommit);
    expect(isWp4PayUniSandboxTransactionForSource(candidate, sourceCommit)).toBe(true);
    expect(isWp4PayUniSandboxTransactionForSource(candidate, "b".repeat(40))).toBe(false);
    expect(isWp4PayUniSandboxTransactionForSource({ ...candidate, metadata: { ...candidate.metadata, wp4SourceCommit: "not-a-sha" } }, sourceCommit)).toBe(false);
  });
});

describe("WP4 PayUni Sandbox refund reconciliation", () => {
  const findMany = vi.fn();
  const db = { paymentTransaction: { findMany } };

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getPaymentProvider.mockReturnValue({ queryPayment: mocks.queryPayment });
    mocks.queryPayment.mockResolvedValue({ status: "refunded" });
    mocks.reconcilePayUniRefund.mockResolvedValue({ disposition: "reconciled" });
  });

  it.each([
    ["full", { status: "refunded" }, "reconciled"],
    ["partial", { status: "partially_refunded" }, "already_reconciled"],
  ])("reconciles one current-source SaaS %s candidate", async (_kind, snapshot, disposition) => {
    findMany.mockResolvedValue([reconciliationRow()]);
    mocks.queryPayment.mockResolvedValueOnce(snapshot);
    mocks.reconcilePayUniRefund.mockResolvedValueOnce({ disposition });

    await expect(reconcileWp4PayUniSandboxSubscriptionRefund(db as never, sourceCommit))
      .resolves.toEqual({ reconciled: true, status: "RECONCILED" });
    expect(mocks.queryPayment).toHaveBeenCalledTimes(1);
    expect(mocks.reconcilePayUniRefund).toHaveBeenCalledWith(expect.objectContaining({ transactionId: "opaque-transaction" }));
  });

  it("reports an unknown SaaS provider outcome without claiming reconciliation", async () => {
    findMany.mockResolvedValue([reconciliationRow()]);
    mocks.queryPayment.mockRejectedValueOnce(new Error("provider unavailable"));

    await expect(reconcileWp4PayUniSandboxSubscriptionRefund(db as never, sourceCommit))
      .resolves.toEqual({ reconciled: false, status: "PROJECTION_UNAVAILABLE" });
    expect(mocks.queryPayment).toHaveBeenCalledTimes(1);
    expect(mocks.reconcilePayUniRefund).not.toHaveBeenCalled();
  });

  it.each(["buyer", "subscription"] as const)("preserves %s refund reservations while provider processing is pending", async (purpose) => {
    const row = purpose === "buyer"
      ? reconciliationRow({ metadata: { billingPurpose: "buyer_order", productId: WP4_SANDBOX_FIXTURE.productId, wp4SourceCommit: sourceCommit } })
      : reconciliationRow();
    findMany.mockResolvedValue([row]);
    mocks.queryPayment.mockRejectedValueOnce(new PaymentQueryProviderError("pending"));
    const reconcile = purpose === "buyer" ? reconcileWp4PayUniSandboxRefund : reconcileWp4PayUniSandboxSubscriptionRefund;

    await expect(reconcile(db as never, sourceCommit))
      .resolves.toEqual({ reconciled: false, status: "REFUND_NOT_CONFIRMED" });
    expect(mocks.queryPayment).toHaveBeenCalledTimes(1);
    expect(mocks.reconcilePayUniRefund).not.toHaveBeenCalled();
  });

  it("fails closed for ambiguous SaaS candidates before querying a provider", async () => {
    findMany.mockResolvedValue([reconciliationRow(), reconciliationRow({ id: "opaque-transaction-2" })]);

    await expect(reconcileWp4PayUniSandboxSubscriptionRefund(db as never, sourceCommit))
      .resolves.toEqual({ reconciled: false, status: "CANDIDATE_AMBIGUOUS" });
    expect(mocks.queryPayment).not.toHaveBeenCalled();
    expect(mocks.reconcilePayUniRefund).not.toHaveBeenCalled();
  });

  it("keeps the buyer wrapper isolated when only SaaS has a pending reservation", async () => {
    findMany.mockResolvedValue([reconciliationRow()]);

    await expect(reconcileWp4PayUniSandboxRefund(db as never, sourceCommit))
      .resolves.toEqual({ reconciled: false, status: "FIXTURE_UNAVAILABLE" });
    expect(mocks.queryPayment).not.toHaveBeenCalled();
    expect(mocks.reconcilePayUniRefund).not.toHaveBeenCalled();
  });

  it("reports a completed SaaS candidate through its dedicated wrapper", async () => {
    findMany.mockResolvedValue([reconciliationRow({ status: "refunded" })]);
    mocks.reconcilePayUniRefund.mockResolvedValueOnce({ disposition: "already_reconciled" });

    await expect(reconcileWp4PayUniSandboxSubscriptionRefund(db as never, sourceCommit))
      .resolves.toEqual({ reconciled: true, status: "RECONCILED" });
    expect(mocks.queryPayment).toHaveBeenCalledTimes(1);
    expect(mocks.reconcilePayUniRefund).toHaveBeenCalledTimes(1);
  });

  it("does not query when the provider projection is unavailable", async () => {
    findMany.mockResolvedValue([reconciliationRow()]);
    mocks.getPaymentProvider.mockReturnValueOnce({});

    await expect(reconcileWp4PayUniSandboxSubscriptionRefund(db as never, sourceCommit))
      .resolves.toEqual({ reconciled: false, status: "PROJECTION_UNAVAILABLE" });
    expect(mocks.queryPayment).not.toHaveBeenCalled();
    expect(mocks.reconcilePayUniRefund).not.toHaveBeenCalled();
  });
});
