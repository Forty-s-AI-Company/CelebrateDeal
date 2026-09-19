import { describe, expect, it } from "vitest";
import { FunnelCommerceBindingSchema, FunnelCheckoutReferenceSchema, commerceViewForBinding, funnelCheckoutPath } from "./funnel-commerce";
import { createEmptyPageDocument, parsePageDocument } from "./funnel-page-document";
import { createFunnelPageHistory, dispatchFunnelPageCommand, redoFunnelPageHistory, undoFunnelPageHistory } from "./funnel-page-history";
import { changeFunnelTemplate } from "./funnel-template-transaction";
import { createGoalFunnelStepPages } from "./funnel-goal-step-pages";
import { replaceFunnelStepPage } from "./funnel-step-pages";

const binding = { schemaVersion: 1, productId: "product_a", formMode: "two_step", agreement: { label: "我同意訂購條款" } } as const;
describe("Funnel commerce reference contract", () => {
  it("defaults form mode and accepts references without prices", () => {
    expect(FunnelCommerceBindingSchema.parse({ schemaVersion: 1, productId: "a" })).toEqual({ schemaVersion: 1, productId: "a", formMode: "single" });
    expect(FunnelCommerceBindingSchema.parse(binding)).toEqual(binding);
  });
  it.each(["priceCents", "currency", "vendorId", "provider", "returnUrl", "shippingFeeCents", "couponCode"])("rejects client authority field %s", (key) => {
    expect(FunnelCommerceBindingSchema.safeParse({ ...binding, [key]: "forged" }).success).toBe(false);
  });
  it("rejects self bumps, invalid IDs and executable agreement structures", () => {
    expect(FunnelCommerceBindingSchema.safeParse({ ...binding, orderBumpProductId: binding.productId }).success).toBe(false);
    expect(FunnelCommerceBindingSchema.safeParse({ ...binding, productId: "../other" }).success).toBe(false);
    expect(FunnelCommerceBindingSchema.safeParse({ ...binding, agreement: { label: "ok", html: "<script/>" } }).success).toBe(false);
    expect(FunnelCheckoutReferenceSchema.safeParse({ slug: "ok", stepId: "step", vendorId: "forged" }).success).toBe(false);
    expect(funnelCheckoutPath({ slug: "shop", stepId: "order" })).toBe("/lp/shop/order/checkout");
  });
  it("supports additive v1 migration, structured undo/redo and serialization", () => {
    const old = createEmptyPageDocument("old");
    expect(parsePageDocument(old)?.commerce).toBeUndefined();
    const document = { ...old, commerce: binding };
    expect(parsePageDocument(JSON.parse(JSON.stringify(document)))?.commerce).toEqual(binding);
    const history = dispatchFunnelPageCommand(createFunnelPageHistory(old), { type: "replace_document", document });
    expect(history.present.commerce).toEqual(binding);
    const undone = undoFunnelPageHistory(history);
    expect(undone.present.commerce).toBeUndefined();
    expect(redoFunnelPageHistory(undone).present.commerce).toEqual(binding);
  });
  it("fails closed when a binding cannot be projected from trusted catalog options", () => {
    const product = { id: binding.productId, name: "商品", priceCents: 12000, currency: "TWD", fulfillmentType: "digital" as const };
    expect(commerceViewForBinding(binding, [product])).toEqual({ product });
    expect(commerceViewForBinding(binding, [])).toBeUndefined();
    expect(commerceViewForBinding({ ...binding, orderBumpProductId: "b" }, [product])).toBeUndefined();
    expect(commerceViewForBinding({ ...binding, orderBumpProductId: "b" }, [product, { ...product, id: "b", currency: "USD" }])).toBeUndefined();
  });
  it("preserves checkout configuration when replacing visual templates", () => {
    const document = { ...createEmptyPageDocument("page"), commerce: binding };
    const result = changeFunnelTemplate(document, { templateId: "sell", confirm: true });
    expect(result.ok).toBe(true);
    expect(result.document.commerce).toEqual(binding);
    const state = createGoalFunnelStepPages({ id: "shop", name: "Shop", goal: "sell", domain: "shop" })!;
    state.pages.order_form!.commerce = binding;
    const replaced = replaceFunnelStepPage(state, "order_form", createEmptyPageDocument("replacement"), "sell-product-checkout");
    expect(replaced.ok).toBe(true);
    expect(replaced.state.pages.order_form?.commerce).toEqual(binding);
  });
});
