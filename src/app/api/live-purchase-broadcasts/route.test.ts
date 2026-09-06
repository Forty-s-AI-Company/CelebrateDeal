import { describe, expect, it, vi, beforeEach } from "vitest";

const mocks = vi.hoisted(() => ({
  hasActiveSession: vi.fn(),
  tokenFromRequest: vi.fn(),
  checkRateLimit: vi.fn(),
  findLiveProducts: vi.fn(),
  findOrders: vi.fn(),
}));

vi.mock("@/lib/live-quota-admission", () => ({
  hasActiveLiveViewerSession: mocks.hasActiveSession,
  liveViewerTokenFromRequest: mocks.tokenFromRequest,
}));

vi.mock("@/lib/rate-limit", () => ({
  checkRateLimit: mocks.checkRateLimit,
}));

vi.mock("@/lib/db", () => ({
  getDb: () => ({
    liveProduct: { findMany: mocks.findLiveProducts },
    commerceOrder: { findMany: mocks.findOrders },
  }),
}));

import { GET } from "./route";

describe("GET /api/live-purchase-broadcasts", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.tokenFromRequest.mockReturnValue("viewer-token-1");
    mocks.hasActiveSession.mockResolvedValue(true);
    mocks.checkRateLimit.mockResolvedValue(null);
    mocks.findLiveProducts.mockResolvedValue([{ productId: "prod-1" }]);
  });

  it("fails with 400 if vendorId or liveId is missing", async () => {
    const req = new Request("https://example.test/api/live-purchase-broadcasts");
    const res = await GET(req);
    expect(res.status).toBe(400);
  });

  it("fails with 401 if viewer is not admitted", async () => {
    mocks.hasActiveSession.mockResolvedValueOnce(false);
    const req = new Request("https://example.test/api/live-purchase-broadcasts?vendorId=v1&liveId=l1");
    const res = await GET(req);
    expect(res.status).toBe(401);
  });

  it("returns sanitized, masked purchase broadcasts for admitted viewers", async () => {
    const thirtySecAgo = new Date(Date.now() - 30_000);
    mocks.findOrders.mockResolvedValueOnce([
      {
        id: "order-1",
        buyerMaskedName: "王大明",
        paidAt: thirtySecAgo,
        items: [{ productName: "高轉化銷講課程" }],
      },
    ]);

    const req = new Request("https://example.test/api/live-purchase-broadcasts?vendorId=v1&liveId=l1");
    const res = await GET(req);
    expect(res.status).toBe(200);
    const data = (await res.json()) as { broadcasts: Array<{ id: string; buyerMaskedName: string; productName: string }> };
    expect(data.broadcasts).toHaveLength(1);
    expect(data.broadcasts[0]).toMatchObject({
      id: "order-1",
      buyerMaskedName: "王*明",
      productName: "高轉化銷講課程",
    });
  });
});
