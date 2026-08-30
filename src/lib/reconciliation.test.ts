import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  paymentTransactionFindFirst: vi.fn(),
  invoiceFindFirst: vi.fn(),
  affiliateCommissionFindFirst: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  getDb: () => ({
    paymentTransaction: { findFirst: mocks.paymentTransactionFindFirst },
    invoice: { findFirst: mocks.invoiceFindFirst },
    affiliateCommission: { findFirst: mocks.affiliateCommissionFindFirst },
  }),
}));

import { reconcileWebhookEvent } from "./reconciliation";

const event = {
  id: "webhook-1",
  vendorId: "vendor-1",
  provider: "demo",
  eventId: "event-1",
  eventType: "paid",
  status: "processed",
  payload: {
    normalized: {
      provider: "demo",
      eventId: "event-1",
      eventType: "paid",
      vendorId: "vendor-1",
      orderNumber: "ORDER-1",
      grossAmountCents: 2400,
    },
  },
} as never;

beforeEach(() => {
  vi.clearAllMocks();
  mocks.paymentTransactionFindFirst.mockResolvedValue({
    id: "transaction-1",
    providerName: "demo",
    orderNumber: "ORDER-1",
    paymentMode: "platform",
    grossAmountCents: 2400,
    refundedAmountCents: 0,
    status: "paid",
    metadata: {
      billingPurpose: "invoice_payment",
      invoiceId: "invoice-1",
    },
    refunds: [],
  });
  mocks.invoiceFindFirst.mockResolvedValue({
    id: "invoice-1",
    totalCents: 2400,
    status: "paid",
  });
  mocks.affiliateCommissionFindFirst.mockResolvedValue(null);
});

describe("invoice payment reconciliation", () => {
  it("reconciles invoice identity, amount, and settled status", async () => {
    const checks = await reconcileWebhookEvent(event);

    expect(checks.find((check) => check.key === "invoice_identity")).toMatchObject({ status: "pass" });
    expect(checks.find((check) => check.key === "invoice_amount")).toMatchObject({ status: "pass" });
    expect(checks.find((check) => check.key === "invoice_status")).toMatchObject({ status: "pass" });
    expect(mocks.invoiceFindFirst).toHaveBeenCalledWith({
      where: { id: "invoice-1", vendorId: "vendor-1" },
    });
  });

  it("fails closed when a trusted invoice payment points to the wrong amount or status", async () => {
    mocks.invoiceFindFirst.mockResolvedValue({
      id: "invoice-1",
      totalCents: 2500,
      status: "issued",
    });

    const checks = await reconcileWebhookEvent(event);

    expect(checks.find((check) => check.key === "invoice_identity")).toMatchObject({ status: "pass" });
    expect(checks.find((check) => check.key === "invoice_amount")).toMatchObject({ status: "fail" });
    expect(checks.find((check) => check.key === "invoice_status")).toMatchObject({ status: "fail" });
  });

  it("keeps non-invoice payment reconciliation unchanged", async () => {
    mocks.paymentTransactionFindFirst.mockResolvedValueOnce({
      id: "transaction-2",
      providerName: "demo",
      orderNumber: "ORDER-1",
      paymentMode: "byo",
      grossAmountCents: 2400,
      refundedAmountCents: 0,
      status: "paid",
      metadata: { billingPurpose: "course_checkout" },
      refunds: [],
    });

    const checks = await reconcileWebhookEvent(event);

    expect(checks.some((check) => check.key.startsWith("invoice_"))).toBe(false);
    expect(mocks.invoiceFindFirst).not.toHaveBeenCalled();
  });
});
