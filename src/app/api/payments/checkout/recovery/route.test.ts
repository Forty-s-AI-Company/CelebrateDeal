import { beforeEach, describe, expect, it, vi } from "vitest";

const findUnique = vi.fn();
vi.mock("@/lib/db", () => ({ getDb: () => ({ paymentTransaction: { findUnique } }) }));
vi.mock("@/lib/rate-limit", () => ({ checkRateLimit: vi.fn(async () => null) }));

import { POST } from "@/app/api/payments/checkout/recovery/route";

const key = "123e4567-e89b-42d3-a456-426614174000";

function request(productId = "product-1") {
  return new Request("https://app.example.test/api/payments/checkout/recovery", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      origin: "https://app.example.test",
      referer: "https://app.example.test/checkout/vendor-1/product-1?resume=1",
      "x-celebratedeal-client": "web",
    },
    body: JSON.stringify({ vendorId: "vendor-1", productId, idempotencyKey: key }),
  });
}

function pendingTransaction() {
  return {
    status: "pending",
    metadata: {
      productId: "product-1",
      checkoutSession: { provider: "payuni", formPayload: { TradeInfo: "must-not-leak" } },
    },
    primaryCommerceOrder: {
      id: "order-1",
      vendorId: "vendor-1",
      checkoutIdempotencyKey: key,
      totalAmountCents: 1200,
      currency: "TWD",
      buyerEncryptedEnvelope: "must-not-leak-buyer",
      items: [{
        productId: "product-1",
        productName: "原商品",
        productSlug: "original-product",
        fulfillmentType: "physical",
        unitPriceCents: 1200,
        lineIndex: 0,
        nonSensitiveSnapshot: {
          customCheckoutFields: [{ key: "engraving", label: "原刻字", type: "text", required: true }],
        },
      }],
    },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  findUnique.mockResolvedValue(pendingTransaction());
});

describe("checkout recovery snapshot", () => {
  it("returns original non-sensitive order terms after catalog edits", async () => {
    const response = await POST(request());
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    const body = await response.json();
    expect(body).toMatchObject({
      productName: "原商品",
      priceCents: 1200,
      customCheckoutFields: [{ key: "engraving", label: "原刻字" }],
    });
    expect(JSON.stringify(body)).not.toContain("must-not-leak");
    expect(findUnique).toHaveBeenCalledWith(expect.objectContaining({
      where: { vendorId_checkoutIdempotencyKey: { vendorId: "vendor-1", checkoutIdempotencyKey: key } },
    }));
  });

  it("does not expose a snapshot for another product or a finished transaction", async () => {
    const mismatch = await POST(request("product-2"));
    expect(mismatch.status).toBe(404);
    findUnique.mockResolvedValueOnce({ ...pendingTransaction(), status: "paid" });
    const finished = await POST(request());
    expect(finished.status).toBe(409);
  });

  it("fails closed when the saved field definition is unavailable", async () => {
    const transaction = pendingTransaction();
    transaction.primaryCommerceOrder.items[0].nonSensitiveSnapshot = { customCheckoutFields: "malformed" } as never;
    findUnique.mockResolvedValueOnce(transaction);
    const response = await POST(request());
    expect(response.status).toBe(503);
  });
});
