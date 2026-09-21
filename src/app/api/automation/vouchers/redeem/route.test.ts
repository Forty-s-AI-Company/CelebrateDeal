import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ getDb: vi.fn(), findUnique: vi.fn(), checkRateLimit: vi.fn() }));
vi.mock("@/lib/db", () => ({ getDb: mocks.getDb }));
vi.mock("@/lib/rate-limit", () => ({ checkRateLimit: mocks.checkRateLimit }));

import { GET } from "./route";

describe("GET /api/automation/vouchers/redeem", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.checkRateLimit.mockResolvedValue(null);
    mocks.getDb.mockReturnValue({ automationVoucherGrant: { findUnique: mocks.findUnique } });
  });

  it("exchanges a valid bearer for a protected checkout cookie", async () => {
    mocks.findUnique.mockResolvedValue({
      vendorId: "vendor-1", productId: "product-1", usedOrderId: null,
      expiresAt: new Date(Date.now() + 60_000),
    });
    const response = await GET(new Request(`https://app.example.test/api/automation/vouchers/redeem?token=${"A".repeat(43)}`));
    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe("https://app.example.test/checkout/vendor-1/product-1");
    expect(response.headers.get("set-cookie")).toContain("celebratedeal_automation_voucher=");
    expect(response.headers.get("set-cookie")).toContain("HttpOnly");
    expect(response.headers.get("referrer-policy")).toBe("no-referrer");
  });

  it("rejects malformed and consumed voucher bearers", async () => {
    expect((await GET(new Request("https://app.example.test/api/automation/vouchers/redeem?token=short"))).status).toBe(400);
    mocks.findUnique.mockResolvedValue({
      vendorId: "vendor-1", productId: "product-1", usedOrderId: "order-1",
      expiresAt: new Date(Date.now() + 60_000),
    });
    expect((await GET(new Request(`https://app.example.test/api/automation/vouchers/redeem?token=${"B".repeat(43)}`))).status).toBe(410);
  });
});
