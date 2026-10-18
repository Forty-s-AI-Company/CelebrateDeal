import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const db = {
  product: { findFirst: vi.fn() },
  paymentTransaction: { findUnique: vi.fn() },
};
vi.mock("@/lib/db", () => ({ getDb: () => db }));
vi.mock("@/lib/rate-limit", () => ({ checkRateLimit: vi.fn(async () => null) }));
const postPurchase = vi.hoisted(() => ({ quote: vi.fn(), replay: vi.fn() }));
vi.mock("@/lib/post-purchase-credit", async importOriginal => {
  const original = await importOriginal<typeof import("@/lib/post-purchase-credit")>();
  return { ...original, resolvePostPurchaseCreditQuote: postPurchase.quote, assertPostPurchaseCreditReplay: postPurchase.replay };
});

import { POST } from "@/app/api/payments/checkout/admission/route";
import { postPurchaseCreditQuoteHash, PostPurchaseUnavailableError } from "@/lib/post-purchase-credit";
const quote = { vendorId: "vendor-1", sourceOrderId: "source-order", buyerGrantId: "source-grant",
  sourceProductId: "source-product", targetProductId: "product-1", kind: "upsell" as const, currency: "TWD",
  creditAmountCents: 700, offerDiscountCents: 100, targetPriceCents: 1200, checkoutAmountCents: 400 };
const upgradeToken = `ppu1.synthetic.${"b".repeat(43)}`;
import {
  CHECKOUT_ADMISSION_COOKIE,
  verifyCheckoutAdmission,
} from "@/lib/checkout-admission";

function request(body: Record<string, unknown> = {}, cookie?: string, origin: string | null = "https://app.example.test") {
  return new Request("https://app.example.test/api/payments/checkout/admission", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-celebratedeal-client": "web",
      ...(origin ? { origin } : {}),
      ...(cookie ? { cookie } : {}),
    },
    body: JSON.stringify({ vendorId: "vendor-1", productId: "product-1", ...body }),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  postPurchase.quote.mockResolvedValue(quote);
  postPurchase.replay.mockResolvedValue(quote);
  vi.stubEnv("CSRF_SECRET", "checkout-admission-route-test-secret-longer-than-32-bytes");
  db.product.findFirst.mockResolvedValue({ id: "product-1", vendorId: "vendor-1", revision: 9 });
  db.paymentTransaction.findUnique.mockResolvedValue(null);
});

afterEach(() => vi.unstubAllEnvs());

describe("POST /api/payments/checkout/admission", () => {
  it("signs the current buyer-authorized upgrade quote rather than catalogue full price", async () => {
    const sessionToken = "q".repeat(43);
    const response = await POST(request({ postPurchaseToken: upgradeToken }, `${CHECKOUT_ADMISSION_COOKIE}=${sessionToken}`));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.offer).toEqual({ priceCents: 400, currency: "TWD", hash: postPurchaseCreditQuoteHash(quote) });
    expect(verifyCheckoutAdmission({ admissionToken: body.admissionToken, sessionToken })).toMatchObject({
      vendorId: "vendor-1", productId: "product-1", productRevision: 9, offerHash: postPurchaseCreditQuoteHash(quote),
    });
  });
  it("does not issue admission for a revoked or refunded source", async () => {
    postPurchase.quote.mockRejectedValueOnce(new PostPurchaseUnavailableError());
    const response = await POST(request({ postPurchaseToken: upgradeToken }));
    expect(response.status).toBe(409);
    expect(response.cookies.get(CHECKOUT_ADMISSION_COOKIE)).toBeUndefined();
    expect(db.product.findFirst).not.toHaveBeenCalled();
  });
  it("rejects combining an upgrade with explicit flash-sale intent", async () => {
    const response = await POST(request({ postPurchaseToken: upgradeToken, flashSaleRunId: "sale-run" }));
    expect(response.status).toBe(409);
    expect(postPurchase.quote).not.toHaveBeenCalled();
    expect(response.cookies.get(CHECKOUT_ADMISSION_COOKIE)).toBeUndefined();
  });
  it("rejects a sale intent with no claim instead of issuing a full-price admission", async () => {
    const response = await POST(request({ flashSaleRunId: "sale-run" }));
    expect(response.status).toBe(409);
    expect(await response.json()).toMatchObject({ code: "FLASH_SALE_UNAVAILABLE" });
    expect(response.cookies.get(CHECKOUT_ADMISSION_COOKIE)).toBeUndefined();
  });

  it("rejects missing or cross-origin requests before product access", async () => {
    for (const origin of [null, "https://attacker.example.test"]) {
      const response = await POST(request({}, undefined, origin));
      expect(response.status).toBe(403);
    }
    expect(db.product.findFirst).not.toHaveBeenCalled();
  });

  it("fails closed for malformed or unavailable products", async () => {
    const malformed = await POST(request({ productId: "" }));
    expect(malformed.status).toBe(400);

    db.product.findFirst.mockResolvedValueOnce(null);
    const unavailable = await POST(request());
    expect(unavailable.status).toBe(404);
    expect(db.product.findFirst).toHaveBeenCalledWith({
      where: {
        id: "product-1",
        vendorId: "vendor-1",
        isActive: true,
        fulfillmentTypeConfirmed: true,
        checkoutUrl: null,
        priceCents: { gt: 0 },
        inventory: { gte: 1 },
      },
      select: { id: true, vendorId: true, revision: true },
    });
  });

  it("issues a no-store admission bound to the exact product revision and HttpOnly session", async () => {
    const response = await POST(request());

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    const setCookie = response.headers.get("set-cookie") ?? "";
    expect(setCookie).toContain(`${CHECKOUT_ADMISSION_COOKIE}=`);
    expect(setCookie).toContain("HttpOnly");
    expect(setCookie).toContain("SameSite=strict");
    expect(setCookie).toContain("Path=/api/payments/checkout");
    const sessionToken = setCookie.match(new RegExp(`${CHECKOUT_ADMISSION_COOKIE}=([A-Za-z0-9_-]{43})`))?.[1] ?? null;
    const body = await response.json();
    expect(body).toMatchObject({
      admissionToken: expect.stringMatching(/^ca1\./u),
      idempotencyKey: expect.stringMatching(/^[0-9a-f-]{36}$/u),
      expiresAt: expect.any(String),
    });
    expect(verifyCheckoutAdmission({
      admissionToken: body.admissionToken,
      sessionToken,
    })).toMatchObject({
      vendorId: "vendor-1",
      productId: "product-1",
      productRevision: 9,
      idempotencyKey: body.idempotencyKey,
    });
  });

  it("reuses the valid HttpOnly session while issuing a distinct bounded checkout identity", async () => {
    const sessionToken = "q".repeat(43);
    const first = await POST(request({}, `${CHECKOUT_ADMISSION_COOKIE}=${sessionToken}`));
    const second = await POST(request({}, `${CHECKOUT_ADMISSION_COOKIE}=${sessionToken}`));
    const firstBody = await first.json();
    const secondBody = await second.json();

    expect(first.headers.get("set-cookie")).toContain(`${CHECKOUT_ADMISSION_COOKIE}=${sessionToken}`);
    expect(second.headers.get("set-cookie")).toContain(`${CHECKOUT_ADMISSION_COOKIE}=${sessionToken}`);
    expect(firstBody.idempotencyKey).not.toBe(secondBody.idempotencyKey);
  });

  it("reissues the same pending checkout identity after response loss even when its reservation consumed inventory", async () => {
    const idempotencyKey = "11111111-1111-4111-8111-111111111111";
    db.paymentTransaction.findUnique.mockResolvedValueOnce({
      status: "pending",
      metadata: { productId: "product-1" },
    });

    const response = await POST(request({ idempotencyKey }));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.idempotencyKey).toBe(idempotencyKey);
    expect(db.paymentTransaction.findUnique).toHaveBeenCalledWith({
      where: {
        vendorId_checkoutIdempotencyKey: {
          vendorId: "vendor-1",
          checkoutIdempotencyKey: idempotencyKey,
        },
      },
      select: { status: true, metadata: true, primaryCommerceOrder: { select: { id: true } } },
    });
    expect(db.product.findFirst).toHaveBeenCalledWith({
      where: { id: "product-1", vendorId: "vendor-1" },
      select: { id: true, vendorId: true, revision: true },
    });
  });

  it("rejects a finished or cross-product persisted identity before issuing another admission", async () => {
    const idempotencyKey = "22222222-2222-4222-8222-222222222222";
    db.paymentTransaction.findUnique.mockResolvedValueOnce({
      status: "paid",
      metadata: { productId: "product-1" },
    });

    const response = await POST(request({ idempotencyKey }));

    expect(response.status).toBe(409);
    expect(db.product.findFirst).not.toHaveBeenCalled();
  });
});
