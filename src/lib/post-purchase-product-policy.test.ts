import { describe, expect, it, vi } from "vitest";
import type { Prisma } from "@prisma/client";
import { assertPostPurchaseProductPolicy, parsePostPurchaseProductPolicy, PostPurchaseProductPolicyError } from "./post-purchase-product-policy";

function form(values: Record<string, string | undefined>) {
  const data = new FormData();
  for (const [key, value] of Object.entries(values)) if (value !== undefined) data.set(key, value);
  return data;
}

describe("merchant post-purchase policy", () => {
  it("preserves unchanged offers during unrelated edits without resolving disabled targets", async () => {
    const findMany = vi.fn();
    const db = { product: { findMany } } as unknown as Pick<Prisma.TransactionClient, "product">;
    await assertPostPurchaseProductPolicy(db, { vendorId: "vendor", productId: "source", currency: "TWD", priceCents: 1000,
      policy: { upsellProductId: "target", downsellProductId: null, upsellDiscountCents: 100 },
      existing: { vendorId: "vendor", currency: "TWD", priceCents: 1000, upsellProductId: "target", downsellProductId: null, upsellDiscountCents: 100 } });
    expect(findMany).not.toHaveBeenCalled();
  });
  it("revalidates unchanged target IDs when source money changes", async () => {
    const findMany = vi.fn().mockResolvedValue([]);
    const db = { product: { findMany } } as unknown as Pick<Prisma.TransactionClient, "product">;
    await expect(assertPostPurchaseProductPolicy(db, { vendorId: "vendor", productId: "source", currency: "TWD", priceCents: 1200,
      policy: { upsellProductId: "target", downsellProductId: null, upsellDiscountCents: 100 },
      existing: { vendorId: "vendor", currency: "TWD", priceCents: 1000, upsellProductId: "target", downsellProductId: null, upsellDiscountCents: 100 } })).rejects.toThrow(PostPurchaseProductPolicyError);
    expect(findMany).toHaveBeenCalledOnce();
  });
  it("preserves omitted settings and supports explicit clearing", () => {
    expect(parsePostPurchaseProductPolicy(form({}))).toBeUndefined();
    expect(parsePostPurchaseProductPolicy(form({ upsellProductId: "", downsellProductId: "", upsellDiscount: "0" })))
      .toEqual({ upsellProductId: null, downsellProductId: null, upsellDiscountCents: 0 });
  });
  it.each([
    { upsellProductId: "target" },
    { upsellProductId: "foreign/id", downsellProductId: "", upsellDiscount: "0" },
    { upsellProductId: "", downsellProductId: "", upsellDiscount: "1" },
    { upsellProductId: "target", downsellProductId: "", upsellDiscount: "1.001" },
    { upsellProductId: "target", downsellProductId: "", upsellDiscount: "99999999" },
  ])("rejects incomplete or invalid money settings %j", input => {
    expect(() => parsePostPurchaseProductPolicy(form(input))).toThrow(PostPurchaseProductPolicyError);
  });
  it("uses exact minor units without floating point rounding", () => {
    expect(parsePostPurchaseProductPolicy(form({ upsellProductId: "target", downsellProductId: "", upsellDiscount: "12.34" })))
      .toEqual({ upsellProductId: "target", downsellProductId: null, upsellDiscountCents: 1234 });
  });
  it.each([{ targets: [] }, { targets: [{ id: "target", currency: "USD", priceCents: 2000 }] }, { targets: [{ id: "target", currency: "TWD", priceCents: 1100 }] }])
    ("rejects a missing, foreign-currency or fully discounted target", async ({ targets }) => {
      const findMany = vi.fn().mockResolvedValue(targets);
      const db = { product: { findMany } } as unknown as Pick<Prisma.TransactionClient, "product">;
      await expect(assertPostPurchaseProductPolicy(db, { vendorId: "vendor", productId: "source", currency: "TWD", priceCents: 1000,
        policy: { upsellProductId: "target", downsellProductId: null, upsellDiscountCents: 100 } })).rejects.toThrow(PostPurchaseProductPolicyError);
      expect(findMany).toHaveBeenCalledWith(expect.objectContaining({ where: {
        vendorId: "vendor", id: { in: ["target"] }, isActive: true, fulfillmentTypeConfirmed: true, checkoutUrl: null,
      } }));
    });
  it("rejects self references before database access", async () => {
    const findMany = vi.fn();
    const db = { product: { findMany } } as unknown as Pick<Prisma.TransactionClient, "product">;
    await expect(assertPostPurchaseProductPolicy(db, { vendorId: "vendor", productId: "source", currency: "TWD", priceCents: 1000,
      policy: { upsellProductId: "source", downsellProductId: null, upsellDiscountCents: 0 } })).rejects.toThrow(PostPurchaseProductPolicyError);
    expect(findMany).not.toHaveBeenCalled();
  });
});
