import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireVendorManager: vi.fn(),
  affiliateFindFirst: vi.fn(),
  notFound: vi.fn(() => { throw new Error("not-found"); }),
}));

vi.mock("@/lib/auth", () => ({ requireVendorManager: mocks.requireVendorManager }));
vi.mock("@/lib/db", () => ({ getDb: () => ({ affiliate: { findFirst: mocks.affiliateFindFirst } }) }));
vi.mock("@/components/affiliate-form", () => ({ AffiliateForm: ({ affiliate }: { affiliate?: { id?: string } }) => <div data-testid="affiliate-form">{affiliate?.id ?? "new"}</div> }));
vi.mock("next/navigation", () => ({ notFound: mocks.notFound }));

import EditAffiliatePage from "./page";

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
    { id: "click-1", landingPath: "/live/demo", createdAt: new Date("2026-08-01T00:00:00.000Z"), convertedAt: null },
  ],
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireVendorManager.mockResolvedValue({ id: "vendor-1" });
  mocks.affiliateFindFirst.mockResolvedValue(affiliate);
});

describe("/affiliates/[id]/edit route", () => {
  it("loads only the current vendor partner and renders source history", async () => {
    const html = renderToStaticMarkup(await EditAffiliatePage({ params: Promise.resolve({ id: affiliate.id }) }));

    expect(mocks.affiliateFindFirst).toHaveBeenCalledWith({
      where: { id: affiliate.id, vendorId: "vendor-1" },
      include: { clicks: { orderBy: { createdAt: "desc" }, take: 10 } },
    });
    expect(html).toContain("編輯聯盟夥伴");
    expect(html).toContain("後續訂單適用的佣金比例");
    expect(html).toContain('data-testid="affiliate-form">affiliate-1');
    expect(html).toContain("最近來源事件");
    expect(html).toContain("/live/demo");
    expect(html).toContain("未轉換");
  });

  it("fails closed through notFound for a missing or cross-tenant partner", async () => {
    mocks.affiliateFindFirst.mockResolvedValue(null);

    await expect(EditAffiliatePage({ params: Promise.resolve({ id: "other-affiliate" }) })).rejects.toThrow("not-found");
    expect(mocks.notFound).toHaveBeenCalledOnce();
  });
});
