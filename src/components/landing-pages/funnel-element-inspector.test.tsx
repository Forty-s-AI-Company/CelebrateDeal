import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { FunnelElementInspector, inspectorActionHrefError, inspectorSectionFor, inspectorUrlFieldError } from "@/components/landing-pages/funnel-element-inspector";
import { getFunnelElementInspectorDefinition } from "@/lib/funnel-element-inspector";
import type { FunnelNode } from "@/lib/funnel-page-document";

const button: FunnelNode = { schemaVersion: 1, id: "cta_button", type: "button", props: { label: "立即加入" }, style: {}, overrides: {}, visible: true, actions: [], attributes: {} };

describe("FunnelElementInspector", () => {
  it("輸出分類區段、覆寫範圍與安全動作設定", () => {
    const html = renderToStaticMarkup(<FunnelElementInspector node={button} popupIds={["welcome_popup"]} onCommand={() => undefined} />);

    expect(html).toContain('data-funnel-element-inspector="true"');
    for (const label of ["內容", "字型", "尺寸與位置", "動作", "進階"]) expect(html).toContain(`<span>${label}</span>`);
    // No colour fields exist yet, so the empty section stays hidden.
    expect(html).not.toContain("<span>顏色</span>");
    expect(html).toContain("基礎值");
    expect(html).toContain("僅桌機覆寫");
    expect(html).toContain("僅手機覆寫");
    expect(html).toContain("按鈕文字");
    expect(html).toContain("套用動作");
  });

  it("keeps content, typography and size expanded while actions and advanced start collapsed", () => {
    const html = renderToStaticMarkup(<FunnelElementInspector node={button} onCommand={() => undefined} />);
    const expanded = (key: string) => new RegExp(`aria-expanded="(true|false)" aria-controls="funnel-inspector-cta_button-${key}"`, "u").exec(html)?.[1];
    expect(expanded("content")).toBe("true");
    expect(expanded("typography")).toBe("true");
    expect(expanded("size")).toBe("true");
    expect(expanded("actions")).toBe("false");
    expect(expanded("advanced")).toBe("false");
  });

  it("maps every schema field to exactly one presentation section", () => {
    const fields = getFunnelElementInspectorDefinition("text").fields;
    const byId = Object.fromEntries(fields.map((field) => [field.id, inspectorSectionFor(field)]));
    expect(byId).toMatchObject({ text: "content", fontSize: "typography", lineHeight: "typography", textAlign: "typography", padding: "size", margin: "size", width: "size", visible: "advanced", id: "advanced" });
    expect(inspectorSectionFor({ id: "textColor", label: "文字顏色", group: "design", kind: "text", target: "style" })).toBe("color");
  });

  it.each(["/\\evil.example", "/\t/evil.example", "//evil.example", "https://app.example@evil.example", "javascript:alert(1)"])("以繁中錯誤訊息拒絕會導向站外的動作網址 %s，且無法套用", (href) => {
    const node: FunnelNode = { ...button, actions: [{ type: "open_url", href, newTab: false }] };
    const html = renderToStaticMarkup(<FunnelElementInspector node={node} onCommand={() => undefined} />);
    expect(html).toContain('role="alert"');
    expect(html).toContain("網址只接受 HTTPS 網址、本站路徑（以單一 / 開頭，不可接 / 或 \\）或頁面錨點（#）。");
    expect(html).toContain('aria-invalid="true"');
    expect(html).toMatch(/<button type="button" disabled=""[^>]*>套用動作<\/button>/u);
    expect(inspectorActionHrefError({ type: "open_url", href })).not.toBeNull();
    expect(inspectorActionHrefError({ type: "download", href })).not.toBeNull();
  });

  it("合法的動作網址不顯示錯誤", () => {
    for (const href of ["/lp/shop/order?utm_source=line", "#pricing", "https://example.com/offer", ""]) {
      expect(inspectorActionHrefError({ type: "open_url", href })).toBeNull();
    }
    const node: FunnelNode = { ...button, actions: [{ type: "open_url", href: "/lp/shop", newTab: false }] };
    const html = renderToStaticMarkup(<FunnelElementInspector node={node} onCommand={() => undefined} />);
    expect(html).not.toContain('role="alert"');
    expect(html).not.toMatch(/disabled=""[^>]*>套用動作/u);
  });

  it("圖片、影片與分享網址欄位標示不安全的值", () => {
    const image: FunnelNode = { ...button, id: "hero_image", type: "image", props: { src: "/\\evil.example/a.png" } };
    const html = renderToStaticMarkup(<FunnelElementInspector node={image} onCommand={() => undefined} />);
    expect(html).toContain("網址只接受 HTTPS 網址或本站路徑（以單一 / 開頭，不可接 / 或 \\）。頁面上不會顯示這個網址。");
    const field = (type: FunnelNode["type"], id: string) => getFunnelElementInspectorDefinition(type).fields.find((item) => item.id === id)!;
    expect(inspectorUrlFieldError(field("image", "src"), "/images/a.png")).toBeNull();
    expect(inspectorUrlFieldError(field("image", "src"), "#top")).not.toBeNull();
    expect(inspectorUrlFieldError(field("video", "poster"), "https://user@evil.example/p.png")).not.toBeNull();
    expect(inspectorUrlFieldError(field("x_share_button", "url"), "/\\evil.example")).not.toBeNull();
    expect(inspectorUrlFieldError(field("x_share_button", "url"), "https://example.com/post")).toBeNull();
    expect(inspectorUrlFieldError(field("text", "text"), "/\\not-a-url-field")).toBeNull();
  });
});

describe("FunnelElementInspector 付款元件", () => {
  const checkout = (type: FunnelNode["type"]): FunnelNode => ({ ...button, id: `${type}_1`, type, props: {} });
  const render = (type: FunnelNode["type"], commerce?: Parameters<typeof FunnelElementInspector>[0]["commerce"]) => renderToStaticMarkup(<FunnelElementInspector node={checkout(type)} commerce={commerce} onCommand={() => undefined} />);

  it("已連結商品時顯示商品名稱與修改入口，不再說尚未連接", () => {
    for (const type of ["order_bump", "two_step_order_form", "payment_button"] as const) {
      const html = render(type, { state: "bound", productName: "年度課程" });
      expect(html).toContain('data-funnel-inspector-commerce="bound"');
      expect(html).toContain("目前連結商品：年度課程");
      expect(html).toContain("結帳商品");
      expect(html).not.toContain("尚未連接");
    }
  });

  it("未連結或商品不可用時引導就地綁定", () => {
    expect(render("order_bump", { state: "unbound" })).toContain("請使用上方「結帳商品」選擇商品");
    expect(render("order_bump", { state: "unavailable" })).toContain("重新選擇商品");
    expect(render("order_bump", { state: "disabled" })).toContain("訂單表單");
    expect(render("order_bump", { state: "unbound" })).not.toContain("尚未連接");
  });

  it("所有付款元件都不提供價格或金額欄位", () => {
    for (const type of ["order_bump", "two_step_order_form", "offer_price", "payment_button", "shipping_fees"] as const) {
      const definition = getFunnelElementInspectorDefinition(type);
      expect(definition.fields.some((field) => field.group === "content" || field.target === "props")).toBe(false);
      expect(definition.capabilityNote).not.toContain("尚未連接");
    }
  });

  it("優惠碼明確說明不支援手動輸入，也不暗示之後會接上", () => {
    const html = render("coupon", { state: "bound", productName: "年度課程" });
    expect(html).toContain("目前不支援手動輸入優惠碼");
    expect(html).not.toContain("data-funnel-inspector-commerce");
    expect(html).not.toContain("尚未");
    expect(html).not.toContain("即將");
  });
});
