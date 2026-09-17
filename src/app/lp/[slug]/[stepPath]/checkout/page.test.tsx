import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ resolve: vi.fn(), notFound: vi.fn(() => { throw new Error("not-found"); }) }));
vi.mock("@/lib/funnel-commerce-service", () => ({ resolvePublishedFunnelCheckout: mocks.resolve }));
vi.mock("next/navigation", () => ({ notFound: mocks.notFound }));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: vi.fn(() => undefined) }) }));
vi.mock("@/lib/db", () => ({ getDb: () => ({}) }));
vi.mock("@/lib/live-interaction", () => ({ FLASH_VOUCHER_COOKIE: "celebratedeal_flash_voucher", resolveEligibleVoucherClaim: vi.fn(async () => null) }));

import FunnelCheckoutPage from "./page";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.resolve.mockResolvedValue({
    reference: { slug: "offer", stepId: "order_form" }, vendorId: "vendor-1", projectId: "project-1", pageId: "page-1", version: 2,
    binding: { schemaVersion: 1, productId: "product-1", formMode: "two_step", agreement: { label: "我同意購買條款" } },
    product: { id: "product-1", vendorId: "vendor-1", name: "成交工具箱", description: "可以直接使用", priceCents: 1200, currency: "TWD", fulfillmentType: "digital", inventory: 3, revision: 4, customCheckoutFields: [] },
    orderBump: { id: "bump-1", vendorId: "vendor-1", name: "加購模板", description: "加購說明", priceCents: 300, currency: "TWD", fulfillmentType: "digital", inventory: 3, revision: 2, customCheckoutFields: [] },
  });
});

describe("FunnelCheckoutPage", () => {
  it("only renders a freshly resolved published checkout with Funnel form props", async () => {
    const html = renderToStaticMarkup(await FunnelCheckoutPage({ params: Promise.resolve({ slug: "offer", stepPath: "order_form" }) }));
    expect(mocks.resolve).toHaveBeenCalledWith({ slug: "offer", stepId: "order_form" });
    expect(html).toContain("成交工具箱");
    expect(html).toContain("數位內容");
    expect(html).toContain("1. 聯絡資料");
    expect(html).toContain("我同意購買條款");
    expect(html).toContain("加購模板");
  });

  it("fails closed when the published binding cannot be resolved", async () => {
    mocks.resolve.mockResolvedValueOnce(null);
    await expect(FunnelCheckoutPage({ params: Promise.resolve({ slug: "offer", stepPath: "order_form" }) })).rejects.toThrow("not-found");
  });
});
