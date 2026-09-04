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
  it("warns that a historical product remains unsellable until its delivery type is confirmed", async () => {
    const html = renderToStaticMarkup(await ProductForm({ product: product(false) }));

    expect(html).toContain("交付方式尚未確認");
    expect(html).toContain("確認前不會開放結帳");
    expect(html).toContain('name="fulfillmentType"');
    for (const type of ["physical", "digital", "service", "course"]) {
      expect(html).toContain(`value="${type}"`);
    }
  });

  it("does not show the migration warning after a merchant confirms the delivery type", async () => {
    const html = renderToStaticMarkup(await ProductForm({ product: product(true) }));
    expect(html).not.toContain("交付方式尚未確認");
  });

  it("enables course commission selection alongside digital delivery", async () => {
    const html = renderToStaticMarkup(await ProductForm({ product: product(true) }));
    expect(html).toContain('<option value="course"');
    expect(html).not.toContain('<option value="course" disabled=""');
    expect(html).toContain('<option value="digital"');
    expect(html).toContain("實際推廣者 G 的分潤寫入不可變帳本");
  });

  it("allows editing historical course ownership and commission inputs", async () => {
    const existing: Product = { ...product(true), commerceDomain: "course", fulfillmentType: "course", courseContentOwnerMembershipId: "owner-existing", coursePromoterShareBps: 2000 };
    const html = renderToStaticMarkup(await ProductForm({ product: existing }));
    expect(html).toContain('name="courseContentOwnerMembershipId"');
    expect(html).toContain('name="coursePromoterShareBps"');
    expect(html).not.toContain('name="coursePromoterShareBps" readOnly=""');
    expect(html).not.toContain('<option value="course" disabled=""');
  });
});
