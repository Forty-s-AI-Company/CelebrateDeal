import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { createEmptyPageDocument, type FunnelNode, type FunnelNodeType } from "@/lib/funnel-page-document";
import type { FunnelCommerceView } from "@/lib/funnel-commerce";
import { FunnelPageDocumentRenderer } from "./funnel-page-document-renderer";
import { instantiateFunnelTemplate } from "@/lib/funnel-template-gallery";
import { FunnelPageEditor } from "./funnel-page-editor";

const commerce: FunnelCommerceView = { product: { id: "p", name: "可信商品", currency: "TWD", priceCents: 12300, fulfillmentType: "physical" }, orderBump: { id: "b", name: "可信加購", currency: "TWD", priceCents: 5000, fulfillmentType: "physical" }, checkoutPath: "/lp/shop/order/checkout" };
function document(type: FunnelNodeType) {
  const node = (type: FunnelNodeType, id: string, children?: FunnelNode[]): FunnelNode => ({ schemaVersion: 1, id, type, props: { priceCents: 1, label: "惡意價格", href: "https://evil.test" }, overrides: {}, style: {}, visible: true, actions: [], attributes: {}, ...(children ? { children } : {}) });
  return { ...createEmptyPageDocument("page"), commerce: { schemaVersion: 1 as const, productId: "p", orderBumpProductId: "b", formMode: "two_step" as const, agreement: { label: "額外購買同意" } }, root: [node("section", "s", [node("row", "r", [node(type, "leaf")])])] };
}
describe("Funnel commerce renderer", () => {
  it("keeps checkout template children visible even when a lead form is bound", () => {
    const page = { ...instantiateFunnelTemplate("sell-product-checkout", "checkout"), commerce: document("offer_price").commerce };
    const html = renderToStaticMarkup(<FunnelPageDocumentRenderer document={page} commerce={commerce} publicSurface submission={{ landingPageId: "lp", form: { id: "lead", fields: [], submitLabel: "不應取代付款", successMessage: "ok" } }} />);
    expect(html).toContain("可信商品");
    expect(html).toContain('href="/lp/shop/order/checkout"');
    expect(html).not.toContain("不應取代付款");
  });
  it("lets editors add the supported payment elements while scripts remain disabled", () => {
    const html = renderToStaticMarkup(<FunnelPageEditor document={document("payment_button")} commerceProducts={[commerce.product]} commerceEnabled onChange={() => {}} />);
    for (const label of ["付款按鈕", "方案價格", "加購方案", "兩步驟結帳", "同意條款", "運費狀態"]) {
      expect(html).toMatch(new RegExp(`<button(?![^>]*\\sdisabled=)[^>]*>${label}</button>`, "u"));
    }
    expect(html).toMatch(/<button[^>]*\sdisabled=""[^>]*>Raw HTML/u);
  });
  it("uses trusted prices equally in editor and mobile preview, never node overrides", () => {
    for (const mode of ["editor", "preview"] as const) {
      const html = renderToStaticMarkup(<FunnelPageDocumentRenderer document={document("offer_price")} commerce={commerce} mode={mode} viewport="mobile" />);
      expect(html).toContain("可信商品"); expect(html).toContain("123"); expect(html).not.toContain("惡意價格");
    }
  });
  it("only enables checkout on public surface and never accepts node hrefs", () => {
    const draft = renderToStaticMarkup(<FunnelPageDocumentRenderer document={document("payment_button")} commerce={commerce} />);
    expect(draft).toContain("預覽不收款"); expect(draft).not.toContain('href=');
    const html = renderToStaticMarkup(<FunnelPageDocumentRenderer document={document("payment_button")} commerce={commerce} publicSurface />);
    expect(html).toContain('href="/lp/shop/order/checkout"'); expect(html).not.toContain("evil.test");
  });
  it("disables mismatched or missing trusted products", () => {
    for (const view of [undefined, { ...commerce, product: { ...commerce.product, id: "other" } }]) {
      const html = renderToStaticMarkup(<FunnelPageDocumentRenderer document={document("payment_button")} commerce={view} publicSurface />);
      expect(html).toContain("尚未連結商品"); expect(html).not.toContain('href=');
    }
  });
  it.each(["payment_method", "physical_product", "customer_type", "agreement", "order_bump", "coupon", "shipping_fees", "two_step_order_form"] as const)("renders an honest %s capability", (type) => {
    const html = renderToStaticMarkup(<FunnelPageDocumentRenderer document={document(type)} commerce={commerce} />);
    expect(html).not.toContain("目前無法在此預覽");
    expect(html).not.toContain("惡意價格");
    if (type === "coupon") expect(html).toContain("尚未提供手動輸入優惠碼");
    if (type === "shipping_fees") expect(html).toContain("未提供獨立運費規則");
    if (type === "agreement") expect(html).toContain("額外購買同意");
    if (type === "order_bump") expect(html).toContain("可信加購");
  });
});
