import { beforeEach, describe, expect, it, vi } from "vitest";
import { createFunnelFlow } from "@/lib/funnel-flow";
import { createFunnelStepPages } from "@/lib/funnel-step-pages";

const mocks = vi.hoisted(() => ({ productFindMany: vi.fn(), landingPageFindMany: vi.fn() }));
vi.mock("@/lib/db", () => ({ getDb: () => ({ product: { findMany: mocks.productFindMany }, landingPage: { findMany: mocks.landingPageFindMany } }) }));

import { listFunnelCommerceProducts, publicCommerceViewForDocument, publicFunnelCommerceViews, resolvePublishedFunnelCheckout, validateFunnelCommerceBindings } from "./funnel-commerce-service";

const scope = { vendorId: "vendor-1", projectId: "project-1" };
function product(overrides: Record<string, unknown> = {}) {
  return {
    id: "product-1", vendorId: "vendor-1", name: "主商品", priceCents: 1200, currency: "TWD",
    fulfillmentType: "physical", inventory: 3, isActive: true, fulfillmentTypeConfirmed: true, checkoutUrl: null,
    deliveryConfig: null, ...overrides,
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
});

describe("funnel commerce catalog boundary", () => {
  it("只列出目前可結帳且已連結目前銷售專案的安全商品欄位", async () => {
    mocks.productFindMany.mockResolvedValue([product(), product({ id: "not-ready", inventory: 0 })]);
    await expect(listFunnelCommerceProducts(scope)).resolves.toEqual([{
      id: "product-1", name: "主商品", priceCents: 1200, currency: "TWD", fulfillmentType: "physical",
    }]);
    expect(mocks.productFindMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({
      vendorId: "vendor-1", salesProjectLinks: { some: { vendorId: "vendor-1", projectId: "project-1" } },
    }) }));
  });

  it("拒絕跨專案、未就緒與不相容加購商品", async () => {
    await expect(validateFunnelCommerceBindings(scope, commerceState())).resolves.toBeUndefined();
    mocks.productFindMany.mockResolvedValueOnce([]);
    await expect(validateFunnelCommerceBindings(scope, commerceState())).rejects.toThrow("funnel_commerce_product_unavailable");
    mocks.productFindMany.mockResolvedValueOnce([
      product({ id: "product-1", fulfillmentType: "digital", deliveryConfig: { status: "active", fulfillmentType: "digital" } }),
      product({ id: "bump-1", fulfillmentType: "physical" }),
    ]);
    await expect(validateFunnelCommerceBindings(scope, commerceState({ schemaVersion: 1, productId: "product-1", orderBumpProductId: "bump-1", formMode: "single" }))).rejects.toThrow("funnel_commerce_product_unavailable");
  });

  it("只輸出允許的公開商品欄位", () => {
    const document = commerceState().pages.order_form!;
    expect(publicCommerceViewForDocument(document, [{ id: "product-1", name: "主商品", priceCents: 1200, currency: "TWD", fulfillmentType: "physical" }], "/checkout")).toEqual({
      product: { id: "product-1", name: "主商品", priceCents: 1200, currency: "TWD", fulfillmentType: "physical" },
      checkoutPath: "/checkout",
    });
  });

  it("只對 order step 發出已編碼的公開 checkout path", async () => {
    mocks.productFindMany.mockResolvedValue([{ ...product(), description: null, customCheckoutFields: [], revision: 4 }]);
    const views = await publicFunnelCommerceViews(scope, commerceState(), "offer");
    expect(Object.values(views)).toEqual([{
      product: { id: "product-1", name: "主商品", priceCents: 1200, currency: "TWD", fulfillmentType: "physical" },
      checkoutPath: "/lp/offer/order_form/checkout",
    }]);
    await expect(publicFunnelCommerceViews(scope, { root: [], settings: {} }, "offer")).resolves.toEqual({});
  });

  it("只解析已發布、已綁定目前 sales project 的 order step", async () => {
    const state = commerceState();
    mocks.landingPageFindMany.mockResolvedValue([{
      id: "page-1", vendorId: "vendor-1", projectId: "project-1", slug: "offer", publishedAt: new Date(), publishedVersionId: "version-2", operations: null,
      publishedVersion: { id: "version-2", vendorId: "vendor-1", pageId: "page-1", version: 2, content: state },
    }]);
    mocks.productFindMany.mockResolvedValue([{ ...product(), description: "可下載", customCheckoutFields: [], revision: 4 }]);
    await expect(resolvePublishedFunnelCheckout({ slug: "offer", stepId: "order_form", expectedVersion: 2, expectedProductRevision: 4 })).resolves.toMatchObject({
      projectId: "project-1", pageId: "page-1", version: 2, product: { id: "product-1", revision: 4, description: "可下載" },
    });
  });

  it("對已截止或非 order step fail closed", async () => {
    const state = commerceState();
    state.flow.steps[0]!.type = "sales_page";
    mocks.landingPageFindMany.mockResolvedValue([{
      id: "page-1", vendorId: "vendor-1", projectId: "project-1", slug: "offer", publishedAt: new Date(), publishedVersionId: "version-2", operations: null,
      publishedVersion: { id: "version-2", vendorId: "vendor-1", pageId: "page-1", version: 2, content: state },
    }]);
    await expect(resolvePublishedFunnelCheckout({ slug: "offer", stepId: "order_form" })).resolves.toBeNull();
  });

  it("對重複 published slug 與缺少 publishedAt fail closed", async () => {
    mocks.landingPageFindMany.mockResolvedValue([{ id: "page-1" }, { id: "page-2" }]);
    await expect(resolvePublishedFunnelCheckout({ slug: "offer", stepId: "order_form" })).resolves.toBeNull();
    mocks.landingPageFindMany.mockResolvedValue([{ id: "page-1", publishedAt: null }]);
    await expect(resolvePublishedFunnelCheckout({ slug: "offer", stepId: "order_form" })).resolves.toBeNull();
  });
});
