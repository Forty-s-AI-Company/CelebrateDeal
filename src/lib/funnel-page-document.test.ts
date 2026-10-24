import { describe, expect, it } from "vitest";

import {
  FUNNEL_CAPABILITIES,
  FUNNEL_NODE_REGISTRY,
  PageDocumentSchema,
  createEmptyPageDocument,
  deserializePageDocument,
  parsePageDocument,
  serializePageDocument,
  type FunnelNode,
  type PageDocument,
} from "@/lib/funnel-page-document";
import { createFunnelFlow } from "@/lib/funnel-flow";

function node(type: FunnelNode["type"], id: string, children?: FunnelNode[]): FunnelNode {
  return { schemaVersion: 1, id, type, props: {}, style: {}, overrides: {}, visible: true, actions: [], attributes: {}, ...(children ? { children } : {}) } as FunnelNode;
}

function starter(): PageDocument {
  return {
    ...createEmptyPageDocument("page_1", "測試頁面"),
    root: [node("section", "section_1", [node("row", "row_1", [node("columns_2", "columns_1", [node("text", "text_1")])])])],
  };
}

describe("Funnel PageDocument v1", () => {
  it("建立明確的 v1 空文件與 registry", () => {
    const document = createEmptyPageDocument();
    expect(PageDocumentSchema.safeParse(document).success).toBe(true);
    expect(FUNNEL_NODE_REGISTRY.text.allowedParents).toContain("columns_2");
    expect(FUNNEL_NODE_REGISTRY.payment_button.capability.status).toBe("limited");
    expect(FUNNEL_CAPABILITIES.rawHtml.status).toBe("disabled");
  });

  it("驗證 Section > Row > Column > Element 並拒絕非法父子關係", () => {
    expect(parsePageDocument(starter())).not.toBeNull();
    const invalid = starter();
    invalid.root[0]!.children![0]!.children![0]!.children = [node("section", "nested_section")];
    expect(parsePageDocument(invalid)).toBeNull();
    const orphan = starter();
    orphan.root[0]!.children![0]!.children![0]!.children = [node("text", "first"), node("text", "first")];
    expect(parsePageDocument(orphan)).toBeNull();
  });

  it("支援 base/desktop/mobile override 且 round-trip 不遺失", () => {
    const document = starter();
    const text = document.root[0]!.children![0]!.children![0]!.children![0]!;
    text.style = { fontSize: 40, padding: 24 };
    text.overrides = { desktop: { style: { fontSize: 40 } }, mobile: { style: { fontSize: 34, padding: 12 }, visible: false } };
    const restored = deserializePageDocument(serializePageDocument(document));
    expect(restored?.root[0]?.children?.[0]?.children?.[0]?.children?.[0]).toMatchObject({ style: { fontSize: 40 }, overrides: { mobile: { visible: false, style: { fontSize: 34, padding: 12 } } } });
  });

  it("將 Funnel goal 與 steps 隨 PageDocument 一起保存並還原", () => {
    const document = starter();
    document.flow = createFunnelFlow({ id: "flow_1", name: "名單流程", goal: "audience", domain: "audience-flow", currency: "TWD" }) ?? undefined;
    const restored = deserializePageDocument(serializePageDocument(document));
    expect(restored?.flow?.goal).toBe("audience");
    expect(restored?.flow?.steps.map((step) => step.type)).toEqual(["opt_in_page", "opt_in_thank_you_page", "inactive_page"]);
  });

  it("popup、頁面設定與限制功能具有可見 capability status", () => {
    const document = starter();
    document.popups = [{ schemaVersion: 1, id: "popup_1", name: "歡迎視窗", settings: { openAutomatically: true, automaticDelaySeconds: 1, showCloseButton: true, openOnExitIntent: false, backgroundColor: "white", padding: 24, cornerRadius: 6, borderStyle: "solid", borderColor: "#e2e8f0", borderWidth: 1, shadow: "soft" }, root: [], capabilities: { exitIntent: FUNNEL_CAPABILITIES.exitIntent } }];
    document.settings = { ...document.settings, tracking: FUNNEL_CAPABILITIES.tracking, affiliate: FUNNEL_CAPABILITIES.affiliate };
    expect(parsePageDocument(document)).not.toBeNull();
    expect(deserializePageDocument(JSON.stringify({ ...document, root: [{ ...document.root[0], type: "raw_html", children: undefined }] }))).toBeNull();
  });

  it("序列化與反序列化對不合法 JSON fail closed", () => {
    expect(deserializePageDocument("{")).toBeNull();
    expect(deserializePageDocument(JSON.stringify({ schemaVersion: 1 }))).toBeNull();
    expect(() => serializePageDocument({ ...starter(), root: [{ ...starter().root[0], type: "text" }] })).toThrow();
  });

  it("拒絕循環引用與重複 HTML id", () => {
    const cyclic = node("section", "cyclic", []);
    cyclic.children!.push(cyclic);
    expect(parsePageDocument({ ...starter(), root: [cyclic] })).toBeNull();

    const duplicateHtmlId = starter();
    const column = duplicateHtmlId.root[0]!.children![0]!.children![0]!;
    column.children = [
      { ...node("text", "text_a"), attributes: { id: "offer" } },
      { ...node("text", "text_b"), attributes: { id: "offer" } },
    ];
    expect(parsePageDocument(duplicateHtmlId)).toBeNull();
  });

  it("拒絕會干擾 React renderer 的保留 HTML 屬性", () => {
    const document = starter();
    document.root[0]!.attributes = { style: "color:red" };
    expect(parsePageDocument(document)).toBeNull();
    document.root[0]!.attributes = { dangerouslySetInnerHTML: "x" };
    expect(parsePageDocument(document)).toBeNull();
  });
});

describe("PageDocument 連結安全", () => {
  const OFF_SITE = ["/\\evil.example", "/\\\\evil.example", "/\\/evil.example", "https://app.example@evil.example", `/${String.fromCodePoint(0x202e)}evil.example`];

  function withButton(actions: unknown[]): PageDocument {
    const document = starter();
    document.root[0]!.children![0]!.children![0]!.children = [{ ...node("button", "button_1"), actions } as FunnelNode];
    return document;
  }
  const buttonOf = (document: PageDocument) => document.root[0]!.children![0]!.children![0]!.children![0]!;

  it("保留合法的站內路徑、錨點與 HTTPS 連結", () => {
    const actions = [{ type: "open_url", href: "/lp/shop/order?utm_source=line#pricing", newTab: false }];
    expect(buttonOf(parsePageDocument(withButton(actions))!).actions).toEqual(actions);
    expect(buttonOf(parsePageDocument(withButton([{ type: "open_url", href: "#pricing", newTab: false }]))!).actions).toHaveLength(1);
    expect(buttonOf(parsePageDocument(withButton([{ type: "download", href: "https://cdn.example.com/a.pdf" }]))!).actions).toEqual([{ type: "download", href: "https://cdn.example.com/a.pdf" }]);
  });

  it.each(OFF_SITE)("舊資料中會導向站外的連結 %s 在讀取時被移除，頁面仍可顯示", (href) => {
    const parsed = parsePageDocument(withButton([{ type: "open_url", href, newTab: true }, { type: "download", href }]));
    expect(parsed).not.toBeNull();
    expect(buttonOf(parsed!).actions).toEqual([]);
    expect(JSON.stringify(parsed)).not.toContain("evil.example");
  });

  it("舊資料中不安全的背景圖與分享圖片在讀取時被移除", () => {
    const document = starter();
    const parsed = parsePageDocument({ ...document, settings: { ...document.settings, background: { color: "white", blur: 0, imageUrl: "/\\evil.example/bg.png" }, seo: { hideFromSearch: false, socialImage: "/\\evil.example/og.png" } } });
    expect(parsed).not.toBeNull();
    expect(parsed!.settings.background.imageUrl).toBeUndefined();
    expect(parsed!.settings.seo.socialImage).toBeUndefined();
    expect(serializePageDocument(parsed!)).not.toContain("evil.example");
  });

  it.each(["javascript:alert(1)", "//evil.example", "data:text/html,x", `/${"\t"}/evil.example`])("先前就拒絕的連結 %s 仍讓整份文件驗證失敗", (href) => {
    expect(parsePageDocument(withButton([{ type: "open_url", href, newTab: false }]))).toBeNull();
  });
});
