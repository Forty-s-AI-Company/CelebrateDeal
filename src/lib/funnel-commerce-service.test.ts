import { beforeEach, describe, expect, it, vi } from "vitest";
import { createFunnelFlow } from "@/lib/funnel-flow";
import { createFunnelStepPages } from "@/lib/funnel-step-pages";

const mocks = vi.hoisted(() => ({ landingPageFindFirst: vi.fn(), productFindMany: vi.fn() }));
vi.mock("@/lib/db", () => ({
  getDb: () => ({ landingPage: { findFirst: mocks.landingPageFindFirst }, product: { findMany: mocks.productFindMany } }),
}));

import { listFunnelCommerceProducts, resolvePublishedFunnelCheckout, validateFunnelCommerceBindings } from "@/lib/funnel-commerce-service";

const scope = { vendorId: "vendor-1", projectId: "project-1" };
function product(overrides: Record<string, unknown> = {}) {
  return {
    id: "product-1", vendorId: "vendor-1", name: "主商品", description: "說明", priceCents: 1200, currency: "TWD",
    fulfillmentType: "physical", inventory: 3, isActive: true, fulfillmentTypeConfirmed: true, checkoutUrl: null,
    customCheckoutFields: [], revision: 4, deliveryConfig: null, ...overrides,
  };
}
function commerceState(binding: Record<string, unknown> = { schemaVersion: 1, productId: "product-1", formMode: "single" }) {
  const flow = createFunnelFlow({ id: "funnel_1", name: "成交 Funnel", goal: "sell", domain: "sales" })!;
  const state = createFunnelStepPages(flow)!;
  state.pages.order_form!.commerce = binding as never;
  return state;
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.productFindMany.mockResolvedValue([product()]);
  mocks.landingPageFindFirst.mockResolvedValue({
    id: "page-1", vendorId: "vendor-1", projectId: "project-1", slug: "offer", publishedVersionId: "version-row",
    publishedVersion: { id: "version-row", vendorId: "vendor-1", pageId: "page-1", version: 2, content: commerceState() },
  });
});

describe("funnel commerce resolver", () => {
  it("只列出目前可結帳且已連結目前銷售專案的安全商品欄位", async () => {
    mocks.productFindMany.mockResolvedValue([product(), product({ id: "not-ready", inventory: 0 })]);

    await expect(listFunnelCommerceProducts(scope)).resolves.toEqual([{
      id: "product-1", name: "主商品", priceCents: 1200, currency: "TWD", fulfillmentType: "physical",
    }]);
    expect(mocks.productFindMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({
      vendorId: "vendor-1", salesProjectLinks: { some: { vendorId: "vendor-1", projectId: "project-1" } },
    }) }));
  });

  it("只從目前已發佈的 order_form step 解析結帳，不信任 URL locator", async () => {
    const resolved = await resolvePublishedFunnelCheckout({ slug: "offer", stepId: "order_form" });

    expect(resolved).toMatchObject({ vendorId: "vendor-1", projectId: "project-1", pageId: "page-1", version: 2, product: { id: "product-1", customCheckoutFields: [] } });
    await expect(resolvePublishedFunnelCheckout({ slug: "offer", stepId: "sales_page" })).resolves.toBeNull();
  });

  it("拒絕跨專案、過期與非實體主商品搭配實體加購", async () => {
    await expect(validateFunnelCommerceBindings(scope, commerceState())).resolves.toBeUndefined();
    mocks.productFindMany.mockResolvedValueOnce([]);
    await expect(validateFunnelCommerceBindings(scope, commerceState())).rejects.toThrow("funnel_commerce_product_unavailable");

    mocks.productFindMany.mockResolvedValueOnce([
      product({ id: "product-1", fulfillmentType: "digital", deliveryConfig: { status: "active", fulfillmentType: "digital" } }),
      product({ id: "bump-1", fulfillmentType: "physical" }),
    ]);
    await expect(validateFunnelCommerceBindings(scope, commerceState({ schemaVersion: 1, productId: "product-1", orderBumpProductId: "bump-1", formMode: "single" }))).rejects.toThrow("funnel_commerce_product_unavailable");
  });
});
