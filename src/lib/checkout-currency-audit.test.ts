import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ writeAuditLog: vi.fn(), auditFindFirst: vi.fn() }));
vi.mock("@/lib/audit", () => ({ auditSnapshot: (value: unknown) => value, writeAuditLog: mocks.writeAuditLog }));
vi.mock("@/lib/db", () => ({ getDb: () => ({ auditLog: { findFirst: mocks.auditFindFirst } }) }));

import { recordUnsupportedCurrencyRefusal } from "@/lib/checkout-currency-audit";

describe("recordUnsupportedCurrencyRefusal (F-041)", () => {
  beforeEach(() => {
    mocks.writeAuditLog.mockReset();
    mocks.auditFindFirst.mockReset();
    mocks.auditFindFirst.mockResolvedValue(null);
  });

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

  it("looks for an existing row for the same target and action within the last hour first", async () => {
    const now = new Date("2026-11-03T10:00:00.000Z");
    await recordUnsupportedCurrencyRefusal({ vendorId: "vendor-1", targetType: "PaymentTransaction", targetId: "tx-1", currency: "USD", surface: "payuni_checkout_session" }, now);
    expect(mocks.auditFindFirst).toHaveBeenCalledWith({
      where: {
        targetType: "PaymentTransaction",
        targetId: "tx-1",
        action: "checkout_unsupported_currency_refused",
        createdAt: { gte: new Date("2026-11-03T09:00:00.000Z") },
      },
      select: { id: true },
    });
    expect(mocks.writeAuditLog).toHaveBeenCalledTimes(1);
  });

  it("does not write again while a row from the last hour exists", async () => {
    mocks.auditFindFirst.mockResolvedValueOnce({ id: "audit-recent" });
    await recordUnsupportedCurrencyRefusal({ vendorId: "vendor-1", targetType: "Product", targetId: "product-1", currency: "USD", surface: "checkout_product" });
    expect(mocks.writeAuditLog).not.toHaveBeenCalled();
  });

  it("bounds an unexpected stored value and drops non-string currencies", async () => {
    mocks.writeAuditLog.mockResolvedValue(undefined);
    await recordUnsupportedCurrencyRefusal({ vendorId: "vendor-1", targetType: "PaymentTransaction", targetId: "tx-1", currency: "X".repeat(40), surface: "payuni_checkout_session" });
    await recordUnsupportedCurrencyRefusal({ vendorId: "vendor-1", targetType: "PaymentTransaction", targetId: "tx-2", currency: null, surface: "payuni_checkout_session" });
    expect(mocks.writeAuditLog.mock.calls[0]?.[0].after).toEqual({ surface: "payuni_checkout_session", currency: "X".repeat(16) });
    expect(mocks.writeAuditLog.mock.calls[1]?.[0].after).toEqual({ surface: "payuni_checkout_session", currency: null });
  });

  it.each([
    ["the write fails", () => mocks.writeAuditLog.mockRejectedValueOnce(new Error("audit store unavailable"))],
    ["the recent-row lookup fails", () => mocks.auditFindFirst.mockRejectedValueOnce(new Error("audit store unavailable"))],
  ])("keeps the refusal unchanged when %s", async (_label, arrange) => {
    arrange();
    await expect(recordUnsupportedCurrencyRefusal({ vendorId: "vendor-1", targetType: "Product", targetId: "product-1", currency: "USD", surface: "checkout_product" })).resolves.toBeUndefined();
  });
});
