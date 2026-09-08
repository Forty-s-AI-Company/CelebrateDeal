import { beforeEach, describe, expect, it, vi } from "vitest";
import { issuePostPurchaseCheckoutToken, postPurchaseCheckoutHref, resolvePostPurchaseOffer, verifyPostPurchaseCheckoutToken } from "@/lib/post-purchase-upsell";

const source = {
  id: "course-basic", vendorId: "vendor-a", name: "基礎課", priceCents: 10_000,
  currency: "TWD", isActive: true, fulfillmentTypeConfirmed: true, inventory: 10,
  upsellProductId: "course-coaching", upsellDiscountCents: 500, downsellProductId: "course-review",
};

const coaching = {
  id: "course-coaching", vendorId: "vendor-a", name: "1 對 1 終身顧問", priceCents: 30_000,
  currency: "TWD", isActive: true, fulfillmentTypeConfirmed: true, inventory: 1,
};

beforeEach(() => {
  vi.stubEnv("CSRF_SECRET", "synthetic-post-purchase-test-secret-at-least-32-bytes");
});

describe("post-purchase upsell", () => {
  it("calculates an OTO as the server-owned upgrade difference", () => {
    expect(resolvePostPurchaseOffer({ source, candidates: [coaching], kind: "upsell" })).toMatchObject({
      kind: "upsell", productId: "course-coaching", amountCents: 19_500, discountCents: 500,
    });
  });

  it("fails closed for another tenant, inactive stock, currency mismatch, or a non-positive difference", () => {
    expect(resolvePostPurchaseOffer({ source, candidates: [{ ...coaching, vendorId: "vendor-b" }], kind: "upsell" })).toBeNull();
    expect(resolvePostPurchaseOffer({ source, candidates: [{ ...coaching, inventory: 0 }], kind: "upsell" })).toBeNull();
    expect(resolvePostPurchaseOffer({ source, candidates: [{ ...coaching, currency: "USD" }], kind: "upsell" })).toBeNull();
    expect(resolvePostPurchaseOffer({ source, candidates: [{ ...coaching, priceCents: 10_500 }], kind: "upsell" })).toBeNull();
  });

  it("uses a separately configured downsell and never accepts a browser-provided tenant path", () => {
    const offer = resolvePostPurchaseOffer({
      source,
      candidates: [{ ...coaching, id: "course-review", name: "作業批改方案", priceCents: 15_000 }],
      kind: "downsell",
    });
    expect(offer).toMatchObject({ kind: "downsell", amountCents: 5_000, discountCents: 0 });
    expect(offer && postPurchaseCheckoutHref({ vendorId: "vendor-a", offer })).toBe("/checkout/vendor-a/course-review?postPurchase=1");
    expect(postPurchaseCheckoutHref({ vendorId: "bad/path", offer: { productId: "course-review" } })).toBeNull();
  });

  it("binds the one-click handoff to the grant, order, target, and a short expiry without PII", () => {
    const now = new Date("2026-09-09T00:00:00.000Z");
    const token = issuePostPurchaseCheckoutToken({
      grantId: "grant-a", orderId: "order-a", vendorId: "vendor-a", sourceProductId: "course-basic", productId: "course-coaching", kind: "upsell", amountCents: 19_500, now,
    });
    expect(token).not.toContain("@example");
    expect(verifyPostPurchaseCheckoutToken(token, new Date("2026-09-09T00:09:00.000Z"))).toMatchObject({ grantId: "grant-a", amountCents: 19_500 });
    expect(verifyPostPurchaseCheckoutToken(`${token}tampered`, now)).toBeNull();
    expect(verifyPostPurchaseCheckoutToken(token, new Date("2026-09-09T00:11:00.000Z"))).toBeNull();
  });
});
