import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { Product } from "@prisma/client";

vi.mock("@/components/csrf-field", () => ({
  CsrfField: () => <input type="hidden" name="csrfToken" value="synthetic-csrf" />,
}));
vi.mock("@/lib/csrf", () => ({ getCsrfToken: async () => "synthetic-csrf" }));

import { ProductForm } from "@/components/product-form";

function product(fulfillmentTypeConfirmed: boolean): Product {
  return {
    id: "product-1",
    vendorId: "vendor-1",
    name: "既有商品",
    slug: "legacy-product",
    description: null,
    priceCents: 1_200,
    compareAtCents: null,
    currency: "TWD",
    imageUrl: null,
    imageAssetId: null,
    checkoutUrl: null,
    customCheckoutFields: null,
    upsellProductId: null,
    upsellDiscountCents: null,
    downsellProductId: null,
    inventory: 3,
    isActive: true,
    commerceDomain: "merchant",
    fulfillmentType: "physical",
    fulfillmentTypeConfirmed,
    courseContentOwnerMembershipId: null,
    coursePromoterShareBps: null,
    coursePolicyVersion: 1,
    revision: 1,
    createdAt: new Date("2026-08-08T00:00:00.000Z"),
    updatedAt: new Date("2026-08-08T00:00:00.000Z"),
  };
}

describe("ProductForm fulfillment classification", () => {
  it("retains configured offer selections and exact discount through server-to-client serialization", async () => {
    const configured = { ...product(true), upsellProductId: "upgrade", downsellProductId: "alternative", upsellDiscountCents: 1234 };
    const html = renderToStaticMarkup(await ProductForm({ product: configured, offerProducts: [
      { id: "upgrade", name: "升級（目前無法加購）", priceCents: 3000, currency: "TWD" },
      { id: "alternative", name: "備選", priceCents: 2500, currency: "TWD" },
    ] }));
    expect(html).toContain('value="upgrade" selected=""');
    expect(html).toContain('value="alternative" selected=""');
    expect(html).toMatch(/name="upsellDiscount"[^>]*value="12\.34"/u);
  });
  it("warns that a historical product remains unsellable until its delivery type is confirmed", async () => {
    const html = renderToStaticMarkup(await ProductForm({ product: product(false) }));

    expect(html).toContain("交付方式尚未確認");
    expect(html).toContain("確認前不會開放結帳");
    expect(html).toContain('name="fulfillmentType"');
    for (const type of ["physical", "digital", "service", "course"]) {
      expect(html).toContain(`value="${type}"`);
    }
  });

  it("submits a fixed TWD currency with no free-text currency input (F-041)", async () => {
    const html = renderToStaticMarkup(await ProductForm({ product: product(true) }));
    expect(html).toMatch(/<input type="hidden" name="currency" value="TWD"\/>/u);
    expect(html).not.toMatch(/name="currency"[^>]*type="text"|type="text"[^>]*name="currency"/u);
    expect(html).not.toContain('name="confirmTwdCurrency"');
  });

  it("requires an explicit TWD confirmation before saving a legacy non-TWD product (F-041)", async () => {
    const html = renderToStaticMarkup(await ProductForm({ product: { ...product(true), currency: "USD" } }));
    expect(html).toContain("這個商品原本設定為 USD");
    expect(html).toMatch(/<input type="checkbox" required=""[^>]*name="confirmTwdCurrency"\/>/u);
    expect(html).toMatch(/<input type="hidden" name="currency" value="TWD"\/>/u);
  });

  it("posts the loaded stock as the hidden inventoryBaseline next to the content revision (B-2)", async () => {
    const html = renderToStaticMarkup(await ProductForm({ product: { ...product(true), inventory: 17, revision: 9 } }));
    expect(html).toContain('<input type="hidden" name="inventoryBaseline" value="17"/>');
    expect(html).toContain('<input type="hidden" name="revision" value="9"/>');
    expect(html).toMatch(/name="inventory"[^>]*value="17"|value="17"[^>]*name="inventory"/u);
  });

  it("does not render an inventoryBaseline for a new product", async () => {
    const html = renderToStaticMarkup(await ProductForm({}));
    expect(html).not.toContain('name="inventoryBaseline"');
  });

  it("does not show the migration warning after a merchant confirms the delivery type", async () => {
    const html = renderToStaticMarkup(await ProductForm({ product: product(true) }));
    expect(html).not.toContain("交付方式尚未確認");
  });
});
