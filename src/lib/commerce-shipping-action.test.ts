import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  assertServerActionSecurity: vi.fn(),
  requireVendorManagerMfa: vi.fn(),
  getDb: vi.fn(),
  transitionShippingFulfillment: vi.fn(),
  revalidatePath: vi.fn(),
}));

vi.mock("@/lib/csrf", () => ({ assertServerActionSecurity: mocks.assertServerActionSecurity }));
vi.mock("@/lib/auth", () => ({ requireVendorManagerMfa: mocks.requireVendorManagerMfa }));
vi.mock("@/lib/db", () => ({ getDb: mocks.getDb }));
vi.mock("@/lib/commerce-order-fulfillment", () => ({
  transitionShippingFulfillment: mocks.transitionShippingFulfillment,
}));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));

import { completeShippingFulfillment } from "./commerce-shipping-action";

function form(fields: Record<string, string>) {
  const value = new FormData();
  value.set("_csrf", "valid");
  for (const [key, fieldValue] of Object.entries(fields)) value.set(key, fieldValue);
  return value;
}

describe("completeShippingFulfillment", () => {
  const database = { $transaction: vi.fn() };

  beforeEach(() => {
    vi.resetAllMocks();
    mocks.assertServerActionSecurity.mockResolvedValue(undefined);
    mocks.requireVendorManagerMfa.mockResolvedValue({
      vendor: { id: "vendor-1" },
      member: { id: "member-1", role: "owner" },
    });
    mocks.getDb.mockReturnValue(database);
    database.$transaction.mockImplementation(async (callback: (tx: unknown) => Promise<unknown>) => callback({}));
    mocks.transitionShippingFulfillment.mockResolvedValue({ orderId: "order-1", status: "shipped", revision: 3 });
  });

  it("preserves tenant-scoped CAS semantics and returns the bounded success path", async () => {
    const data = form({
      orderId: "order-1", fulfillmentId: "shipping-1", revision: "2", nextStatus: "shipped",
      carrierName: "測試物流", trackingNumber: "TRACK-1234", trackingUrl: "https://carrier.example.test/1234",
    });

    await expect(completeShippingFulfillment(data)).resolves.toBe("/orders/order-1?updated=shipping");
    expect(mocks.requireVendorManagerMfa).toHaveBeenCalledWith("/orders/order-1");
    expect(mocks.transitionShippingFulfillment).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      vendorId: "vendor-1", fulfillmentId: "shipping-1", expectedRevision: 2,
      nextStatus: "shipped", actor: { id: "member-1" },
    }));
    expect(mocks.revalidatePath).toHaveBeenNthCalledWith(1, "/orders");
    expect(mocks.revalidatePath).toHaveBeenNthCalledWith(2, "/orders/order-1");
  });

  it("returns a bounded invalid-input path without invoking the fulfillment mutation", async () => {
    const data = form({ orderId: "order-1", fulfillmentId: "shipping-1", revision: "0", nextStatus: "shipped" });

    await expect(completeShippingFulfillment(data)).resolves.toBe("/orders/order-1?error=invalid_fulfillment");
    expect(mocks.transitionShippingFulfillment).not.toHaveBeenCalled();
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });

  it("converts internal transaction failures to a safe conflict path", async () => {
    mocks.transitionShippingFulfillment.mockRejectedValueOnce(new Error("database failed: secret-token"));
    const data = form({ orderId: "order-1", fulfillmentId: "shipping-1", revision: "2", nextStatus: "packing" });

    const destination = await completeShippingFulfillment(data);

    expect(destination).toBe("/orders/order-1?error=fulfillment_conflict");
    expect(destination).not.toContain("secret-token");
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
  });
});
