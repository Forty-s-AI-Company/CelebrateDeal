import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  findProduct: vi.fn(),
  notFound: vi.fn(() => { throw new Error("not-found"); }),
  redirect: vi.fn((url: string) => { throw new Error(`redirect:${url}`); }),
}));

vi.mock("@/lib/db", () => ({
  getDb: () => ({ product: { findFirst: mocks.findProduct } }),
}));
vi.mock("next/navigation", () => ({ notFound: mocks.notFound, redirect: mocks.redirect }));

import CommerceCheckoutPage from "@/app/checkout/[vendorId]/[productId]/page";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.findProduct.mockResolvedValue({
    id: "product-1",
    vendorId: "vendor-1",
    isActive: true,
    fulfillmentTypeConfirmed: true,
    name: "直播工具箱",
    description: "一套可以直接使用的工具。",
    priceCents: 12_000,
    currency: "TWD",
    imageUrl: null,
    inventory: 3,
    fulfillmentType: "digital",
    deliveryConfig: { status: "active", fulfillmentType: "digital" },
    checkoutUrl: null,
    customCheckoutFields: [],
    vendor: { name: "測試商家" },
  });
});

describe("CommerceCheckoutPage", () => {
  it("loads the same-vendor product and renders its ready fulfillment flow", async () => {
    const html = renderToStaticMarkup(await CommerceCheckoutPage({
      params: Promise.resolve({ vendorId: "vendor-1", productId: "product-1" }),
    }));

    expect(mocks.findProduct).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: "product-1", vendorId: "vendor-1" },
    }));
    // Server HTML stays neutral until browser storage is checked for an older order.
    expect(html).toContain("正在檢查是否有可恢復的訂單");
    expect(html).not.toContain("直播工具箱");
    expect(html).not.toContain("$120");
    expect(html).toContain("確認購買資料");
    expect(html).not.toContain("收件資料");
  });

  it("shows a truthful sold-out state without rendering a checkout form", async () => {
    mocks.findProduct.mockResolvedValueOnce({
      ...(await mocks.findProduct()),
      inventory: 0,
    });

    const html = renderToStaticMarkup(await CommerceCheckoutPage({
      params: Promise.resolve({ vendorId: "vendor-1", productId: "product-1" }),
    }));

    expect(html).toContain("正在檢查是否有可恢復的訂單");
    expect(html).not.toContain('name="buyerEmail"');
  });

  it("returns not-found for an unavailable or cross-vendor product", async () => {
    mocks.findProduct.mockResolvedValueOnce(null);

    await expect(CommerceCheckoutPage({
      params: Promise.resolve({ vendorId: "vendor-2", productId: "product-1" }),
    })).rejects.toThrow("not-found");
  });

  it("does not show a new checkout form when digital delivery is disabled", async () => {
    mocks.findProduct.mockResolvedValueOnce({
      ...(await mocks.findProduct()),
      deliveryConfig: null,
    });

    const html = renderToStaticMarkup(await CommerceCheckoutPage({
      params: Promise.resolve({ vendorId: "vendor-1", productId: "product-1" }),
    }));
    expect(html).toContain("恢復待付款訂單");
    expect(html).not.toContain('name="buyerEmail"');
  });

  it("redirects an external-checkout product without rendering the internal buyer form", async () => {
    mocks.findProduct.mockResolvedValueOnce({ ...(await mocks.findProduct()), checkoutUrl: "https://external.example.test/buy" });
    await expect(CommerceCheckoutPage({ params: Promise.resolve({ vendorId: "vendor-1", productId: "product-1" }) })).rejects.toThrow("redirect:https://external.example.test/buy");
    expect(mocks.redirect).toHaveBeenCalledWith("https://external.example.test/buy");
  });

  it("keeps a recovery entry when an existing product is deactivated", async () => {
    mocks.findProduct.mockResolvedValueOnce({ ...(await mocks.findProduct()), isActive: false });
    const html = renderToStaticMarkup(await CommerceCheckoutPage({
      params: Promise.resolve({ vendorId: "vendor-1", productId: "product-1" }),
      searchParams: Promise.resolve({ resume: "1" }),
    }));
    expect(html).toContain("正在檢查是否有可恢復的訂單");
    expect(html).not.toContain("直播工具箱");
    expect(html).not.toContain("一套可以直接使用的工具");
    expect(html).not.toContain('name="buyerEmail"');
  });
});
