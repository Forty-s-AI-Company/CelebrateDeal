// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it } from "vitest";

import { FunnelPageDocumentRenderer } from "@/components/landing-pages/funnel-page-document-renderer";
import { FunnelElementInspector } from "@/components/landing-pages/funnel-element-inspector";
import { createFunnelInspectorUpdate, getFunnelElementInspectorDefinition } from "@/lib/funnel-element-inspector";
import { createEmptyPageDocument, parsePageDocument, type FunnelNode, type FunnelNodeType, type PageDocument } from "@/lib/funnel-page-document";
import { funnelShowcaseDefaultProps } from "@/lib/funnel-showcase-defaults";
import { findFunnelContrastIssues } from "@/lib/funnel-design-contrast";
import { instantiateFunnelTemplate, previewFunnelTemplate } from "@/lib/funnel-template-gallery";

const SHOWCASE_TYPES: FunnelNodeType[] = ["nav_bar", "logo_strip", "stats", "icon_list", "shape_divider", "section_title", "image_cards", "testimonial_wall", "content_cards", "video_gallery"];

function node(type: FunnelNodeType, id: string, props: Record<string, unknown> = {}, children?: FunnelNode[], style: FunnelNode["style"] = {}): FunnelNode {
  return { schemaVersion: 1, id, type, props, style, overrides: {}, visible: true, actions: [], attributes: {}, ...(children ? { children } : {}) };
}

function page(nodes: FunnelNode[], sectionProps: Record<string, unknown> = {}): PageDocument {
  return { ...createEmptyPageDocument("showcase-test", "展示元件"), root: [node("section", "section", sectionProps, [node("row", "row", {}, nodes)])] };
}

let root: Root | null = null;
let host: HTMLDivElement | null = null;
function mount(document: PageDocument) {
  host = window.document.createElement("div");
  window.document.body.append(host);
  root = createRoot(host);
  act(() => root!.render(<FunnelPageDocumentRenderer document={document} mode="preview" />));
  return host;
}
afterEach(() => { act(() => root?.unmount()); host?.remove(); root = null; host = null; });

describe("funnel showcase elements", () => {
  it.each(SHOWCASE_TYPES)("%s 用元件庫預設內容就能通過驗證並渲染（編輯器與預覽）", (type) => {
    const element = node(type, `${type}_1`, funnelShowcaseDefaultProps(type) ?? {});
    const document = type === "nav_bar" || type === "shape_divider"
      ? { ...createEmptyPageDocument("p", "p"), root: [element] }
      : page([element]);
    expect(parsePageDocument(document)).not.toBeNull();
    for (const mode of ["editor", "preview"] as const) {
      const html = renderToStaticMarkup(<FunnelPageDocumentRenderer document={document} mode={mode} />);
      expect(html).toContain(`data-funnel-node-type="${type}"`);
      expect(html).not.toContain("data-funnel-capability");
      expect(html).not.toMatch(/javascript:|<script/iu);
    }
    expect(getFunnelElementInspectorDefinition(type).fields.length).toBeGreaterThan(3);
  });

  it("影片牆在按下播放前不載入任何 iframe，按下後只用 youtube-nocookie", () => {
    const container = mount(page([node("video_gallery", "videos", { items: [{ url: "https://youtu.be/dQw4w9WgXcQ", title: "講座" }, { url: "https://videos.example/1", title: "外部" }] })]));
    expect(container.querySelector("iframe")).toBeNull();
    const external = container.querySelector<HTMLAnchorElement>('a[aria-label="在新分頁觀看：外部"]');
    expect(external?.target).toBe("_blank");
    expect(external?.rel).toContain("noopener");
    act(() => container.querySelector<HTMLButtonElement>('button[aria-label="播放影片：講座"]')!.click());
    const iframe = container.querySelector("iframe");
    expect(iframe?.getAttribute("src")).toMatch(/^https:\/\/www\.youtube-nocookie\.com\/embed\/dQw4w9WgXcQ\?/u);
    expect(iframe?.getAttribute("sandbox")).toContain("allow-scripts");
    expect(iframe?.title).toBe("講座");
  });

  it("編輯器畫布上的影片不會播放", () => {
    host = window.document.createElement("div");
    window.document.body.append(host);
    root = createRoot(host);
    act(() => root!.render(<FunnelPageDocumentRenderer document={page([node("video_gallery", "videos", { items: [{ url: "https://youtu.be/dQw4w9WgXcQ", title: "講座" }] })])} mode="editor" />));
    act(() => host!.querySelector<HTMLButtonElement>("button[aria-label^='播放影片']")!.click());
    expect(host.querySelector("iframe")).toBeNull();
  });

  it("導覽列：下拉選單可用按鈕與 Escape 操作，手機漢堡選單可開關", () => {
    const container = mount({ ...createEmptyPageDocument("p", "p"), root: [node("nav_bar", "nav", funnelShowcaseDefaultProps("nav_bar")!)] });
    const trigger = container.querySelector<HTMLButtonElement>("button[aria-controls$='-menu-1']")!;
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
    act(() => trigger.click());
    expect(trigger.getAttribute("aria-expanded")).toBe("true");
    expect(container.querySelector(`#${CSS.escape(trigger.getAttribute("aria-controls")!)}`)?.hasAttribute("hidden")).toBe(false);
    act(() => { window.document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" })); });
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
    const toggle = container.querySelector<HTMLButtonElement>("button[aria-label='開啟選單']")!;
    act(() => toggle.click());
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    expect(container.querySelector(`#${CSS.escape(toggle.getAttribute("aria-controls")!)}`)?.hasAttribute("hidden")).toBe(false);
  });

  it("導覽列在預覽與公開頁固定於頂端，編輯畫布不固定", () => {
    const document = { ...createEmptyPageDocument("p", "p"), root: [node("nav_bar", "nav", { brand: "品牌" })] };
    expect(renderToStaticMarkup(<FunnelPageDocumentRenderer document={document} mode="preview" />)).toContain("position:sticky");
    expect(renderToStaticMarkup(<FunnelPageDocumentRenderer document={document} mode="editor" />)).not.toContain("position:sticky");
  });

  it("評價牆可暫停，第二份輪播內容對輔助科技隱藏", () => {
    const items = Array.from({ length: 6 }, (_, index) => ({ name: `學員 ${index}`, text: "內容", rating: 5, verified: index === 0 }));
    const container = mount(page([node("testimonial_wall", "wall", { items, rows: 2 })]));
    const pause = container.querySelector<HTMLButtonElement>("button[aria-pressed]")!;
    expect(pause.textContent).toContain("暫停輪播");
    act(() => pause.click());
    expect(pause.getAttribute("aria-pressed")).toBe("true");
    expect(container.querySelectorAll(".funnel-marquee[data-paused='true']")).toHaveLength(2);
    const copies = container.querySelectorAll(".funnel-marquee-track > [aria-hidden]");
    expect(copies).toHaveLength(2);
    expect(container.querySelector("[aria-label='已驗證']")).not.toBeNull();
    expect(container.querySelector("[aria-label='5 顆星（滿分 5 顆）']")).not.toBeNull();
  });

  it("數據統計在伺服器渲染時直接輸出最終數字，螢幕閱讀器讀到完整數值", () => {
    const html = renderToStaticMarkup(<FunnelPageDocumentRenderer document={page([node("stats", "stats", { items: [{ value: "12800", suffix: "+", label: "學員" }] })])} />);
    expect(html).toContain("12,800");
    expect(html).toContain('<span class="sr-only">12,800+</span>');
  });

  it("區段背景圖只接受安全網址，內容盒可加金框裝飾", () => {
    const safe = renderToStaticMarkup(<FunnelPageDocumentRenderer document={page([node("text", "t", { text: "文字" })], { backgroundImage: "/funnel-illustrations/luxury/ocean-night.svg", overlayOpacity: 50, overlayFade: "right" })} />);
    expect(safe).toContain("data-funnel-section-background");
    expect(safe).toContain("linear-gradient(to right");
    for (const unsafe of ["javascript:alert(1)", "https://x.example/a.png) , url(https://evil.example", "//evil.example/a.png"]) {
      const html = renderToStaticMarkup(<FunnelPageDocumentRenderer document={page([node("text", "t", { text: "文字" })], { backgroundImage: unsafe })} />);
      expect(html, unsafe).not.toContain("data-funnel-section-background");
    }
    const framed = renderToStaticMarkup(<FunnelPageDocumentRenderer document={page([node("content_box", "box", { decoration: "frame" }, [node("text", "t", { text: "文字" })], { padding: 40 })])} />);
    expect(framed).toContain("inset:10px");
  });

  it("屬性面板的項目清單只保留宣告的欄位並轉成正確型別", () => {
    const wall = node("testimonial_wall", "wall", { items: [] });
    const field = getFunnelElementInspectorDefinition("testimonial_wall").fields.find((candidate) => candidate.id === "items")!;
    const command = createFunnelInspectorUpdate(wall, "base", field, [{ name: "A", rating: "9", verified: "yes", injected: "<script>", text: "好" }]);
    expect(command).toEqual({ type: "update", nodeId: "wall", patch: { props: { items: [{ name: "A", rating: 5, verified: false, text: "好" }] } } });
    const color = getFunnelElementInspectorDefinition("stats").fields.find((candidate) => candidate.id === "accentColor")!;
    expect(createFunnelInspectorUpdate(wall, "base", color, "red;background:url(x)")).toBeNull();
    expect(createFunnelInspectorUpdate(wall, "base", color, "#C9A063")).toEqual({ type: "update", nodeId: "wall", patch: { props: { accentColor: "#c9a063" } } });
    const html = renderToStaticMarkup(<FunnelElementInspector node={node("logo_strip", "logos", funnelShowcaseDefaultProps("logo_strip")!)} onCommand={() => undefined} />);
    expect(html).toContain("新增Logo");
    expect(html).toContain("上移Logo 1");
  });

  it("黑金範本：主題字型與配色、文字對比達 AA、圖片都在站內", () => {
    const document = previewFunnelTemplate("custom-luxury-course");
    expect(document.settings.typography).toMatchObject({ headingFont: "serif-tc", bodyFont: "sans-tc", linkColor: "#c9a063" });
    expect(document.settings.background.color).toBe("#0b0b0c");
    expect(findFunnelContrastIssues(document)).toEqual([]);
    const json = JSON.stringify(instantiateFunnelTemplate("custom-luxury-course").root);
    const sources = [...json.matchAll(/"(?:src|avatar|thumbnail|backgroundImage)":"([^"]*)"/gu)].map((match) => match[1]!);
    expect(sources.length).toBeGreaterThan(10);
    expect(sources.every((src) => src.startsWith("/funnel-illustrations/luxury/"))).toBe(true);
    for (const type of SHOWCASE_TYPES) expect(json, type).toContain(`"type":"${type}"`);
  });
});
