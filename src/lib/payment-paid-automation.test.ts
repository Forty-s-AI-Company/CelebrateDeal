import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  after: vi.fn(),
  dispatchAutomationEvent: vi.fn(),
  captureOperationalError: vi.fn(),
  getDb: vi.fn(),
  revealCommerceOrderPii: vi.fn(),
}));

vi.mock("next/server", () => ({ after: mocks.after }));
vi.mock("@/lib/automation-workflow", () => ({ dispatchAutomationEvent: mocks.dispatchAutomationEvent }));
vi.mock("@/lib/monitoring", () => ({ captureOperationalError: mocks.captureOperationalError }));
vi.mock("@/lib/db", () => ({ getDb: mocks.getDb }));
vi.mock("@/lib/commerce-order-pii", () => ({ revealCommerceOrderPii: mocks.revealCommerceOrderPii }));

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

function database(order: unknown = ORDER, rule: unknown = { id: "rule-1" }) {
  return {
    commerceOrder: { findFirst: vi.fn().mockResolvedValue(order) },
    automationRule: { findFirst: vi.fn().mockResolvedValue(rule) },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.after.mockImplementation(() => { throw new Error("`after` was called outside a request scope"); });
  mocks.revealCommerceOrderPii.mockReturnValue({ buyer: { name: "買家", email: "buyer@example.test" }, shipping: null });
  mocks.dispatchAutomationEvent.mockResolvedValue([{ ruleId: "rule-1", status: "completed" }]);
});
afterEach(() => vi.useRealTimers());

describe("dispatchPaymentPaidAutomationForOrder", () => {
  it("reads the order bound to the vendor and builds the event only from it", async () => {
    const db = database();
    await expect(dispatchPaymentPaidAutomationForOrder({ vendorId: "vendor-1", orderId: "order-1" }, db as never))
      .resolves.toEqual({ status: "dispatched", results: [{ ruleId: "rule-1", status: "completed" }] });
    expect(db.commerceOrder.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: "order-1", vendorId: "vendor-1", status: "paid", refundedAmountCents: 0, isTestOrder: false, vendor: { is: { suspendedAt: null } } },
    }));
    expect(db.automationRule.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: { vendorId: "vendor-1", trigger: "payment_paid", isActive: true } }));
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
      recipientEmail: "buyer@example.test",
    });
  });

  it("falls back to the checkout identity and runs without an e-mail when the buyer cannot be read", async () => {
    mocks.revealCommerceOrderPii.mockImplementation(() => { throw new Error("synthetic decrypt failure"); });
    const db = database({ ...ORDER, automationCustomerKeyHash: null });
    await dispatchPaymentPaidAutomationForOrder({ vendorId: "vendor-1", orderId: "order-1" }, db as never);
    const event = mocks.dispatchAutomationEvent.mock.calls[0]?.[1];
    expect(event).toMatchObject({ subjectKeyHash: "checkout-identity" });
    expect(event).not.toHaveProperty("recipientEmail");
    expect(mocks.captureOperationalError).toHaveBeenCalledWith(expect.any(Error), expect.objectContaining({ area: "payment_paid_automation", operation: "buyer_email" }));
  });

  it("stops before the rules for an order that is not applicable, and before decrypting without a rule", async () => {
    await expect(dispatchPaymentPaidAutomationForOrder({ vendorId: "vendor-1", orderId: "order-1" }, database(null) as never)).resolves.toEqual({ status: "not_applicable" });
    await expect(dispatchPaymentPaidAutomationForOrder({ vendorId: "vendor-1", orderId: "order-1" }, database(ORDER, null) as never)).resolves.toEqual({ status: "no_rules" });
    expect(mocks.revealCommerceOrderPii).not.toHaveBeenCalled();
    expect(mocks.dispatchAutomationEvent).not.toHaveBeenCalled();
  });
});

describe("runPaymentPaidAutomationAfterCommit", () => {
  it("only registers an after() hook inside a request; the hook never rejects", async () => {
    const callbacks: Array<() => Promise<void>> = [];
    mocks.after.mockImplementation((callback: () => Promise<void>) => { callbacks.push(callback); });
    mocks.getDb.mockReturnValue(database());
    mocks.dispatchAutomationEvent.mockRejectedValue(new Error("synthetic outage"));
    await expect(runPaymentPaidAutomationAfterCommit({ vendorId: "vendor-1", orderId: "order-1" })).resolves.toBe("scheduled");
    expect(mocks.dispatchAutomationEvent).not.toHaveBeenCalled();
    expect(callbacks).toHaveLength(1);
    await expect(callbacks[0]!()).resolves.toBeUndefined();
    expect(mocks.captureOperationalError).toHaveBeenCalledWith(expect.any(Error), expect.objectContaining({ operation: "dispatch", vendorId: "vendor-1" }));
  });

  it("runs inline outside a request and reports failed rules without throwing", async () => {
    mocks.getDb.mockReturnValue(database());
    mocks.dispatchAutomationEvent.mockResolvedValue([{ ruleId: "rule-1", status: "failed" }, { ruleId: "rule-2", status: "completed" }]);
    await expect(runPaymentPaidAutomationAfterCommit({ vendorId: "vendor-1", orderId: "order-1" })).resolves.toBe("ran_inline");
    expect(mocks.captureOperationalError).toHaveBeenCalledWith(expect.any(Error), expect.objectContaining({ operation: "rule_failed", failedRules: 1 }));
  });

  it("stops waiting for a hung inline dispatch after the timeout", async () => {
    vi.useFakeTimers();
    mocks.getDb.mockReturnValue(database());
    mocks.dispatchAutomationEvent.mockReturnValue(new Promise(() => {}));
    const pending = runPaymentPaidAutomationAfterCommit({ vendorId: "vendor-1", orderId: "order-1" });
    await vi.advanceTimersByTimeAsync(PAYMENT_PAID_AUTOMATION_INLINE_TIMEOUT_MS);
    await expect(pending).resolves.toBe("ran_inline");
    expect(mocks.captureOperationalError).toHaveBeenCalledWith(expect.any(Error), expect.objectContaining({ operation: "inline_timeout" }));
  });

  it("swallows a monitoring failure too", async () => {
    mocks.getDb.mockReturnValue(database());
    mocks.dispatchAutomationEvent.mockRejectedValue(new Error("synthetic outage"));
    mocks.captureOperationalError.mockImplementation(() => { throw new Error("monitoring down"); });
    await expect(runPaymentPaidAutomationAfterCommit({ vendorId: "vendor-1", orderId: "order-1" })).resolves.toBe("ran_inline");
  });
});
