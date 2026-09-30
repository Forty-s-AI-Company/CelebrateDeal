import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getDb: vi.fn(), readTextBody: vi.fn(), normalize: vi.fn(),
  probeFindUnique: vi.fn(), probeUpdateMany: vi.fn(),
}));
vi.mock("@/lib/db", () => ({ getDb: mocks.getDb }));
vi.mock("@/lib/api-security", () => ({ readTextBody: mocks.readTextBody }));
vi.mock("@/lib/payment-providers/payuni", () => ({ normalizePayUniLiveProbeCallback: mocks.normalize }));
import { POST } from "@/app/api/webhooks/payuni-live-probe/route";

const url = "https://staging.example.test/api/webhooks/payuni-live-probe";

beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv("VERCEL_ENV", "preview");
  vi.stubEnv("PAYUNI_ENV", "production");
  vi.stubEnv("PAYMENT_PROVIDER", "payuni");
  vi.stubEnv("PAYUNI_LIVE_PROBE_ENABLED", "true");
  vi.stubEnv("PAYUNI_LIVE_PROBE_VENDOR_ID", "vendor-1");
  vi.stubEnv("PAYUNI_LIVE_PROBE_MERCHANT_ID", "TESTMER");
  vi.stubEnv("PAYUNI_MERCHANT_ID", "TESTMER");
  vi.stubEnv("PAYUNI_HASH_KEY", "12345678901234567890123456789012");
  vi.stubEnv("PAYUNI_HASH_IV", "1234567890123456");
  mocks.readTextBody.mockResolvedValue("signed-callback");
  mocks.normalize.mockReturnValue({ orderNumber: "pcABCDEFGHIJKLMNOPQRSTUV", status: "confirmed", providerTradeNo: "TRADE-2" });
  mocks.probeFindUnique.mockResolvedValue({
    id: "probe-1", vendorId: "vendor-1", attemptedAt: new Date(),
    status: "ambiguous", providerTradeNo: null,
  });
  mocks.probeUpdateMany.mockResolvedValue({ count: 1 });
  mocks.getDb.mockReturnValue({ payUniLiveProbe: { findUnique: mocks.probeFindUnique, updateMany: mocks.probeUpdateMany } });
});

afterEach(() => vi.unstubAllEnvs());

describe("POST /api/webhooks/payuni-live-probe", () => {
  it("rejects an unsigned callback before looking up a transaction", async () => {
    mocks.normalize.mockReturnValue(null);
    expect((await POST(new Request(url, { method: "POST" }))).status).toBe(401);
    expect(mocks.probeFindUnique).not.toHaveBeenCalled();
  });

  it("accepts only the already-attempted order and reconciles a signed success", async () => {
    const response = await POST(new Request(url, { method: "POST" }));
    expect(response.status).toBe(200);
    expect(mocks.probeUpdateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ id: "probe-1", vendorId: "vendor-1" }),
      data: expect.objectContaining({ status: "confirmed", providerTradeNo: "TRADE-2" }),
    }));
    mocks.probeFindUnique.mockResolvedValue({ id: "probe-1", vendorId: "vendor-1", attemptedAt: null });
    expect((await POST(new Request(url, { method: "POST" }))).status).toBe(404);
  });
});
