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
vi.mock("next/headers", () => ({ cookies: async () => ({ get: vi.fn(() => undefined) }) }));

import CommerceCheckoutPage from "@/app/checkout/[vendorId]/[productId]/page";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.findProduct.mockResolvedValue({
    id: "product-1",
    vendorId: "vendor-1",
    name: "直播工具箱",
    description: "一套可以直接使用的工具。",
    priceCents: 12_000,
    currency: "TWD",
    imageUrl: null,
    inventory: 3,
    fulfillmentType: "digital",
    deliveryConfig: { status: "active", fulfillmentType: "digital" },
    checkoutUrl: null,
    vendor: { name: "測試商家" },
  });
});

describe("CommerceCheckoutPage", () => {
  it("loads only an active same-vendor product and renders its real fulfillment flow", async () => {
    const html = renderToStaticMarkup(await CommerceCheckoutPage({
      params: Promise.resolve({ vendorId: "vendor-1", productId: "product-1" }),
    }));

    expect(mocks.findProduct).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: "product-1", vendorId: "vendor-1", isActive: true, fulfillmentTypeConfirmed: true, priceCents: { gt: 0 } },
    }));
    expect(html).toContain("測試商家");
    expect(html).toContain("直播工具箱");
    expect(html).toContain("數位內容");
    expect(html).toContain("$120");
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

    expect(html).toContain("目前已售完或名額已滿");
    expect(html).not.toContain('name="buyerEmail"');
  });

  it("returns not-found for an unavailable or cross-vendor product", async () => {
    mocks.findProduct.mockResolvedValueOnce(null);

    await expect(CommerceCheckoutPage({
      params: Promise.resolve({ vendorId: "vendor-2", productId: "product-1" }),
    })).rejects.toThrow("not-found");
  });

  it("fails closed for a digital product whose delivery config is missing or disabled", async () => {
    mocks.findProduct.mockResolvedValueOnce({
      ...(await mocks.findProduct()),
      deliveryConfig: null,
    });

    await expect(CommerceCheckoutPage({
      params: Promise.resolve({ vendorId: "vendor-1", productId: "product-1" }),
    })).rejects.toThrow("not-found");
  });

  it("redirects an external-checkout product without rendering the internal buyer form", async () => {
    mocks.findProduct.mockResolvedValueOnce({ ...(await mocks.findProduct()), checkoutUrl: "https://external.example.test/buy" });
    await expect(CommerceCheckoutPage({ params: Promise.resolve({ vendorId: "vendor-1", productId: "product-1" }) })).rejects.toThrow("redirect:https://external.example.test/buy");
    expect(mocks.redirect).toHaveBeenCalledWith("https://external.example.test/buy");
  });
});
