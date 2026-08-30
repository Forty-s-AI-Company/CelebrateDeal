import { renderToStaticMarkup } from "react-dom/server";
import { isValidElement, type ReactElement, type ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ requireVendorManager: vi.fn(), findFirst: vi.fn(), notFound: vi.fn(() => { throw new Error("not-found"); }) }));
vi.mock("next/navigation", () => ({ notFound: mocks.notFound }));
vi.mock("next/image", () => ({ default: ({ src, alt }: { src: string; alt: string }) => <span data-src={src} aria-label={alt} /> }));
vi.mock("next/link", () => ({ default: ({ href, children, ...props }: { href: string; children: ReactNode }) => <a href={href} {...props}>{children}</a> }));
vi.mock("@/lib/auth", () => ({ requireVendorManager: mocks.requireVendorManager }));
vi.mock("@/lib/db", () => ({ getDb: () => ({ product: { findFirst: mocks.findFirst } }) }));

import ProductPreviewPage from "./page";

function findElementByHref(node: ReactNode, href: string): ReactElement<{ children?: ReactNode; href?: string }> | null {
  if (Array.isArray(node)) {
    for (const child of node) {
      const match = findElementByHref(child, href);
      if (match) return match;
    }
    return null;
  }
  if (!isValidElement<{ children?: ReactNode; href?: string }>(node)) return null;
  if (node.props.href === href) return node;
  return findElementByHref(node.props.children, href);
}

const product = {
  id: "product-1", vendorId: "vendor-1", name: "精華組", description: "完整說明", priceCents: 128000,
  currency: "TWD", imageUrl: "https://media.example.test/product.webp", inventory: 3, isActive: true,
  fulfillmentType: "physical" as const, fulfillmentTypeConfirmed: true, checkoutUrl: null,
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireVendorManager.mockResolvedValue({ id: "vendor-1" });
  mocks.findFirst.mockResolvedValue(product);
});

describe("product merchant preview", () => {
  it("is tenant-scoped and exposes an internal checkout preview only when sellable", async () => {
    const page = await ProductPreviewPage({ params: Promise.resolve({ id: "product-1" }) });
    const checkoutCta = findElementByHref(page, "/checkout/vendor-1/product-1");
    const html = renderToStaticMarkup(page);
    expect(mocks.findFirst).toHaveBeenCalledWith({
      where: { id: "product-1", vendorId: "vendor-1" },
      include: { deliveryConfig: { select: { status: true, fulfillmentType: true, title: true } } },
    });
    expect(html).toContain("這是商家預覽");
    expect(html).toContain('href="/checkout/vendor-1/product-1"');
    expect(checkoutCta?.type, "checkout preview must use a native anchor for hard navigation").toBe("a");
    expect(html).not.toContain("尚不可販售");
  });

  it("does not advertise checkout for a legacy digital product without delivery content", async () => {
    mocks.findFirst.mockResolvedValue({
      ...product,
      fulfillmentType: "digital",
      deliveryConfig: null,
    });
    const html = renderToStaticMarkup(await ProductPreviewPage({ params: Promise.resolve({ id: "product-1" }) }));
    expect(html).toContain("付款後交付");
    expect(html).toContain("尚未完成設定");
    expect(html).not.toContain('href="/checkout/vendor-1/product-1"');
  });

  it("shows draft and external-checkout blockers without a misleading internal CTA", async () => {
    mocks.findFirst.mockResolvedValue({ ...product, isActive: false, checkoutUrl: "https://external.example.test/checkout" });
    const html = renderToStaticMarkup(await ProductPreviewPage({ params: Promise.resolve({ id: "product-1" }) }));
    expect(html).toContain("尚不可販售");
    expect(html).toContain("不會產生完整的 CelebrateDeal 訂單");
    expect(html).not.toContain('href="/checkout/vendor-1/product-1"');
  });

  it("does not return another vendor's product", async () => {
    mocks.findFirst.mockResolvedValue(null);
    await expect(ProductPreviewPage({ params: Promise.resolve({ id: "other-product" }) })).rejects.toThrow("not-found");
  });
});
