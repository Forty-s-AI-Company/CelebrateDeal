import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  after: vi.fn(),
  dispatchAutomationEvent: vi.fn(),
  getDb: vi.fn(),
  revealCommerceOrderPii: vi.fn(),
  sentryCapture: vi.fn(),
}));

vi.mock("next/server", () => ({ after: mocks.after }));
vi.mock("@/lib/automation-workflow", () => ({ dispatchAutomationEvent: mocks.dispatchAutomationEvent }));
vi.mock("@/lib/db", () => ({ getDb: mocks.getDb }));
vi.mock("@/lib/commerce-order-pii", () => ({ revealCommerceOrderPii: mocks.revealCommerceOrderPii }));
// The real monitoring module runs (review MINOR-1): only its Sentry boundary is
// synthetic, so the tests see exactly what would be sent after its key filter.
vi.mock("@sentry/nextjs", () => ({ captureException: mocks.sentryCapture, flush: vi.fn() }));

import {
  dispatchPaymentPaidAutomationForOrder,
  PAYMENT_PAID_AUTOMATION_INLINE_TIMEOUT_MS,
  runPaymentPaidAutomationAfterCommit,
} from "@/lib/payment-paid-automation";

const ORDER = {
  id: "order-1",
  paidAmountCents: 12_000,
  currency: "TWD",
  checkoutIdentityHash: "checkout-identity",
  automationCustomerKeyHash: "customer-key",
  buyerEncryptedEnvelope: "buyer-envelope",
  shippingEncryptedEnvelope: null,
};
const BUYER_EMAIL = "buyer@example.test";

function database(order: unknown = ORDER, rule: unknown = { id: "rule-1" }) {
  return {
    commerceOrder: { findFirst: vi.fn().mockResolvedValue(order) },
    automationRule: { findFirst: vi.fn().mockResolvedValue(rule) },
  };
}

/** Every `extra` payload sent to Sentry. */
function sentReports() {
  return mocks.sentryCapture.mock.calls.map((call) => (call[1] as { extra: Record<string, unknown> }).extra);
}

/** A report carries the fixed diagnostic plus source and operation only: no vendor, order, rule or buyer data. */
function expectSafeReport(extra: Record<string, unknown>, operation: string) {
  expect(extra).toEqual({
    event: "operational_error",
    category: expect.any(String),
    code: expect.any(String),
    source: "payment_paid_automation",
    operation,
  });
  const serialized = JSON.stringify(extra);
  for (const secret of ["vendor-1", "order-1", "rule-1", "customer-key", BUYER_EMAIL]) expect(serialized).not.toContain(secret);
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("SENTRY_DSN", "https://synthetic@sentry.invalid/1");
  mocks.after.mockImplementation(() => { throw new Error("`after` was called outside a request scope"); });
  mocks.revealCommerceOrderPii.mockReturnValue({ buyer: { name: "買家", email: BUYER_EMAIL }, shipping: null });
  mocks.dispatchAutomationEvent.mockResolvedValue([{ ruleId: "rule-1", status: "completed" }]);
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

describe("dispatchPaymentPaidAutomationForOrder", () => {
  it("reads the order bound to the vendor and builds the event only from it", async () => {
    const db = database();
    await expect(dispatchPaymentPaidAutomationForOrder({ vendorId: "vendor-1", orderId: "order-1" }, db as never))
      .resolves.toEqual({ status: "dispatched", results: [{ ruleId: "rule-1", status: "completed" }] });
    expect(db.automationRule.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { vendorId: "vendor-1", trigger: "payment_paid", isActive: true } }));
    expect(db.commerceOrder.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: "order-1", vendorId: "vendor-1", status: "paid", refundedAmountCents: 0, isTestOrder: false, vendor: { is: { suspendedAt: null } } },
    }));
    expect(mocks.revealCommerceOrderPii).toHaveBeenCalledWith({ buyerEncrypted: "buyer-envelope", shippingEncrypted: null }, { vendorId: "vendor-1", orderId: "order-1" });
    expect(mocks.dispatchAutomationEvent).toHaveBeenCalledWith(db, {
      vendorId: "vendor-1",
      eventId: "payment-paid:order-1",
      trigger: "payment_paid",
      subjectType: "buyer_order",
      subjectId: "order-1",
      subjectKeyHash: "customer-key",
      orderAmountCents: 12_000,
      currency: "TWD",
      recipientEmail: BUYER_EMAIL,
    });
    expect(mocks.sentryCapture).not.toHaveBeenCalled();
  });

  it("falls back to the checkout identity and runs without an e-mail when the buyer cannot be read", async () => {
    mocks.revealCommerceOrderPii.mockImplementation(() => { throw new Error(`cannot decrypt ${BUYER_EMAIL}`); });
    const db = database({ ...ORDER, automationCustomerKeyHash: null });
    await dispatchPaymentPaidAutomationForOrder({ vendorId: "vendor-1", orderId: "order-1" }, db as never);
    const event = mocks.dispatchAutomationEvent.mock.calls[0]?.[1];
    expect(event).toMatchObject({ subjectKeyHash: "checkout-identity" });
    expect(event).not.toHaveProperty("recipientEmail");
    expect(sentReports()).toHaveLength(1);
    expectSafeReport(sentReports()[0]!, "buyer_email");
  });

  it("without an active rule it never reads the order (NIT: no encrypted data for nothing)", async () => {
    const db = database(ORDER, null);
    await expect(dispatchPaymentPaidAutomationForOrder({ vendorId: "vendor-1", orderId: "order-1" }, db as never)).resolves.toEqual({ status: "no_rules" });
    expect(db.commerceOrder.findFirst).not.toHaveBeenCalled();
    expect(mocks.revealCommerceOrderPii).not.toHaveBeenCalled();
    expect(mocks.dispatchAutomationEvent).not.toHaveBeenCalled();
  });

  it("stops before decrypting for an order that is not applicable", async () => {
    await expect(dispatchPaymentPaidAutomationForOrder({ vendorId: "vendor-1", orderId: "order-1" }, database(null) as never)).resolves.toEqual({ status: "not_applicable" });
    expect(mocks.revealCommerceOrderPii).not.toHaveBeenCalled();
    expect(mocks.dispatchAutomationEvent).not.toHaveBeenCalled();
  });
});

describe("runPaymentPaidAutomationAfterCommit", () => {
  it("only registers an after() hook inside a request; the hook never rejects and reports `dispatch`", async () => {
    const callbacks: Array<() => Promise<void>> = [];
    mocks.after.mockImplementation((callback: () => Promise<void>) => { callbacks.push(callback); });
    mocks.getDb.mockReturnValue(database());
    mocks.dispatchAutomationEvent.mockRejectedValue(new Error("synthetic outage for vendor-1 order-1"));
    await expect(runPaymentPaidAutomationAfterCommit({ vendorId: "vendor-1", orderId: "order-1" })).resolves.toBe("scheduled");
    expect(mocks.dispatchAutomationEvent).not.toHaveBeenCalled();
    expect(callbacks).toHaveLength(1);
    await expect(callbacks[0]!()).resolves.toBeUndefined();
    expect(sentReports()).toHaveLength(1);
    expectSafeReport(sentReports()[0]!, "dispatch");
  });

  it("runs inline outside a request and reports failed rules as `rule_failed` without throwing", async () => {
    mocks.getDb.mockReturnValue(database());
    mocks.dispatchAutomationEvent.mockResolvedValue([{ ruleId: "rule-1", status: "failed" }, { ruleId: "rule-2", status: "completed" }]);
    await expect(runPaymentPaidAutomationAfterCommit({ vendorId: "vendor-1", orderId: "order-1" })).resolves.toBe("ran_inline");
    expect(sentReports()).toHaveLength(1);
    expectSafeReport(sentReports()[0]!, "rule_failed");
  });

  it("stops waiting for a hung inline dispatch after the timeout and reports `inline_timeout`", async () => {
    vi.useFakeTimers();
    mocks.getDb.mockReturnValue(database());
    mocks.dispatchAutomationEvent.mockReturnValue(new Promise(() => {}));
    const pending = runPaymentPaidAutomationAfterCommit({ vendorId: "vendor-1", orderId: "order-1" });
    await vi.advanceTimersByTimeAsync(PAYMENT_PAID_AUTOMATION_INLINE_TIMEOUT_MS);
    await expect(pending).resolves.toBe("ran_inline");
    expect(sentReports()).toHaveLength(1);
    expectSafeReport(sentReports()[0]!, "inline_timeout");
  });

  it("swallows a monitoring failure too", async () => {
    mocks.getDb.mockReturnValue(database());
    mocks.dispatchAutomationEvent.mockRejectedValue(new Error("synthetic outage"));
    mocks.sentryCapture.mockImplementation(() => { throw new Error("monitoring down"); });
    await expect(runPaymentPaidAutomationAfterCommit({ vendorId: "vendor-1", orderId: "order-1" })).resolves.toBe("ran_inline");
  });
});
