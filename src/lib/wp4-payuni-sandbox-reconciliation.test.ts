import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getPaymentProvider: vi.fn(),
  queryPayment: vi.fn(),
  reconcilePayUniRefund: vi.fn(),
}));

vi.mock("@/lib/payment-providers", () => ({ getPaymentProvider: mocks.getPaymentProvider }));
vi.mock("@/lib/payuni-refund-reconciliation", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/lib/payuni-refund-reconciliation")>(),
  reconcilePayUniRefund: mocks.reconcilePayUniRefund,
}));

import {
  isWp4PayUniSandboxTransactionForSource,
  isWp4PayUniSandboxTransaction,
  reconcileWp4PayUniSandboxRefund,
  reconcileWp4PayUniSandboxSubscriptionRefund,
  reconcileWp4PayUniSandboxHistoricalRefund,
  WP4_HISTORICAL_BUYER_REFUND_SOURCE_SHA,
  wp4SourceCommitFromMetadata,
  wp4PayUniPurposeFromMetadata,
} from "@/lib/wp4-payuni-sandbox-reconciliation";
import { WP4_SANDBOX_FIXTURE } from "@/lib/wp4-sandbox-fixture";
import { PaymentQueryProviderError } from "@/lib/payment-providers/types";
import { PayUniRefundReconciliationError } from "@/lib/payuni-refund-reconciliation";
import { PlatformRefundProjectionConflictError } from "@/lib/platform-refund-projection";
import { Prisma } from "@prisma/client";

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

  it("keeps historical recovery source and buyer purpose isolated", async () => {
    const historicalBuyer = reconciliationRow({
      id: "historical_buyer_refund_fixture",
      metadata: { billingPurpose: "buyer_order", productId: WP4_SANDBOX_FIXTURE.productId, wp4SourceCommit: WP4_HISTORICAL_BUYER_REFUND_SOURCE_SHA },
    });
    findMany.mockResolvedValue([reconciliationRow(), historicalBuyer]);

    await expect(reconcileWp4PayUniSandboxHistoricalRefund(db as never))
      .resolves.toEqual({ reconciled: true, status: "RECONCILED" });
    expect(mocks.queryPayment).toHaveBeenCalledExactlyOnceWith({ transaction: historicalBuyer });
    expect(mocks.reconcilePayUniRefund).toHaveBeenCalledWith(expect.objectContaining({ transactionId: historicalBuyer.id }));
  });

  it.each([
    ["authentication", "QUERY_AUTHENTICATION_FAILED"],
    ["request_contract", "QUERY_REQUEST_REJECTED"],
    ["provider_response", "QUERY_RESPONSE_REJECTED"],
    ["network", "QUERY_NETWORK_FAILED"],
    ["unknown", "QUERY_UNKNOWN_FAILED"],
  ] as const)("maps %s query errors to a fixed recovery status", async (category, status) => {
    findMany.mockResolvedValue([reconciliationRow({
      metadata: { billingPurpose: "buyer_order", productId: WP4_SANDBOX_FIXTURE.productId, wp4SourceCommit: WP4_HISTORICAL_BUYER_REFUND_SOURCE_SHA },
    })]);
    mocks.queryPayment.mockRejectedValueOnce(new PaymentQueryProviderError(category));

    await expect(reconcileWp4PayUniSandboxHistoricalRefund(db as never))
      .resolves.toEqual({ reconciled: false, status });
    expect(mocks.reconcilePayUniRefund).not.toHaveBeenCalled();
  });

  it("preserves pending recovery reservations without projection", async () => {
    findMany.mockResolvedValue([reconciliationRow({
      metadata: { billingPurpose: "buyer_order", productId: WP4_SANDBOX_FIXTURE.productId, wp4SourceCommit: WP4_HISTORICAL_BUYER_REFUND_SOURCE_SHA },
    })]);
    mocks.queryPayment.mockRejectedValueOnce(new PaymentQueryProviderError("pending"));

    await expect(reconcileWp4PayUniSandboxHistoricalRefund(db as never))
      .resolves.toEqual({ reconciled: false, status: "REFUND_NOT_CONFIRMED" });
    expect(mocks.reconcilePayUniRefund).not.toHaveBeenCalled();
  });

  it.each([
    ["transaction_not_found", "RECONCILIATION_TRANSACTION_NOT_FOUND"],
    ["provider_mismatch", "RECONCILIATION_PROVIDER_MISMATCH"],
    ["provider_ref_mismatch", "RECONCILIATION_PROVIDER_REF_MISMATCH"],
    ["provider_amount_mismatch", "RECONCILIATION_PROVIDER_AMOUNT_MISMATCH"],
    ["unsupported_status", "RECONCILIATION_UNSUPPORTED_STATUS"],
    ["local_amount_mismatch", "RECONCILIATION_LOCAL_AMOUNT_MISMATCH"],
    ["local_state_ambiguous", "RECONCILIATION_LOCAL_STATE_AMBIGUOUS"],
  ] as const)("maps %s reconciliation errors only on historical recovery", async (reason, status) => {
    findMany.mockResolvedValue([reconciliationRow({
      metadata: { billingPurpose: "buyer_order", productId: WP4_SANDBOX_FIXTURE.productId, wp4SourceCommit: WP4_HISTORICAL_BUYER_REFUND_SOURCE_SHA },
    })]);
    mocks.reconcilePayUniRefund.mockRejectedValueOnce(new PayUniRefundReconciliationError(reason));

    await expect(reconcileWp4PayUniSandboxHistoricalRefund(db as never))
      .resolves.toEqual({ reconciled: false, status });
  });

  it("maps unknown recovery failures to a fixed status without exposing the error", async () => {
    findMany.mockResolvedValue([reconciliationRow({
      metadata: { billingPurpose: "buyer_order", productId: WP4_SANDBOX_FIXTURE.productId, wp4SourceCommit: WP4_HISTORICAL_BUYER_REFUND_SOURCE_SHA },
    })]);
    mocks.reconcilePayUniRefund.mockRejectedValueOnce(new Error("secret-provider-payload"));

    const result = await reconcileWp4PayUniSandboxHistoricalRefund(db as never);
    expect(result).toEqual({ reconciled: false, status: "RECONCILIATION_UNKNOWN_FAILED" });
    expect(JSON.stringify(result)).not.toContain("secret-provider-payload");
  });

  it("maps an unexpected reconciliation reason to the fixed unknown status", async () => {
    findMany.mockResolvedValue([reconciliationRow({
      metadata: { billingPurpose: "buyer_order", productId: WP4_SANDBOX_FIXTURE.productId, wp4SourceCommit: WP4_HISTORICAL_BUYER_REFUND_SOURCE_SHA },
    })]);
    const error = new PayUniRefundReconciliationError("provider_ref_mismatch");
    Object.defineProperty(error, "reason", { value: "unexpected_reason" });
    mocks.reconcilePayUniRefund.mockRejectedValueOnce(error);

    await expect(reconcileWp4PayUniSandboxHistoricalRefund(db as never))
      .resolves.toEqual({ reconciled: false, status: "RECONCILIATION_UNKNOWN_FAILED" });
  });

  it("keeps ordinary buyer recovery on the legacy pending status", async () => {
    findMany.mockResolvedValue([reconciliationRow({
      metadata: { billingPurpose: "buyer_order", productId: WP4_SANDBOX_FIXTURE.productId, wp4SourceCommit: sourceCommit },
    })]);
    mocks.reconcilePayUniRefund.mockRejectedValueOnce(new PayUniRefundReconciliationError("provider_ref_mismatch"));

    await expect(reconcileWp4PayUniSandboxRefund(db as never, sourceCommit))
      .resolves.toEqual({ reconciled: false, status: "PENDING_RESERVATION_UNAVAILABLE" });
  });

  it.each([
    ["P2028", "RECONCILIATION_DATABASE_TRANSACTION_FAILED"],
    ["P2034", "RECONCILIATION_DATABASE_CONFLICT"],
    ["P2002", "RECONCILIATION_DATABASE_CONSTRAINT_FAILED"],
    ["P2003", "RECONCILIATION_DATABASE_CONSTRAINT_FAILED"],
    ["P2021", "RECONCILIATION_DATABASE_SCHEMA_MISMATCH"],
    ["P2022", "RECONCILIATION_DATABASE_SCHEMA_MISMATCH"],
    ["P2025", "RECONCILIATION_DATABASE_RECORD_MISSING"],
    ["P9999", "RECONCILIATION_DATABASE_REQUEST_FAILED"],
  ] as const)("maps known Prisma code %s only during historical recovery", async (code, status) => {
    findMany.mockResolvedValue([reconciliationRow({
      metadata: { billingPurpose: "buyer_order", productId: WP4_SANDBOX_FIXTURE.productId, wp4SourceCommit: WP4_HISTORICAL_BUYER_REFUND_SOURCE_SHA },
    })]);
    mocks.reconcilePayUniRefund.mockRejectedValueOnce(new Prisma.PrismaClientKnownRequestError("synthetic-secret", { code, clientVersion: "test" }));

    await expect(reconcileWp4PayUniSandboxHistoricalRefund(db as never))
      .resolves.toEqual({ reconciled: false, status });
  });

  it.each([
    [new Prisma.PrismaClientValidationError("synthetic-secret", { clientVersion: "test" }), "RECONCILIATION_DATABASE_VALIDATION_FAILED"],
    [new Prisma.PrismaClientInitializationError("synthetic-secret", "test"), "RECONCILIATION_DATABASE_UNAVAILABLE"],
    [new Prisma.PrismaClientUnknownRequestError("synthetic-secret", { clientVersion: "test" }), "RECONCILIATION_DATABASE_ENGINE_FAILED"],
    [new Prisma.PrismaClientRustPanicError("synthetic-secret", "test"), "RECONCILIATION_DATABASE_ENGINE_FAILED"],
    [new PlatformRefundProjectionConflictError("payment_mode"), "RECONCILIATION_PLATFORM_PROJECTION_REJECTED"],
  ] as const)("maps typed recovery error to %s without exposing its message", async (error, status) => {
    findMany.mockResolvedValue([reconciliationRow({
      metadata: { billingPurpose: "buyer_order", productId: WP4_SANDBOX_FIXTURE.productId, wp4SourceCommit: WP4_HISTORICAL_BUYER_REFUND_SOURCE_SHA },
    })]);
    mocks.reconcilePayUniRefund.mockRejectedValueOnce(error);

    const result = await reconcileWp4PayUniSandboxHistoricalRefund(db as never);
    expect(result).toEqual({ reconciled: false, status });
    expect(JSON.stringify(result)).not.toContain("synthetic-secret");
  });

  it("does not classify plain objects that imitate known Prisma errors", async () => {
    findMany.mockResolvedValue([reconciliationRow({
      metadata: { billingPurpose: "buyer_order", productId: WP4_SANDBOX_FIXTURE.productId, wp4SourceCommit: WP4_HISTORICAL_BUYER_REFUND_SOURCE_SHA },
    })]);
    mocks.reconcilePayUniRefund.mockRejectedValueOnce({ code: "P2028", message: "synthetic-secret" });

    await expect(reconcileWp4PayUniSandboxHistoricalRefund(db as never))
      .resolves.toEqual({ reconciled: false, status: "RECONCILIATION_UNKNOWN_FAILED" });
  });
});
