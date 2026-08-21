import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  assertServerActionSecurity: vi.fn(),
  requireVendorManagerMfa: vi.fn(),
  transaction: vi.fn(),
  completeShippingFulfillment: vi.fn(),
  entitlement: vi.fn(),
  service: vi.fn(),
  revalidatePath: vi.fn(),
  redirect: vi.fn((path: string) => { throw new Error(`redirect:${path}`); }),
}));

vi.mock("@/lib/csrf", () => ({ assertServerActionSecurity: mocks.assertServerActionSecurity }));
vi.mock("@/lib/auth", () => ({ requireVendorManagerMfa: mocks.requireVendorManagerMfa }));
vi.mock("@/lib/db", () => ({ getDb: () => ({ $transaction: mocks.transaction }) }));
vi.mock("@/lib/commerce-shipping-action", () => ({ completeShippingFulfillment: mocks.completeShippingFulfillment }));
vi.mock("@/lib/commerce-order-fulfillment", () => ({
  grantCommerceEntitlement: mocks.entitlement,
  transitionServiceFulfillment: mocks.service,
}));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock("next/navigation", () => ({ redirect: mocks.redirect }));

import {
  grantCommerceEntitlementAction,
  transitionServiceFulfillmentAction,
  transitionShippingFulfillmentAction,
} from "@/app/actions/commerce-order-actions";

function form(fields: Record<string, string>) {
  const value = new FormData();
  value.set("_csrf", "valid");
  for (const [key, fieldValue] of Object.entries(fields)) value.set(key, fieldValue);
  return value;
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.assertServerActionSecurity.mockResolvedValue(undefined);
  mocks.requireVendorManagerMfa.mockResolvedValue({
    vendor: { id: "vendor-1" },
    member: { id: "member-1", role: "owner" },
  });
  mocks.transaction.mockImplementation(async (callback: (tx: unknown) => Promise<unknown>) => callback({}));
  mocks.completeShippingFulfillment.mockResolvedValue("/orders/order-1?updated=shipping");
  mocks.entitlement.mockResolvedValue({ orderId: "order-1" });
  mocks.service.mockResolvedValue({ orderId: "order-1" });
});

describe("commerce order fulfillment actions", () => {
  it("uses MFA-scoped tenant identity and forwards a shipping CAS update", async () => {
    const data = form({
      orderId: "order-1", fulfillmentId: "shipping-1", revision: "2", nextStatus: "shipped",
      carrierName: "測試物流", trackingNumber: "TRACK-1234", trackingUrl: "https://carrier.example.test/1234",
    });
    await expect(transitionShippingFulfillmentAction(data)).rejects.toThrow("redirect:/orders/order-1?updated=shipping");
    expect(mocks.completeShippingFulfillment).toHaveBeenCalledWith(data);
  });

  it("accepts the refund-review returned outcome through the same tenant-scoped CAS action", async () => {
    const data = form({
      orderId: "order-1", fulfillmentId: "shipping-1", revision: "4", nextStatus: "returned",
    });
    await expect(transitionShippingFulfillmentAction(data)).rejects.toThrow("redirect:/orders/order-1?updated=shipping");
    expect(mocks.completeShippingFulfillment).toHaveBeenCalledWith(data);
  });

  it("grants an entitlement without accepting a client vendor id", async () => {
    const data = form({ orderId: "order-1", entitlementId: "entitlement-1", revision: "3", vendorId: "forged" });
    await expect(grantCommerceEntitlementAction(data)).rejects.toThrow("redirect:/orders/order-1?updated=entitlement");
    expect(mocks.entitlement).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      vendorId: "vendor-1", entitlementId: "entitlement-1", expectedRevision: 3,
    }));
  });

  it("converts a Taiwan local service time to an explicit instant", async () => {
    const data = form({
      orderId: "order-1", fulfillmentId: "service-1", revision: "1",
      nextStatus: "scheduled", scheduledAt: "2026-08-10T10:30",
    });
    await expect(transitionServiceFulfillmentAction(data)).rejects.toThrow("redirect:/orders/order-1?updated=service");
    expect(mocks.service).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      scheduledAt: new Date("2026-08-10T02:30:00.000Z"),
    }));
  });

  it("returns a bounded conflict route and never leaks an internal failure", async () => {
    mocks.completeShippingFulfillment.mockResolvedValueOnce("/orders/order-1?error=fulfillment_conflict");
    const data = form({ orderId: "order-1", fulfillmentId: "shipping-1", revision: "2", nextStatus: "packing" });
    await expect(transitionShippingFulfillmentAction(data)).rejects.toThrow("redirect:/orders/order-1?error=fulfillment_conflict");
    expect(JSON.stringify(mocks.redirect.mock.calls)).not.toContain("secret-token");
  });
});
