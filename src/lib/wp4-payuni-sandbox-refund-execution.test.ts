import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ execute: vi.fn() }));
vi.mock("@/lib/payuni-refund-execution", () => ({ executePayUniRefund: mocks.execute }));

import {
  executeNextWp4PayUniSandboxRefund,
  executeWp4PayUniSandboxSubscriptionRefund,
} from "@/lib/wp4-payuni-sandbox-refund-execution";
import { WP4_SANDBOX_FIXTURE } from "@/lib/wp4-sandbox-fixture";

const sourceCommit = "a".repeat(40);

function row(overrides: Record<string, unknown> = {}) {
  return {
    id: "opaque-transaction",
    vendorId: WP4_SANDBOX_FIXTURE.vendorId,
    providerName: "payuni",
    grossAmountCents: 100,
    refundedAmountCents: 0,
    gatewayFeeCents: 0,
    platformFeeCents: 0,
    status: "paid",
    metadata: {
      billingPurpose: "buyer_order",
      productId: WP4_SANDBOX_FIXTURE.productId,
      wp4SourceCommit: sourceCommit,
    },
    ...overrides,
  };
}

function subscriptionRow(overrides: Record<string, unknown> = {}) {
  return row({
    id: "opaque-subscription-transaction",
    metadata: {
      billingPurpose: "platform_subscription_checkout",
      platformSubscriptionId: "wp4_synthetic_subscription_v1",
      billingPlanId: WP4_SANDBOX_FIXTURE.planId,
      wp4SourceCommit: sourceCommit,
    },
    ...overrides,
  });
}

describe("WP4 fixed refund execution", () => {
  const findMany = vi.fn();
  const db = { paymentTransaction: { findMany } };

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.execute.mockResolvedValue({ disposition: "completed" });
  });

  it("selects one exact-source full NT$1 refund without caller values", async () => {
    findMany.mockResolvedValue([row()]);
    await expect(executeNextWp4PayUniSandboxRefund(db as never, sourceCommit, new Date("2026-09-02T00:00:00.000Z")))
      .resolves.toEqual({ status: "COMPLETED", purpose: "buyer_order", phase: "remaining", providerWriteAttempted: true });
    expect(mocks.execute).toHaveBeenCalledWith(expect.objectContaining({
      transactionId: "opaque-transaction",
      refundAmountCents: 100,
      reason: "wp4_sandbox_fixed_refund",
    }));
  });

  it("uses the remaining phase only after the fixed partial state", async () => {
    findMany.mockResolvedValue([row({ grossAmountCents: 300, status: "partially_refunded", refundedAmountCents: 100 })]);
    await expect(executeNextWp4PayUniSandboxRefund(db as never, sourceCommit))
      .resolves.toEqual({ status: "COMPLETED", purpose: "buyer_order", phase: "remaining", providerWriteAttempted: true });
    expect(mocks.execute).toHaveBeenCalledWith(expect.objectContaining({ refundAmountCents: 200 }));
  });

  it("fails closed before provider access for source drift or duplicate candidates", async () => {
    findMany.mockResolvedValue([row({ metadata: { billingPurpose: "buyer_order", productId: WP4_SANDBOX_FIXTURE.productId, wp4SourceCommit: "b".repeat(40) } })]);
    await expect(executeNextWp4PayUniSandboxRefund(db as never, sourceCommit))
      .resolves.toMatchObject({ status: "FIXTURE_UNAVAILABLE", providerWriteAttempted: false });
    expect(mocks.execute).not.toHaveBeenCalled();

    findMany.mockResolvedValue([row(), row({ id: "opaque-transaction-2" })]);
    await expect(executeNextWp4PayUniSandboxRefund(db as never, sourceCommit))
      .resolves.toMatchObject({ status: "CANDIDATE_AMBIGUOUS", purpose: "buyer_order", providerWriteAttempted: false });
    expect(mocks.execute).not.toHaveBeenCalled();
  });

  it("uses the fixed SaaS wrapper and refuses an ineligible server-owned buyer candidate", async () => {
    findMany.mockResolvedValue([subscriptionRow()]);
    await expect(executeWp4PayUniSandboxSubscriptionRefund(db as never, sourceCommit))
      .resolves.toEqual({ status: "COMPLETED", purpose: "platform_subscription", phase: "remaining", providerWriteAttempted: true });

    findMany.mockResolvedValue([row({ grossAmountCents: 1 })]);
    await expect(executeNextWp4PayUniSandboxRefund(db as never, sourceCommit))
      .resolves.toEqual({ status: "REFUND_NOT_ELIGIBLE", purpose: "buyer_order", phase: "remaining", providerWriteAttempted: false });
    expect(mocks.execute).toHaveBeenCalledTimes(1);
  });

  it("does not send a SaaS-only candidate through the buyer wrapper", async () => {
    findMany.mockResolvedValue([subscriptionRow()]);

    await expect(executeNextWp4PayUniSandboxRefund(db as never, sourceCommit))
      .resolves.toEqual({ status: "FIXTURE_UNAVAILABLE", purpose: null, phase: null, providerWriteAttempted: false });
    expect(mocks.execute).not.toHaveBeenCalled();
  });

  it("does not send a buyer-only candidate through the SaaS wrapper", async () => {
    findMany.mockResolvedValue([row()]);

    await expect(executeWp4PayUniSandboxSubscriptionRefund(db as never, sourceCommit))
      .resolves.toEqual({ status: "FIXTURE_UNAVAILABLE", purpose: null, phase: null, providerWriteAttempted: false });
    expect(mocks.execute).not.toHaveBeenCalled();
  });

  it("selects the exact fixed-purpose candidate when buyer and SaaS rows coexist", async () => {
    findMany.mockResolvedValue([row(), subscriptionRow()]);

    await expect(executeNextWp4PayUniSandboxRefund(db as never, sourceCommit))
      .resolves.toMatchObject({ status: "COMPLETED", purpose: "buyer_order" });
    expect(mocks.execute).toHaveBeenLastCalledWith(expect.objectContaining({ transactionId: "opaque-transaction" }));

    await expect(executeWp4PayUniSandboxSubscriptionRefund(db as never, sourceCommit))
      .resolves.toMatchObject({ status: "COMPLETED", purpose: "platform_subscription" });
    expect(mocks.execute).toHaveBeenLastCalledWith(expect.objectContaining({ transactionId: "opaque-subscription-transaction" }));
    expect(mocks.execute).toHaveBeenCalledTimes(2);
  });

  it.each([
    ["provider_unavailable", "PROVIDER_UNAVAILABLE", false],
    ["provider_request_rejected", "PROVIDER_REJECTED", true],
    ["reconciliation_required", "RECONCILIATION_REQUIRED", true],
  ])("returns a closed provider disposition for %s", async (disposition, status, providerWriteAttempted) => {
    findMany.mockResolvedValue([row()]);
    mocks.execute.mockResolvedValueOnce({ disposition });
    await expect(executeNextWp4PayUniSandboxRefund(db as never, sourceCommit))
      .resolves.toEqual({ status, purpose: "buyer_order", phase: "remaining", providerWriteAttempted });
  });

  it("does not count local validation or request-contract rejection as provider writes", async () => {
    findMany.mockResolvedValue([row()]);
    mocks.execute.mockResolvedValueOnce({ disposition: "validation_failed" });
    await expect(executeNextWp4PayUniSandboxRefund(db as never, sourceCommit))
      .resolves.toEqual({ status: "REFUND_NOT_ELIGIBLE", purpose: "buyer_order", phase: "remaining", providerWriteAttempted: false });

    mocks.execute.mockResolvedValueOnce({ disposition: "provider_request_rejected", category: "request_contract" });
    await expect(executeNextWp4PayUniSandboxRefund(db as never, sourceCommit))
      .resolves.toEqual({ status: "PROVIDER_REJECTED", purpose: "buyer_order", phase: "remaining", providerWriteAttempted: false });
    expect(mocks.execute).toHaveBeenCalledTimes(2);
  });

  it.each(["network", "unknown"])("keeps an ambiguous %s provider outcome reserved without a second provider write", async (category) => {
    findMany.mockResolvedValue([row()]);
    mocks.execute.mockResolvedValueOnce({ disposition: "provider_result_ambiguous", category });

    await expect(executeNextWp4PayUniSandboxRefund(db as never, sourceCommit))
      .resolves.toEqual({ status: "RECONCILIATION_REQUIRED", purpose: "buyer_order", phase: "remaining", providerWriteAttempted: true });
    expect(mocks.execute).toHaveBeenCalledTimes(1);
  });

  it("keeps the SaaS unknown provider outcome on reconciliation without a second write", async () => {
    findMany.mockResolvedValue([subscriptionRow()]);
    mocks.execute.mockResolvedValueOnce({ disposition: "provider_result_ambiguous", category: "unknown" });

    await expect(executeWp4PayUniSandboxSubscriptionRefund(db as never, sourceCommit))
      .resolves.toEqual({ status: "RECONCILIATION_REQUIRED", purpose: "platform_subscription", phase: "remaining", providerWriteAttempted: true });
    expect(mocks.execute).toHaveBeenCalledTimes(1);
  });

  it("does not send an invoice-only candidate to the provider", async () => {
    findMany.mockResolvedValue([row({
      metadata: {
        billingPurpose: "invoice_payment",
        invoiceId: WP4_SANDBOX_FIXTURE.invoiceId,
        wp4SourceCommit: sourceCommit,
      },
    })]);

    await expect(executeNextWp4PayUniSandboxRefund(db as never, sourceCommit))
      .resolves.toEqual({ status: "FIXTURE_UNAVAILABLE", purpose: null, phase: null, providerWriteAttempted: false });
    expect(mocks.execute).not.toHaveBeenCalled();
  });
});
