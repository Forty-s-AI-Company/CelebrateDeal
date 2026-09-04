import { beforeEach, describe, expect, it, vi } from "vitest";
import { PaymentQueryProviderError } from "@/lib/payment-providers/types";
import { checkWp4PayUniBuyerPayment, WP4_CURRENT_BUYER_PAYMENT_SOURCE_SHA } from "./wp4-payuni-buyer-payment-check";
import { WP4_SANDBOX_FIXTURE } from "./wp4-sandbox-fixture";

const mocks = vi.hoisted(() => ({ findMany: vi.fn(), queryPayment: vi.fn() }));
vi.mock("@/lib/payment-providers", () => ({ getPaymentProvider: () => ({ queryPayment: mocks.queryPayment }) }));

const db = { paymentTransaction: { findMany: mocks.findMany } };
function row(status: string, overrides: Record<string, unknown> = {}) {
  return {
    id: "tx-current-buyer", vendorId: WP4_SANDBOX_FIXTURE.vendorId, providerName: "payuni",
    providerTradeNo: "trade-current", orderNumber: "CD-20260905-ABC123", grossAmountCents: 100,
    status, metadata: {
      wp4SourceCommit: WP4_CURRENT_BUYER_PAYMENT_SOURCE_SHA,
      billingPurpose: "buyer_order", productId: WP4_SANDBOX_FIXTURE.productId,
      wp4PaymentSubmissionReserved: true,
    }, ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.findMany.mockResolvedValue([]);
  mocks.queryPayment.mockResolvedValue({ providerTradeNo: "trade-current", orderNumber: "CD-20260905-ABC123", grossAmountCents: 100, refundedAmountCents: 0, remainingRefundableAmountCents: 100, status: "paid" });
});

describe("current fixed buyer payment check", () => {
  it("returns missing without querying", async () => {
    await expect(checkWp4PayUniBuyerPayment(db)).resolves.toEqual({ status: "MISSING", localStatus: "UNKNOWN", providerStatus: "UNKNOWN", queryAttempts: 0 });
    expect(mocks.queryPayment).not.toHaveBeenCalled();
  });
  it("rejects ambiguous candidates without querying", async () => {
    mocks.findMany.mockResolvedValue([row("paid"), row("pending", { id: "tx-2" })]);
    await expect(checkWp4PayUniBuyerPayment(db)).resolves.toMatchObject({ status: "AMBIGUOUS", queryAttempts: 0 });
    expect(mocks.queryPayment).not.toHaveBeenCalled();
  });
  it("reports pending without a provider reference", async () => {
    mocks.findMany.mockResolvedValue([row("pending", { providerTradeNo: null })]);
    await expect(checkWp4PayUniBuyerPayment(db)).resolves.toEqual({ status: "REFERENCE_UNAVAILABLE", localStatus: "PENDING", providerStatus: "UNKNOWN", queryAttempts: 0 });
  });
  it.each([
    ["paid", "paid", "PAID"],
    ["partially_refunded", "partially_refunded", "PARTIALLY_REFUNDED"],
    ["refunded", "refunded", "REFUNDED"],
  ])("verifies matching %s state", async (local, provider, providerState) => {
    mocks.findMany.mockResolvedValue([row(local)]);
    mocks.queryPayment.mockResolvedValue({ providerTradeNo: "trade-current", orderNumber: "CD-20260905-ABC123", grossAmountCents: 100, refundedAmountCents: 0, remainingRefundableAmountCents: 100, status: provider });
    await expect(checkWp4PayUniBuyerPayment(db)).resolves.toMatchObject({ status: "VERIFIED", localStatus: local === "partially_refunded" ? "PARTIALLY_REFUNDED" : local.toUpperCase(), providerStatus: providerState, queryAttempts: 1 });
  });
  it("returns state mismatch for a successful query with different state or amount", async () => {
    mocks.findMany.mockResolvedValue([row("pending")]);
    await expect(checkWp4PayUniBuyerPayment(db)).resolves.toMatchObject({ status: "STATE_MISMATCH", queryAttempts: 1 });
  });
  it.each([
    [{ vendorId: "other-vendor" }],
    [{ providerName: "demo" }],
    [{ status: "cancelled" }],
    [{ grossAmountCents: 101 }],
    [{ metadata: { wp4SourceCommit: "b".repeat(40), billingPurpose: "buyer_order", productId: WP4_SANDBOX_FIXTURE.productId, wp4PaymentSubmissionReserved: true } }],
    [{ metadata: { wp4SourceCommit: WP4_CURRENT_BUYER_PAYMENT_SOURCE_SHA, billingPurpose: "platform_subscription", productId: WP4_SANDBOX_FIXTURE.productId, wp4PaymentSubmissionReserved: true } }],
    [{ metadata: { wp4SourceCommit: WP4_CURRENT_BUYER_PAYMENT_SOURCE_SHA, billingPurpose: "buyer_order", productId: WP4_SANDBOX_FIXTURE.productId, wp4PaymentSubmissionReserved: false } }],
  ])("rejects a candidate outside the fixed buyer identity boundary", async (overrides) => {
    mocks.findMany.mockResolvedValue([row("paid", overrides)]);
    await expect(checkWp4PayUniBuyerPayment(db)).resolves.toMatchObject({ status: "MISSING", queryAttempts: 0 });
    expect(mocks.queryPayment).not.toHaveBeenCalled();
  });
  it.each([
    [{ providerTradeNo: "other-trade" }],
    [{ orderNumber: "CD-20260905-OTHER" }],
    [{ grossAmountCents: 200 }],
  ])("rejects a provider snapshot identity mismatch", async (snapshotOverrides) => {
    mocks.findMany.mockResolvedValue([row("paid")]);
    mocks.queryPayment.mockResolvedValue({ providerTradeNo: "trade-current", orderNumber: "CD-20260905-ABC123", grossAmountCents: 100, refundedAmountCents: 0, remainingRefundableAmountCents: 100, status: "paid", ...snapshotOverrides });
    await expect(checkWp4PayUniBuyerPayment(db)).resolves.toMatchObject({ status: "STATE_MISMATCH", queryAttempts: 1 });
  });
  it("maps typed query contract and provider failures without exposing details", async () => {
    mocks.findMany.mockResolvedValue([row("paid")]);
    mocks.queryPayment.mockRejectedValueOnce(new Error("secret provider payload"));
    await expect(checkWp4PayUniBuyerPayment(db)).resolves.toMatchObject({ status: "QUERY_FAILED", queryAttempts: 1 });
    mocks.queryPayment.mockRejectedValueOnce(new PaymentQueryProviderError("request_contract"));
    await expect(checkWp4PayUniBuyerPayment(db)).resolves.toMatchObject({ status: "QUERY_REJECTED", queryAttempts: 1 });
  });
});
