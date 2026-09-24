import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ resolve: vi.fn(), notFound: vi.fn(() => { throw new Error("not-found"); }) }));
vi.mock("@/lib/funnel-commerce-service", () => ({ resolvePublishedFunnelCheckout: mocks.resolve }));
vi.mock("next/navigation", () => ({ notFound: mocks.notFound }));
vi.mock("@/lib/db", () => ({ getDb: vi.fn(() => ({})) }));

import FunnelCheckoutPage from "./page";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.resolve.mockResolvedValue({
    reference: { slug: "offer", stepId: "order_form" }, vendorId: "vendor-1", projectId: "project-1", pageId: "page-1", version: 2,
    binding: { schemaVersion: 1, productId: "product-1", formMode: "single", agreement: { label: "我同意購買條款" } },
    product: { id: "product-1", vendorId: "vendor-1", name: "成交工具箱", description: "可以直接使用", priceCents: 1200, currency: "TWD", fulfillmentType: "digital", inventory: 3, revision: 4, customCheckoutFields: [] },
  });
});

describe("FunnelCheckoutPage", () => {
  it("re-resolves the published product and passes the version contract", async () => {
    const html = renderToStaticMarkup(await FunnelCheckoutPage({ params: Promise.resolve({ slug: "offer", stepPath: "order_form" }) }));
    expect(mocks.resolve).toHaveBeenCalledWith({ slug: "offer", stepId: "order_form" }, expect.anything(), { allowReservedInventory: true });
    expect(html).toContain("正在檢查是否有可恢復的訂單");
    expect(html).not.toContain("成交工具箱");
  });

  it("fails closed when the published binding cannot be resolved", async () => {
    mocks.resolve.mockResolvedValueOnce(null);
    await expect(FunnelCheckoutPage({ params: Promise.resolve({ slug: "offer", stepPath: "order_form" }) })).rejects.toThrow("not-found");
  });

  it("shows only the recovery entry for a previously started unpublished Funnel", async () => {
    mocks.resolve.mockResolvedValueOnce(null);
    const html = renderToStaticMarkup(await FunnelCheckoutPage({
      params: Promise.resolve({ slug: "offer", stepPath: "order_form" }),
      searchParams: Promise.resolve({ resume: "1" }),
    }));
    expect(html).toContain("恢復待付款訂單");
    expect(html).not.toContain('name="buyerEmail"');
  });
});
