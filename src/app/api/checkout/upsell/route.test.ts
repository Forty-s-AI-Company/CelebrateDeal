import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  boundary: vi.fn(),
  readJson: vi.fn(),
  rateLimit: vi.fn(),
  cookies: vi.fn(),
  resolveGrant: vi.fn(),
  resolveOffer: vi.fn(),
  issueToken: vi.fn(),
  checkoutHref: vi.fn(),
  eventCreate: vi.fn(),
}));

vi.mock("next/headers", () => ({ cookies: mocks.cookies }));
vi.mock("@/lib/api-security", () => ({ requireSameOriginRequest: mocks.boundary, readJsonBody: mocks.readJson }));
vi.mock("@/lib/rate-limit", () => ({ checkRateLimit: mocks.rateLimit }));
vi.mock("@/lib/db", () => ({ getDb: () => ({ commerceOrderEvent: { create: mocks.eventCreate } }) }));
vi.mock("@/lib/buyer-support-access", () => ({ resolveBuyerSupportGrant: mocks.resolveGrant }));
vi.mock("@/lib/post-purchase-upsell-access", () => ({ resolvePaidOrderPostPurchaseOffer: mocks.resolveOffer }));
vi.mock("@/lib/post-purchase-upsell", () => ({
  issuePostPurchaseCheckoutToken: mocks.issueToken,
  postPurchaseCheckoutHref: mocks.checkoutHref,
}));

import { POST } from "./route";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.boundary.mockReturnValue(null);
  mocks.rateLimit.mockResolvedValue(null);
  mocks.readJson.mockResolvedValue({ grantId: "grant-1", decision: "accept", kind: "upsell" });
  mocks.cookies.mockResolvedValue({ getAll: () => [] });
  mocks.resolveGrant.mockResolvedValue({
    id: "grant-1",
    vendorId: "vendor-1",
    orderId: "order-1",
    order: { status: "paid", items: [{ productId: "source-product-1" }] },
  });
  mocks.resolveOffer.mockResolvedValue({
    source: { id: "source-product-1" },
    offer: {
      kind: "upsell",
      sourceProductId: "source-product-1",
      productId: "offer-product-1",
      amountCents: 900,
      currency: "TWD",
    },
  });
  mocks.eventCreate.mockResolvedValue({ id: "event-1" });
  mocks.issueToken.mockReturnValue("signed-handoff");
  mocks.checkoutHref.mockReturnValue("/checkout/vendor-1/offer-product-1?postPurchase=1");
});

describe("post-purchase upsell route", () => {
  it("records an accepted offer against the source order before returning a no-store signed handoff", async () => {
    const response = await POST(new Request("https://app.example.test/api/checkout/upsell", { method: "POST" }));

    expect(mocks.resolveOffer).toHaveBeenCalledWith(expect.anything(), {
      vendorId: "vendor-1",
      orderId: "order-1",
      kind: "upsell",
    });
    expect(mocks.eventCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        vendorId: "vendor-1",
        orderId: "order-1",
        dedupKey: "post_purchase_accept:upsell:offer-product-1",
        eventType: "post_purchase_accept",
      }),
    });
    expect(mocks.issueToken).toHaveBeenCalledWith(expect.objectContaining({
      grantId: "grant-1",
      orderId: "order-1",
      vendorId: "vendor-1",
      productId: "offer-product-1",
      amountCents: 900,
    }));
    expect(response.headers.get("cache-control")).toBe("no-store");
    await expect(response.json()).resolves.toEqual({
      checkoutHref: "/checkout/vendor-1/offer-product-1?postPurchase=1&postPurchaseToken=signed-handoff",
    });
  });

  it("does not issue a handoff when the browser grant has no paid source order", async () => {
    mocks.resolveGrant.mockResolvedValue({ ...await mocks.resolveGrant(), order: { status: "pending_payment", items: [] } });

    const response = await POST(new Request("https://app.example.test/api/checkout/upsell", { method: "POST" }));

    expect(response.status).toBe(404);
    expect(mocks.eventCreate).not.toHaveBeenCalled();
    expect(mocks.issueToken).not.toHaveBeenCalled();
  });
});
