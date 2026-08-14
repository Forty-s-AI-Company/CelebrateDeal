import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const db = {
  product: { findFirst: vi.fn() },
  paymentTransaction: { findUnique: vi.fn() },
};
vi.mock("@/lib/db", () => ({ getDb: () => db }));
vi.mock("@/lib/rate-limit", () => ({ checkRateLimit: vi.fn(async () => null) }));

import { POST } from "@/app/api/payments/checkout/admission/route";
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
  vi.stubEnv("CSRF_SECRET", "checkout-admission-route-test-secret-longer-than-32-bytes");
  db.product.findFirst.mockResolvedValue({ id: "product-1", vendorId: "vendor-1", revision: 9 });
  db.paymentTransaction.findUnique.mockResolvedValue(null);
});

afterEach(() => vi.unstubAllEnvs());

describe("POST /api/payments/checkout/admission", () => {
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
      select: { status: true, metadata: true },
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
