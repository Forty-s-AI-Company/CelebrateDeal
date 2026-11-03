import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ writeAuditLog: vi.fn() }));
vi.mock("@/lib/audit", () => ({ auditSnapshot: (value: unknown) => value, writeAuditLog: mocks.writeAuditLog }));

import { recordUnsupportedCurrencyRefusal } from "@/lib/checkout-currency-audit";

describe("recordUnsupportedCurrencyRefusal (F-041)", () => {
  beforeEach(() => mocks.writeAuditLog.mockReset());

  it("writes a tenant-scoped system audit row with the stored currency code only", async () => {
    mocks.writeAuditLog.mockResolvedValueOnce(undefined);
    await recordUnsupportedCurrencyRefusal({ vendorId: "vendor-1", targetType: "Product", targetId: "product-1", currency: "USD", surface: "checkout_product" });
    expect(mocks.writeAuditLog).toHaveBeenCalledWith({
      vendorId: "vendor-1",
      actorLabel: "system",
      action: "checkout_unsupported_currency_refused",
      targetType: "Product",
      targetId: "product-1",
      after: { surface: "checkout_product", currency: "USD" },
    });
  });

  it("bounds an unexpected stored value and drops non-string currencies", async () => {
    mocks.writeAuditLog.mockResolvedValue(undefined);
    await recordUnsupportedCurrencyRefusal({ vendorId: "vendor-1", targetType: "PaymentTransaction", targetId: "tx-1", currency: "X".repeat(40), surface: "payuni_checkout_session" });
    await recordUnsupportedCurrencyRefusal({ vendorId: "vendor-1", targetType: "PaymentTransaction", targetId: "tx-2", currency: null, surface: "payuni_checkout_session" });
    expect(mocks.writeAuditLog.mock.calls[0]?.[0].after).toEqual({ surface: "payuni_checkout_session", currency: "X".repeat(16) });
    expect(mocks.writeAuditLog.mock.calls[1]?.[0].after).toEqual({ surface: "payuni_checkout_session", currency: null });
  });

  it("keeps the refusal unchanged when the audit store fails", async () => {
    mocks.writeAuditLog.mockRejectedValueOnce(new Error("audit store unavailable"));
    await expect(recordUnsupportedCurrencyRefusal({ vendorId: "vendor-1", targetType: "Product", targetId: "product-1", currency: "USD", surface: "checkout_product" })).resolves.toBeUndefined();
  });
});
