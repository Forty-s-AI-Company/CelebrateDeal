import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  security: vi.fn(),
  auth: vi.fn(),
  invoice: vi.fn(),
  transactionCreate: vi.fn(),
  subscriptionCreate: vi.fn(),
  checkoutReadiness: vi.fn(),
}));

vi.mock("@/lib/csrf", () => ({ assertServerActionSecurity: mocks.security }));
vi.mock("@/lib/auth", () => ({ requireVendorOwnerFinance: mocks.auth }));
vi.mock("@/lib/audit", () => ({ auditSnapshot: (value: unknown) => value, requestAuditMeta: async () => ({}) }));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined }) }));
vi.mock("@/lib/payment-providers", () => ({ getPaymentProvider: () => ({ id: "payuni", checkoutReadiness: mocks.checkoutReadiness }) }));
vi.mock("@/lib/db", () => ({
  getDb: () => ({
    $transaction: async (callback: (tx: unknown) => unknown) => callback({
      billingPlan: { findFirst: async () => ({ id: "plan-1", monthlyPriceCents: 1000 }) },
      vendorSubscription: { findMany: async () => [], create: mocks.subscriptionCreate },
      invoice: { findFirst: mocks.invoice },
      paymentTransaction: { findUnique: async () => null, create: mocks.transactionCreate },
    }),
  }),
}));

import { createPlatformPlanCheckout } from "./platform-plan-checkout";

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-09-04T00:00:00Z"));
  mocks.security.mockResolvedValue(undefined);
  mocks.auth.mockResolvedValue({ vendor: { id: "vendor-1" }, member: { id: "owner-1" } });
  mocks.invoice.mockResolvedValue(null);
  mocks.checkoutReadiness.mockReturnValue("unavailable");
});
afterEach(() => vi.useRealTimers());

function form() {
  const result = new FormData();
  result.set("planId", "plan-1");
  result.set("vendorId", "untrusted-vendor");
  return result;
}

describe("fixed-plan and monthly-invoice collection boundary", () => {
  it.each(["issued", "overdue", "paid", "partially_refunded", "refunded"])("does not create a plan checkout over an existing %s fixed monthly fee", async (status) => {
    mocks.invoice.mockResolvedValue({ id: "invoice-1", status });
    expect(await createPlatformPlanCheckout(form())).toEqual({ kind: "redirect", path: "/billing/plans?error=conflict" });
    expect(mocks.invoice).toHaveBeenCalledWith({
      where: { vendorId: "vendor-1", monthKey: "2026-09", monthlyFeeCents: { gt: 0 } },
      select: { id: true },
    });
    expect(mocks.transactionCreate).not.toHaveBeenCalled();
    expect(mocks.subscriptionCreate).not.toHaveBeenCalled();
    expect(mocks.checkoutReadiness).not.toHaveBeenCalled();
  });

  it("continues to provider readiness when no fixed fee has already been billed", async () => {
    expect(await createPlatformPlanCheckout(form())).toEqual({ kind: "redirect", path: "/billing/plans?error=checkout" });
    expect(mocks.checkoutReadiness).toHaveBeenCalledOnce();
    expect(mocks.transactionCreate).not.toHaveBeenCalled();
  });

  it("does not inspect invoices before request security succeeds", async () => {
    mocks.security.mockRejectedValue(new Error("denied"));
    await expect(createPlatformPlanCheckout(form())).rejects.toThrow("denied");
    expect(mocks.auth).not.toHaveBeenCalled();
    expect(mocks.invoice).not.toHaveBeenCalled();
  });
});
