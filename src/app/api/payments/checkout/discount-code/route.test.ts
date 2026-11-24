import { beforeEach, describe, expect, it, vi } from "vitest";

const db = {
  product: { findFirst: vi.fn() },
  discountCode: { findUnique: vi.fn() },
  discountCodeLookupThrottle: { findUnique: vi.fn(), upsert: vi.fn(), deleteMany: vi.fn() },
};
vi.mock("@/lib/db", () => ({ getDb: () => db }));
const rateLimit = vi.hoisted(() => vi.fn(async (): Promise<Response | null> => null));
vi.mock("@/lib/rate-limit", () => ({ checkRateLimit: rateLimit }));
const vendorAvailable = vi.hoisted(() => vi.fn(async () => true));
vi.mock("@/lib/vendor-suspension-state", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/lib/vendor-suspension-state")>(),
  isVendorAvailableForPublic: vendorAvailable,
}));

import { POST } from "@/app/api/payments/checkout/discount-code/route";

const vendor = { id: "vendor-a", enabledFeatureModules: [], betaFeatureGrants: [], suspendedAt: null };
const product = { id: "product-a", priceCents: 100_000, currency: "TWD", commerceDomain: "merchant", fulfillmentType: "digital", vendor };
const codeRow = {
  id: "code-a", vendorId: "vendor-a", code: "Save100", normalizedCode: "SAVE100", discountType: "fixed_amount", discountValue: 10_000,
  currency: "TWD", appliesToAllProducts: true, startsAt: null, endsAt: null, maxRedemptions: null, maxRedemptionsPerBuyer: null,
  minSubtotalCents: null, isActive: true, redemptionCount: 0, revision: 1, products: [],
};

function request(body: Record<string, unknown>, origin: string | null = "https://app.example.test") {
  return new Request("https://app.example.test/api/payments/checkout/discount-code", {
    method: "POST",
    headers: { "content-type": "application/json", "x-celebratedeal-client": "web", ...(origin ? { origin } : {}) },
    body: JSON.stringify({ vendorId: "vendor-a", productId: "product-a", discountCode: "save100", ...body }),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  rateLimit.mockResolvedValue(null);
  vendorAvailable.mockResolvedValue(true);
  db.product.findFirst.mockResolvedValue(product);
  db.discountCode.findUnique.mockResolvedValue(codeRow);
  db.discountCodeLookupThrottle.findUnique.mockResolvedValue(null);
});

describe("POST /api/payments/checkout/discount-code", () => {
  it("previews the server-side discount for the vendor's own code, ignoring case", async () => {
    const response = await POST(request({}));
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(await response.json()).toEqual({
      ok: true, code: "Save100", discountAmountCents: 10_000, subtotalAmountCents: 100_000, totalAmountCents: 90_000, currency: "TWD",
    });
    expect(db.product.findFirst).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ id: "product-a", vendorId: "vendor-a" }) }));
    expect(db.discountCode.findUnique).toHaveBeenCalledWith(expect.objectContaining({
      where: { vendorId_normalizedCode: { vendorId: "vendor-a", normalizedCode: "SAVE100" } },
    }));
  });

  it("answers another vendor's code exactly like an unknown code", async () => {
    db.discountCode.findUnique.mockResolvedValueOnce(null);
    const unknown = await POST(request({ discountCode: "NOPE00" }));
    db.discountCode.findUnique.mockResolvedValueOnce({ ...codeRow, vendorId: "vendor-b" });
    const foreign = await POST(request({}));
    expect(unknown.status).toBe(409);
    expect(foreign.status).toBe(409);
    expect(await foreign.json()).toEqual(await unknown.json());
  });

  it("does not look up any code for another vendor's product", async () => {
    db.product.findFirst.mockResolvedValueOnce(null);
    const response = await POST(request({ vendorId: "vendor-b" }));
    expect(response.status).toBe(404);
    expect(db.discountCode.findUnique).not.toHaveBeenCalled();
  });

  it("counts a same-vendor order bump toward the minimum spend", async () => {
    db.discountCode.findUnique.mockResolvedValue({ ...codeRow, minSubtotalCents: 150_000 });
    db.product.findFirst.mockResolvedValueOnce(product).mockResolvedValueOnce({ priceCents: 60_000 });
    const response = await POST(request({ orderBumpProductId: "bump-a" }));
    expect(response.status).toBe(200);
    expect(db.product.findFirst).toHaveBeenLastCalledWith(expect.objectContaining({ where: expect.objectContaining({ id: "bump-a", vendorId: "vendor-a", currency: "TWD" }) }));
    db.product.findFirst.mockResolvedValueOnce(product);
    const withoutBump = await POST(request({}));
    expect(await withoutBump.json()).toMatchObject({ code: "DISCOUNT_CODE_MIN_SUBTOTAL" });
  });

  it("rejects cross-origin, malformed and rate-limited requests before any lookup", async () => {
    expect((await POST(request({}, "https://evil.example.test"))).status).toBe(403);
    expect((await POST(request({ extra: true }))).status).toBe(400);
    rateLimit.mockResolvedValueOnce(new Response(null, { status: 429 }));
    expect((await POST(request({}))).status).toBe(429);
    expect(db.discountCode.findUnique).not.toHaveBeenCalled();
  });

  it("counts a failed lookup against the vendor + product, not the caller's IP (review m-1)", async () => {
    db.discountCode.findUnique.mockResolvedValueOnce(null);
    await POST(request({ discountCode: "GUESS1" }));
    expect(db.discountCodeLookupThrottle.upsert).toHaveBeenCalledWith(expect.objectContaining({
      create: expect.objectContaining({ vendorId: "vendor-a", productId: "product-a", failureCount: 1 }),
      update: { failureCount: { increment: 1 } },
    }));
    db.discountCodeLookupThrottle.upsert.mockClear();
    await POST(request({}));
    expect(db.discountCodeLookupThrottle.upsert).not.toHaveBeenCalled();
  });

  it("answers 429 for every code, valid or not, once the product's window is full", async () => {
    db.discountCodeLookupThrottle.findUnique.mockResolvedValue({ failureCount: 30 });
    const response = await POST(request({}));
    expect(response.status).toBe(429);
    expect(await response.json()).toMatchObject({ code: "DISCOUNT_CODE_TRY_LATER" });
    expect(Number(response.headers.get("retry-after"))).toBeGreaterThan(0);
    expect(db.discountCode.findUnique).not.toHaveBeenCalled();
  });

  it("treats a suspended vendor as unavailable", async () => {
    vendorAvailable.mockResolvedValueOnce(false);
    expect((await POST(request({}))).status).toBe(404);
    expect(db.discountCode.findUnique).not.toHaveBeenCalled();
  });
});
