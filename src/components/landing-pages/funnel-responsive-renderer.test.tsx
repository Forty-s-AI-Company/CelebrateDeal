import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { createEmptyPageDocument, parsePageDocument, type FunnelNode, type PageDocument } from "@/lib/funnel-page-document";
import { funnelHeadingSize, resolveFunnelTypography } from "@/lib/funnel-typography";
import { FunnelPageDocumentRenderer, funnelColumnsLayout, resolveFunnelNode, type FunnelSubmissionContext } from "./funnel-page-document-renderer";
import { PublicFunnelDocument } from "./public-funnel-document";

const n = (id: string, type: FunnelNode["type"], props: Record<string, unknown> = {}, children?: FunnelNode[], extra: Partial<FunnelNode> = {}): FunnelNode => ({ schemaVersion: 1, id, type, props, style: {}, overrides: {}, visible: true, actions: [], attributes: {}, ...(children ? { children } : {}), ...extra });
const page = (rowChildren: FunnelNode[], settings: Partial<PageDocument["settings"]> = {}): PageDocument => {
  const empty = createEmptyPageDocument("responsive", "響應式");
  return { ...empty, settings: { ...empty.settings, ...settings }, root: [n("s", "section", {}, [n("r", "row", {}, rowChildren)])] };
};

describe("tablet breakpoint (I-1)", () => {
  it("applies desktop then tablet overrides on tablet, and only its own override elsewhere", () => {
    const node = n("t", "text", { text: "base" }, undefined, { overrides: { desktop: { props: { text: "desktop" }, style: { fontSize: 30 } }, tablet: { props: { text: "tablet" } }, mobile: { visible: false } } });
    expect(resolveFunnelNode(node, "tablet")).toMatchObject({ props: { text: "tablet" }, style: { fontSize: 30 }, visible: true });
    expect(resolveFunnelNode(node, "desktop").props.text).toBe("desktop");
    expect(resolveFunnelNode(node, "mobile")).toMatchObject({ props: { text: "base" }, visible: false });
    expect(parsePageDocument(page([node]))).not.toBeNull();
  });

  it("drops 3–4 columns to 2 on tablet, honours the 2-column ratio and tablet stacking, and reverses stacked order", () => {
    expect(funnelColumnsLayout("columns_4", {}, "tablet").template).toBe("repeat(2, minmax(0, 1fr))");
    expect(funnelColumnsLayout("columns_3", {}, "desktop").template).toBe("repeat(3, minmax(0, 1fr))");
    expect(funnelColumnsLayout("columns_2", { ratio: "7:5" }, "desktop").template).toBe("minmax(0, 7fr) minmax(0, 5fr)");
    expect(funnelColumnsLayout("columns_2", { ratio: "7:5", stackOn: "tablet" }, "tablet")).toEqual({ template: "minmax(0, 1fr)", stacked: true, reversed: false });
    expect(funnelColumnsLayout("columns_2", { mobileOrder: "reverse" }, "mobile").reversed).toBe(true);
    expect(funnelColumnsLayout("columns_2", { mobileOrder: "reverse" }, "desktop").reversed).toBe(false);
    const doc = page([n("c", "columns_2", { mobileOrder: "reverse" }, [n("a", "text", { text: "文案欄" }), n("b", "text", { text: "表單欄" })])]);
    const mobile = renderToStaticMarkup(<FunnelPageDocumentRenderer document={doc} viewport="mobile" />);
    expect(mobile.indexOf("表單欄")).toBeLessThan(mobile.indexOf("文案欄"));
    const desktop = renderToStaticMarkup(<FunnelPageDocumentRenderer document={doc} viewport="desktop" />);
    expect(desktop.indexOf("文案欄")).toBeLessThan(desktop.indexOf("表單欄"));
  });

  it("scales headings between mobile and desktop on tablet", () => {
    const settings = createEmptyPageDocument().settings;
    const sizes = (["mobile", "tablet", "desktop"] as const).map((viewport) => funnelHeadingSize("h1", resolveFunnelTypography(settings, viewport)));
    expect(sizes).toEqual([32, 40, 48]);
  });

  it("uses the server viewport hint for the first public render", () => {
    const doc = page([n("c", "columns_3", {}, [n("a", "text"), n("b", "text"), n("x", "text")])]);
    expect(renderToStaticMarkup(<PublicFunnelDocument document={doc} initialViewport="tablet" />)).toContain('data-viewport="tablet"');
    expect(renderToStaticMarkup(<PublicFunnelDocument document={doc} initialViewport="mobile" />)).toContain("grid-template-columns:minmax(0, 1fr)");
    expect(renderToStaticMarkup(<PublicFunnelDocument document={doc} />)).toContain('data-viewport="desktop"');
  });
});

describe("page chrome (I-2, I-3, I-4, I-5)", () => {
  const sticky = { stickyCta: { enabled: true, label: "免費報名", showDate: true, devices: "mobile_tablet" as const } };

  it("renders the sticky CTA outside the content (and the custom-CSS shell) only on public mobile/tablet renders", () => {
    const doc = page([n("h", "headline", { text: "標題" })], { ...sticky, customCss: "[data-funnel-content] h1 { color: red; }" });
    const mobile = renderToStaticMarkup(<FunnelPageDocumentRenderer document={doc} viewport="mobile" publicSurface />);
    const content = mobile.slice(mobile.indexOf("<main"), mobile.indexOf("</main>"));
    expect(mobile).toContain("data-funnel-sticky-cta");
    expect(content).not.toContain("data-funnel-sticky-cta");
    expect(mobile.indexOf("data-funnel-sticky-cta")).toBeGreaterThan(mobile.indexOf("</main></div>"));
    expect(mobile).toContain("免費報名");
    expect(mobile).toContain("safe-area-inset-bottom");
    expect(renderToStaticMarkup(<FunnelPageDocumentRenderer document={doc} viewport="desktop" publicSurface />)).not.toContain("data-funnel-sticky-cta");
    const editor = renderToStaticMarkup(<FunnelPageDocumentRenderer document={doc} viewport="mobile" mode="editor" />);
    expect(editor).not.toContain("data-funnel-sticky-cta");
    expect(editor).toContain("data-funnel-sticky-preview");
  });

  it("server markup never starts hidden for scroll reveal, and the font variables sit on the page root", () => {
    const html = renderToStaticMarkup(<FunnelPageDocumentRenderer document={page([n("h", "headline", { text: "標題" })], { scrollReveal: "rise" })} />);
    expect(html).not.toContain("data-funnel-reveal");
    expect(html).toMatch(/class="(?:[^"]* )?funnel-font-vars[ "]/u);
    expect(html).toContain("line-break:strict");
  });

  it("resolves dynamic event fields in text, headlines and buttons", () => {
    const html = renderToStaticMarkup(<FunnelPageDocumentRenderer document={page([n("h", "headline", { text: "{{webinar.title}}" }), n("t", "text", { text: "開播：{{webinar.startAt}}" })], { eventTitle: "AI 講座" })} />);
    expect(html).toContain("AI 講座");
    expect(html).toContain("開播：時間公布中");
  });
});

describe("designed public form (C-19 minimum)", () => {
  const submission: FunnelSubmissionContext = {
    form: { id: "owned_form", fields: [{ key: "name", label: "姓名", type: "text", required: true }, { key: "email", label: "電子信箱", type: "email", required: true }, { key: "phone", label: "電話", type: "tel", required: false }], submitLabel: "送出", successMessage: "完成" },
    landingPageId: "page_1",
  };
  const form = n("f", "form", {}, [
    n("f_title", "headline", { text: "保留我的席位", level: "h3" }),
    n("f_name", "form_input", { name: "name", label: "您的姓名", placeholder: "王小明" }),
    n("f_email", "form_input", { inputType: "email", label: "常用 Email", helpText: "直播連結會寄到這裡", width: "half" }),
    n("f_consent", "checkbox", { label: "我同意收到講座通知", required: true }),
    n("f_submit", "button", { label: "免費報名直播" }, undefined, { style: { backgroundColor: "#4f46e5", color: "#ffffff" }, actions: [{ type: "submit_form" }] }),
    n("f_note", "text", { text: "可隨時取消訂閱", textStyle: "small" }),
  ]);

  it("keeps the server form's keys, labels, types and submit text, and takes hints, button style and consent text from the page", () => {
    const html = renderToStaticMarkup(<FunnelPageDocumentRenderer document={page([form])} submission={submission} publicSurface />);
    expect(html).toContain("姓名 *</label>");
    expect(html).not.toContain("您的姓名");
    expect(html).toContain('placeholder="王小明"');
    expect(html).toContain("電子信箱 *</label>");
    expect(html).toContain("直播連結會寄到這裡");
    expect(html).toContain('name="email"');
    expect(html).toContain('type="email"');
    expect(html).toContain("電話<span");
    expect(html).toContain("（選填）");
    expect(html).toContain("我同意依本頁說明提交並使用上述資料。");
    expect(html).not.toContain("我同意收到講座通知");
    expect(html).toContain(">送出</button>");
    expect(html).toContain("background-color:#4f46e5");
    expect(html.indexOf("保留我的席位")).toBeLessThan(html.indexOf("姓名 *</label>"));
    expect(html.indexOf(">送出</button>")).toBeLessThan(html.indexOf("可隨時取消訂閱"));
    expect(html).toContain('value="owned_form"');
    expect(html).not.toContain("bg-amber-500");
  });

  it("keeps the previous plain form for a form node without children", () => {
    const html = renderToStaticMarkup(<FunnelPageDocumentRenderer document={page([n("f", "form", {}, [])])} submission={submission} publicSurface />);
    expect(html).toContain("bg-amber-500");
    expect(html).toContain("送出");
  });
});
