import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const db = {
  product: { findFirst: vi.fn() },
  discountCode: { findUnique: vi.fn() },
  // Tagged-template call: (strings, vendorId, scopeKey, windowStart, limit).
  $queryRaw: vi.fn(),
  discountCodeLookupThrottle: { updateMany: vi.fn(), deleteMany: vi.fn() },
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
import { DISCOUNT_CODE_LOOKUP_LIMITS } from "@/lib/discount-code-lookup-throttle";
import { verifyDiscountCodePreviewToken } from "@/lib/discount-code-preview-token";

const vendor = { id: "vendor-a", enabledFeatureModules: [], betaFeatureGrants: [], suspendedAt: null };
const product = { id: "product-a", priceCents: 100_000, currency: "TWD", commerceDomain: "merchant", fulfillmentType: "digital", vendor };
const codeRow = {
  id: "code-a", vendorId: "vendor-a", code: "Save100", normalizedCode: "SAVE100", discountType: "fixed_amount", discountValue: 10_000,
  currency: "TWD", appliesToAllProducts: true, startsAt: null, endsAt: null, maxRedemptions: null, maxRedemptionsPerBuyer: null,
  minSubtotalCents: null, isActive: true, redemptionCount: 0, revision: 4, products: [],
};

function request(body: Record<string, unknown>, origin: string | null = "https://app.example.test") {
  return new Request("https://app.example.test/api/payments/checkout/discount-code", {
    method: "POST",
    headers: { "content-type": "application/json", "x-celebratedeal-client": "web", ...(origin ? { origin } : {}) },
    body: JSON.stringify({ vendorId: "vendor-a", productId: "product-a", discountCode: "save100", ...body }),
  });
}

/** The scope keys and limits each debit asked for, in call order. */
function debits() {
  return db.$queryRaw.mock.calls.map((call) => ({ scopeKey: call[2], limit: call[4] }));
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("CSRF_SECRET", "discount-code-preview-route-test-secret-over-32-bytes");
  rateLimit.mockResolvedValue(null);
  vendorAvailable.mockResolvedValue(true);
  db.product.findFirst.mockResolvedValue(product);
  db.discountCode.findUnique.mockResolvedValue(codeRow);
  db.$queryRaw.mockResolvedValue([{ failureCount: 2 }]);
  db.discountCodeLookupThrottle.updateMany.mockResolvedValue({ count: 1 });
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("POST /api/payments/checkout/discount-code", () => {
  it("previews the server-side discount for the vendor's own code, ignoring case, with a scoped token", async () => {
    const response = await POST(request({}));
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    const body = await response.json();
    expect(body).toEqual({
      ok: true, code: "Save100", discountAmountCents: 10_000, subtotalAmountCents: 100_000, totalAmountCents: 90_000, currency: "TWD",
      token: expect.stringMatching(/^dcp1\./u),
    });
    const now = new Date();
    expect(verifyDiscountCodePreviewToken(body.token, { vendorId: "vendor-a", productId: "product-a", normalizedCode: "SAVE100", now })).toEqual({ revision: 4 });
    expect(verifyDiscountCodePreviewToken(body.token, { vendorId: "vendor-b", productId: "product-a", normalizedCode: "SAVE100", now })).toBeNull();
    expect(verifyDiscountCodePreviewToken(body.token, { vendorId: "vendor-a", productId: "product-b", normalizedCode: "SAVE100", now })).toBeNull();
    expect(verifyDiscountCodePreviewToken(body.token, { vendorId: "vendor-a", productId: "product-a", normalizedCode: "OTHER1", now })).toBeNull();
    expect(verifyDiscountCodePreviewToken(body.token, { vendorId: "vendor-a", productId: "product-a", normalizedCode: "SAVE100", now: new Date(now.getTime() + 31 * 60_000) })).toBeNull();
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
    expect(db.$queryRaw).not.toHaveBeenCalled();
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

  it("rejects cross-origin, malformed and per-IP rate-limited requests before any lookup", async () => {
    expect((await POST(request({}, "https://evil.example.test"))).status).toBe(403);
    expect((await POST(request({ extra: true }))).status).toBe(400);
    rateLimit.mockResolvedValueOnce(new Response(null, { status: 429 }));
    expect((await POST(request({}))).status).toBe(429);
    expect(rateLimit).toHaveBeenLastCalledWith(expect.any(Request), "checkout-discount-code", 10, 60_000);
    expect(db.discountCode.findUnique).not.toHaveBeenCalled();
  });

  it("debits the product and vendor counters before the lookup and keeps the debit only for a code that does not exist", async () => {
    db.discountCode.findUnique.mockResolvedValueOnce(null);
    await POST(request({ discountCode: "GUESS1" }));
    expect(debits()).toEqual([
      { scopeKey: "product:product-a", limit: DISCOUNT_CODE_LOOKUP_LIMITS.product },
      { scopeKey: "vendor", limit: DISCOUNT_CODE_LOOKUP_LIMITS.vendor },
    ]);
    expect(db.discountCodeLookupThrottle.updateMany).not.toHaveBeenCalled();
  });

  it.each([
    ["a hit", codeRow],
    ["a used-up code", { ...codeRow, maxRedemptions: 1, redemptionCount: 1 }],
    ["a code below its minimum spend", { ...codeRow, minSubtotalCents: 500_000 }],
  ])("refunds both debits for %s (the code exists; review MJ-1)", async (_label, row) => {
    db.discountCode.findUnique.mockResolvedValueOnce(row);
    await POST(request({}));
    expect(db.discountCodeLookupThrottle.updateMany.mock.calls.map((call) => call[0].where.scopeKey)).toEqual(["product:product-a", "vendor"]);
  });

  it("answers 429 for every code, valid or not, once the product counter is full", async () => {
    db.$queryRaw.mockResolvedValueOnce([]);
    const response = await POST(request({}));
    expect(response.status).toBe(429);
    expect(await response.json()).toMatchObject({ code: "DISCOUNT_CODE_TRY_LATER" });
    expect(Number(response.headers.get("retry-after"))).toBeGreaterThan(0);
    expect(db.discountCode.findUnique).not.toHaveBeenCalled();
  });

  it("answers 429 when the vendor-wide counter is full and gives the product debit back (review MN-2)", async () => {
    db.$queryRaw.mockResolvedValueOnce([{ failureCount: 5 }]).mockResolvedValueOnce([]);
    const response = await POST(request({}));
    expect(response.status).toBe(429);
    expect(db.discountCode.findUnique).not.toHaveBeenCalled();
    expect(db.discountCodeLookupThrottle.updateMany.mock.calls.map((call) => call[0].where.scopeKey)).toEqual(["product:product-a"]);
  });

  it("refuses the lookup (429) and logs when the counter cannot be written (review NT-2)", async () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => undefined);
    db.$queryRaw.mockRejectedValueOnce(new Error("synthetic database outage"));
    const response = await POST(request({}));
    expect(response.status).toBe(429);
    expect(db.discountCode.findUnique).not.toHaveBeenCalled();
    expect(logged).toHaveBeenCalledWith("discount_code_throttle_failed", { operation: "debit", errorName: "Error" });
  });

  it("treats a suspended vendor as unavailable", async () => {
    vendorAvailable.mockResolvedValueOnce(false);
    expect((await POST(request({}))).status).toBe(404);
    expect(db.discountCode.findUnique).not.toHaveBeenCalled();
  });
});
