import { renderToStaticMarkup } from "react-dom/server";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ requireVendorManager: vi.fn(), findMany: vi.fn() }));
vi.mock("next/link", () => ({ default: ({ href, children, ...props }: { href: string; children: ReactNode }) => <a href={href} {...props}>{children}</a> }));
vi.mock("lucide-react", () => ({ Plus: () => <span>plus</span> }));
vi.mock("@/lib/auth", () => ({ requireVendorManager: mocks.requireVendorManager }));
vi.mock("@/lib/db", () => ({ getDb: () => ({ product: { findMany: mocks.findMany } }) }));

import ProductsPage from "./page";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireVendorManager.mockResolvedValue({ id: "vendor-1" });
  mocks.findMany.mockResolvedValue([]);
});

describe("/products route", () => {
  it("scopes search and sellable status to the current vendor", async () => {
    await ProductsPage({ searchParams: Promise.resolve({ q: "  精華  ", status: "active" }) });
    expect(mocks.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: {
        vendorId: "vendor-1",
        OR: [{ name: { contains: "精華", mode: "insensitive" } }, { slug: { contains: "精華", mode: "insensitive" } }],
        isActive: true,
        inventory: { gt: 0 },
      },
      include: { _count: { select: { commerceOrderItems: true } } },
      take: 100,
    }));
  });

  it("renders inventory, preview, edit, and product-scoped orders without nested card links", async () => {
    mocks.findMany.mockResolvedValue([{
      id: "product-1", name: "精華組", slug: "serum", priceCents: 128000, currency: "TWD", imageUrl: null,
      inventory: 7, isActive: true, fulfillmentType: "physical", fulfillmentTypeConfirmed: true,
      _count: { commerceOrderItems: 3 },
    }]);
    const html = renderToStaticMarkup(await ProductsPage({ searchParams: Promise.resolve({ updated: "saved" }) }));
    expect(html).toContain("商品已儲存");
    expect(html).toContain("可售庫存");
    expect(html).toContain('href="/products/product-1/preview"');
    expect(html).toContain('href="/products/product-1/edit"');
    expect(html).toContain('href="/orders?productId=product-1"');
  });

  it("drops forged status values before querying", async () => {
    await ProductsPage({ searchParams: Promise.resolve({ status: "deleted" }) });
    expect(mocks.findMany.mock.calls[0][0].where).toEqual({ vendorId: "vendor-1" });
  });
});
