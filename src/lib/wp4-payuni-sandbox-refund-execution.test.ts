import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ execute: vi.fn() }));
vi.mock("@/lib/payuni-refund-execution", () => ({ executePayUniRefund: mocks.execute }));

import { executeNextWp4PayUniSandboxRefund } from "@/lib/wp4-payuni-sandbox-refund-execution";
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

describe("WP4 fixed refund execution", () => {
  const findMany = vi.fn();
  const db = { paymentTransaction: { findMany } };

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.execute.mockResolvedValue({ disposition: "completed" });
  });

  it("selects one exact-source partial refund without caller values", async () => {
    findMany.mockResolvedValue([row()]);
    await expect(executeNextWp4PayUniSandboxRefund(db as never, sourceCommit, new Date("2026-09-02T00:00:00.000Z")))
      .resolves.toEqual({ status: "COMPLETED", purpose: "buyer_order", phase: "partial", providerWriteAttempted: true });
    expect(mocks.execute).toHaveBeenCalledWith(expect.objectContaining({
      transactionId: "opaque-transaction",
      refundAmountCents: 50,
      reason: "wp4_sandbox_fixed_refund",
    }));
  });

  it("uses the remaining phase only after the fixed partial state", async () => {
    findMany.mockResolvedValue([row({ status: "partially_refunded", refundedAmountCents: 50 })]);
    await expect(executeNextWp4PayUniSandboxRefund(db as never, sourceCommit))
      .resolves.toEqual({ status: "COMPLETED", purpose: "buyer_order", phase: "remaining", providerWriteAttempted: true });
    expect(mocks.execute).toHaveBeenCalledWith(expect.objectContaining({ refundAmountCents: 50 }));
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

  it("walks the fixed purpose order and refuses an ineligible server-owned candidate", async () => {
    findMany.mockResolvedValue([
      row({
        metadata: {
          billingPurpose: "platform_subscription_checkout",
          planId: WP4_SANDBOX_FIXTURE.planId,
          wp4SourceCommit: sourceCommit,
        },
      }),
    ]);
    await expect(executeNextWp4PayUniSandboxRefund(db as never, sourceCommit))
      .resolves.toEqual({ status: "COMPLETED", purpose: "platform_subscription", phase: "partial", providerWriteAttempted: true });

    findMany.mockResolvedValue([row({ grossAmountCents: 1 })]);
    await expect(executeNextWp4PayUniSandboxRefund(db as never, sourceCommit))
      .resolves.toEqual({ status: "REFUND_NOT_ELIGIBLE", purpose: "buyer_order", phase: "partial", providerWriteAttempted: false });
    expect(mocks.execute).toHaveBeenCalledTimes(1);
  });

  it.each([
    ["provider_unavailable", "PROVIDER_UNAVAILABLE", false],
    ["provider_request_rejected", "PROVIDER_REJECTED", true],
    ["reconciliation_required", "RECONCILIATION_REQUIRED", true],
  ])("returns a closed provider disposition for %s", async (disposition, status, providerWriteAttempted) => {
    findMany.mockResolvedValue([row({
      metadata: {
        billingPurpose: "invoice_payment",
        invoiceId: WP4_SANDBOX_FIXTURE.invoiceId,
        wp4SourceCommit: sourceCommit,
      },
    })]);
    mocks.execute.mockResolvedValueOnce({ disposition });
    await expect(executeNextWp4PayUniSandboxRefund(db as never, sourceCommit))
      .resolves.toEqual({ status, purpose: "invoice_payment", phase: "partial", providerWriteAttempted });
  });
});
