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
  csrf: vi.fn(),
  transaction: vi.fn(),
}));

vi.mock("next/headers", () => ({ cookies: mocks.cookies }));
vi.mock("@/lib/api-security", () => ({ requireSameOriginRequest: mocks.boundary, readJsonBody: mocks.readJson }));
vi.mock("@/lib/rate-limit", () => ({ checkRateLimit: mocks.rateLimit }));
vi.mock("@/lib/db", () => ({ getDb: () => ({ $transaction: mocks.transaction }) }));
vi.mock("@/lib/csrf", () => ({ verifyCsrfToken: mocks.csrf }));
vi.mock("@/lib/buyer-support-access", () => ({ resolveBuyerSupportGrant: mocks.resolveGrant }));
vi.mock("@/lib/post-purchase-upsell-access", () => ({ resolvePaidOrderPostPurchaseOffer: mocks.resolveOffer }));
vi.mock("@/lib/post-purchase-upsell", () => ({
  issuePostPurchaseCheckoutToken: mocks.issueToken,
  postPurchaseCheckoutHref: mocks.checkoutHref,
}));

import { POST } from "./route";

function request(csrf: string | null = "synthetic-csrf") {
  return new Request("https://app.example.test/api/checkout/upsell", {
    method: "POST", headers: csrf ? { "x-csrf-token": csrf, "x-forwarded-for": "forged" } : {},
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.boundary.mockReturnValue(null);
  mocks.csrf.mockResolvedValue(true);
  mocks.transaction.mockImplementation(async callback => callback({ commerceOrderEvent: { createMany: mocks.eventCreate } }));
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
      originalPriceCents: 2000,
      discountCents: 100,
    },
  });
  mocks.eventCreate.mockResolvedValue({ id: "event-1" });
  mocks.issueToken.mockReturnValue("signed-handoff");
  mocks.checkoutHref.mockReturnValue("/checkout/vendor-1/offer-product-1?postPurchase=1");
});

describe("post-purchase upsell route", () => {
  it("records an accepted offer against the source order before returning a no-store signed handoff", async () => {
    const response = await POST(request());

    expect(mocks.resolveOffer).toHaveBeenCalledWith(expect.anything(), {
      vendorId: "vendor-1",
      orderId: "order-1",
      kind: "upsell",
    });
    expect(mocks.eventCreate).toHaveBeenCalledWith({
      data: expect.objectContaining({
        vendorId: "vendor-1",
        orderId: "order-1",
        dedupKey: expect.stringMatching(/^post_purchase_accept:[a-f0-9]{64}$/u),
        eventType: "post_purchase_accept",
      }),
      skipDuplicates: true,
    });
    expect(mocks.issueToken).toHaveBeenCalledWith(expect.objectContaining({
      grantId: "grant-1",
      orderId: "order-1",
      vendorId: "vendor-1",
      productId: "offer-product-1",
      amountCents: 900,
    }));
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    await expect(response.json()).resolves.toEqual({
      checkoutHref: "/checkout/vendor-1/offer-product-1?postPurchase=1&postPurchaseToken=signed-handoff",
    });
  });

  it("does not issue a handoff when the browser grant has no paid source order", async () => {
    mocks.resolveGrant.mockResolvedValue({ ...await mocks.resolveGrant(), order: { status: "pending_payment", items: [] } });

    const response = await POST(request());

    expect(response.status).toBe(404);
    expect(mocks.eventCreate).not.toHaveBeenCalled();
    expect(mocks.issueToken).not.toHaveBeenCalled();
  });

  it.each([null, "invalid"])("rejects absent or invalid CSRF before any grant lookup (%s)", async csrf => {
    mocks.csrf.mockResolvedValue(false);
    const response = await POST(request(csrf));
    expect(response.status).toBe(403);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(mocks.resolveGrant).not.toHaveBeenCalled();
    expect(mocks.eventCreate).not.toHaveBeenCalled();
  });

  it("rechecks a revoked grant inside the serializable transaction", async () => {
    mocks.resolveGrant.mockResolvedValueOnce(await mocks.resolveGrant()).mockResolvedValueOnce(null);
    const response = await POST(request());
    expect(response.status).toBe(404);
    expect(mocks.resolveOffer).not.toHaveBeenCalled();
    expect(mocks.issueToken).not.toHaveBeenCalled();
  });

  it("uses a verified grant bucket without caller-controlled proxy identity", async () => {
    await POST(request());
    const [boundedRequest, key, limit, duration] = mocks.rateLimit.mock.calls[0];
    expect(boundedRequest.headers.get("x-forwarded-for")).toBeNull();
    expect(boundedRequest.headers.get("cf-connecting-ip")).toBe("authenticated-buyer");
    expect(key).toMatch(/^post-purchase-upsell:[a-f0-9]{64}$/u);
    expect([limit, duration]).toEqual([12, 60000]);
  });

  it("deduplicates the same decision and retains a changed price separately", async () => {
    mocks.eventCreate.mockResolvedValue({ count: 0 });
    expect((await POST(request())).status).toBe(200);
    const firstKey = mocks.eventCreate.mock.calls[0][0].data.dedupKey;
    expect((await POST(request())).status).toBe(200);
    expect(mocks.eventCreate.mock.calls[1][0].data.dedupKey).toBe(firstKey);
    const offer = await mocks.resolveOffer();
    mocks.resolveOffer.mockResolvedValue({ ...offer, offer: { ...offer.offer, amountCents: 1000 } });
    expect((await POST(request())).status).toBe(200);
    expect(mocks.eventCreate.mock.calls[2][0].data.dedupKey).not.toBe(firstKey);
  });

  it("retries only serialization conflicts, with the same verified rate bucket", async () => {
    mocks.transaction.mockRejectedValueOnce({ code: "P2034" });
    const response = await POST(request());
    expect(response.status).toBe(200);
    expect(mocks.transaction).toHaveBeenCalledTimes(2);
    expect(mocks.rateLimit).toHaveBeenCalledTimes(1);
    expect(mocks.eventCreate).toHaveBeenCalledTimes(1);
  });

  it("bounds exhausted serialization retries and does not issue a token", async () => {
    mocks.transaction.mockRejectedValue({ code: "P2034" });
    const response = await POST(request());
    expect(response.status).toBe(503);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(mocks.transaction).toHaveBeenCalledTimes(3);
    expect(mocks.issueToken).not.toHaveBeenCalled();
  });

  it.each([["upsell", "downsell"], ["downsell", "complete"]])("records %s decline without issuing a checkout token", async (kind, next) => {
    mocks.readJson.mockResolvedValue({ grantId: "grant-1", decision: "decline", kind });
    const response = await POST(request());
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ next });
    expect(mocks.eventCreate).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ eventType: "post_purchase_decline" }), skipDuplicates: true,
    }));
    expect(mocks.issueToken).not.toHaveBeenCalled();
  });
});
