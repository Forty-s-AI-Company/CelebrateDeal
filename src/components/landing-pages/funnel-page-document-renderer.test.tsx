import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { createEmptyPageDocument, type FunnelNode, type PageDocument } from "@/lib/funnel-page-document";
import { FunnelPageDocumentRenderer } from "@/components/landing-pages/funnel-page-document-renderer";

function node(type: FunnelNode["type"], id: string, extra: Partial<FunnelNode> | FunnelNode[] = {}): FunnelNode {
  const details = Array.isArray(extra) ? { children: extra } : extra;
  return { schemaVersion: 1, id, type, props: {}, style: {}, overrides: {}, visible: true, actions: [], attributes: {}, ...details };
}

function documentWith(nodes: FunnelNode[]): PageDocument {
  return {
    ...createEmptyPageDocument("renderer-test", "渲染測試"),
    root: [node("section", "section", [node("row", "row", nodes)])],
  };
}

describe("FunnelPageDocumentRenderer", () => {
  it("renders the supported Section/Row/Column/Element hierarchy with safe attributes", () => {
    const page = documentWith([
      node("columns_2", "columns", { children: [node("text", "text", { props: { text: "歡迎來到 CelebrateDeal" }, attributes: { id: "hero-copy", "data-testid": "copy" } })] }),
    ]);
    const html = renderToStaticMarkup(<FunnelPageDocumentRenderer document={page} mode="editor" selectedNodeId="text" />);
    expect(html).toContain("歡迎來到 CelebrateDeal");
    expect(html).toContain('data-funnel-node-id="text"');
    expect(html).toContain('data-funnel-selected="true"');
    expect(html).toContain('id="hero-copy"');
    expect(html).toContain('data-testid="copy"');
  });

  it("applies base plus mobile overrides without duplicating the page tree", () => {
    const text = node("text", "responsive-text", { props: { text: "響應式內容" }, style: { fontSize: 40, padding: 24 }, overrides: { mobile: { style: { fontSize: 18, padding: 8 }, visible: true } } });
    const page = documentWith([text]);
    const desktop = renderToStaticMarkup(<FunnelPageDocumentRenderer document={page} viewport="desktop" />);
    const mobile = renderToStaticMarkup(<FunnelPageDocumentRenderer document={page} viewport="mobile" />);
    expect(desktop).toContain("font-size:40px");
    expect(desktop).toContain("padding:24px");
    expect(mobile).toContain("font-size:18px");
    expect(mobile).toContain("padding:8px");
    expect(mobile.match(/響應式內容/g)).toHaveLength(1);
  });

  it("never executes raw HTML, payment, or reCAPTCHA nodes and exposes their capability state", () => {
    const page = documentWith([
      node("raw_html", "raw", { props: { html: "<script>window.pwned=true</script>" } }),
      node("payment_button", "payment"),
      node("recaptcha", "captcha"),
    ]);
    const html = renderToStaticMarkup(<FunnelPageDocumentRenderer document={page} />);
    expect(html).not.toContain("<script>");
    expect(html).not.toContain("window.pwned");
    expect(html).toContain("原始 HTML");
    expect(html).toContain("尚未連結商品與付款方式");
    expect(html).toContain("reCAPTCHA");
    expect(html).toContain("待驗證");
  });

  it("allows only validated HTTPS or same-site action hrefs", () => {
    const page = documentWith([
      node("button", "safe-button", { props: { label: "安全連結" }, actions: [{ type: "open_url", href: "https://example.com/offer", newTab: true }] }),
      node("button", "unsafe-button", { props: { label: "不安全連結", action: { type: "open_url", href: "javascript:alert(1)", newTab: false } } }),
    ]);
    const html = renderToStaticMarkup(<FunnelPageDocumentRenderer document={page} />);
    expect(html).toContain('href="https://example.com/offer"');
    expect(html).toContain('target="_blank"');
    expect(html).not.toContain("javascript:");
    expect(html).toContain('disabled=""');
  });
});
