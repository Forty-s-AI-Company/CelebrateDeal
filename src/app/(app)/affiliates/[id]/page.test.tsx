import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireVendorManager: vi.fn(),
  affiliateFindFirst: vi.fn(),
  notFound: vi.fn(() => { throw new Error("not-found"); }),
}));

vi.mock("@/lib/auth", () => ({ requireVendorManager: mocks.requireVendorManager }));
vi.mock("@/lib/db", () => ({ getDb: () => ({ affiliate: { findFirst: mocks.affiliateFindFirst } }) }));
vi.mock("next/navigation", () => ({ notFound: mocks.notFound }));

import AffiliateDetailPage from "./page";

const affiliate = {
  id: "affiliate-1",
  vendorId: "vendor-1",
  name: "合作夥伴",
  code: "PARTNER1",
  source: "社群",
  isActive: true,
  commissionRateBps: 1250,
  contactEmail: "partner@example.invalid",
  clicks: [
    { id: "click-1", landingPath: "/live/demo", createdAt: new Date("2026-08-01T00:00:00.000Z"), convertedAt: new Date("2026-08-02T00:00:00.000Z") },
    { id: "click-2", landingPath: "/live/demo", createdAt: new Date("2026-08-03T00:00:00.000Z"), convertedAt: null },
  ],
  commissions: [
    { id: "commission-1", orderNumber: "ORDER-SYNTHETIC", attributedAt: new Date("2026-08-02T00:00:00.000Z"), orderAmountCents: 10000, commissionAmountCents: 1250, status: "approved" },
  ],
  payouts: [],
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireVendorManager.mockResolvedValue({ id: "vendor-1" });
  mocks.affiliateFindFirst.mockResolvedValue(affiliate);
});

describe("/affiliates/[id] route", () => {
  it("scopes the partner detail and renders conversion, commission and source states", async () => {
    const html = renderToStaticMarkup(await AffiliateDetailPage({ params: Promise.resolve({ id: affiliate.id }) }));

    expect(mocks.requireVendorManager).toHaveBeenCalledExactlyOnceWith();
    expect(mocks.affiliateFindFirst).toHaveBeenCalledWith({
      where: { id: affiliate.id, vendorId: "vendor-1" },
      include: {
        clicks: { orderBy: { createdAt: "desc" }, take: 20 },
        commissions: { orderBy: { attributedAt: "desc" }, take: 20 },
        payouts: { orderBy: { createdAt: "desc" }, take: 10 },
      },
    });
    expect(html).toContain("合作夥伴");
    expect(html).toContain("50%");
    expect(html).toContain("累計佣金");
    expect(html).toContain("$13");
    expect(html).toContain("ORDER-SYNTHETIC");
    expect(html).toContain("已轉換");
    expect(html).toContain("未轉換");
  });

  it("fails closed through notFound for a missing or cross-tenant partner", async () => {
    mocks.affiliateFindFirst.mockResolvedValue(null);

    await expect(AffiliateDetailPage({ params: Promise.resolve({ id: "other-affiliate" }) })).rejects.toThrow("not-found");
    expect(mocks.notFound).toHaveBeenCalledOnce();
  });
});
