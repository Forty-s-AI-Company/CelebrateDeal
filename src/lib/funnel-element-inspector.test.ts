import { describe, expect, it } from "vitest";

import {
  FUNNEL_ELEMENT_INSPECTOR_SCHEMA,
  createFunnelInspectorActionUpdate,
  createFunnelInspectorUpdate,
  getFunnelInspectorFieldValue,
  sanitizeFunnelHtmlId,
  type FunnelInspectorField,
} from "@/lib/funnel-element-inspector";
import { FUNNEL_NODE_TYPES, type FunnelNode } from "@/lib/funnel-page-document";

function node(type: FunnelNode["type"] = "text"): FunnelNode {
  return { schemaVersion: 1, id: "text_1", type, props: { text: "原始文字", items: ["第一項"] }, style: { fontSize: 18 }, overrides: {}, visible: true, actions: [], attributes: {} };
}

function field(type: FunnelNode["type"], id: string): FunnelInspectorField {
  const candidate = FUNNEL_ELEMENT_INSPECTOR_SCHEMA[type].fields.find((item) => item.id === id);
  if (!candidate) throw new Error(`missing inspector field ${type}.${id}`);
  return candidate;
}

describe("Funnel element inspector schema", () => {
  it("為 registry 的每個 Element 提供 inspector 定義，且保留受限制能力說明", () => {
    expect(Object.keys(FUNNEL_ELEMENT_INSPECTOR_SCHEMA).sort()).toEqual([...FUNNEL_NODE_TYPES].sort());
    expect(FUNNEL_ELEMENT_INSPECTOR_SCHEMA.text.fields.some((item) => item.group === "content" && item.id === "text")).toBe(true);
    expect(FUNNEL_ELEMENT_INSPECTOR_SCHEMA.payment_button.capabilityNote).toContain("付款");
    // 自訂程式碼：HTML／CSS／JS 三個等寬程式碼欄位，只編輯基礎值並有伺服器同樣強制的大小上限。
    const codeFields = FUNNEL_ELEMENT_INSPECTOR_SCHEMA.raw_html.fields.filter((item) => item.kind === "code");
    expect(codeFields.map((item) => [item.id, item.maxBytes, item.responsive])).toEqual([["html", 50_000, false], ["css", 20_000, false], ["js", 50_000, false]]);
    expect(FUNNEL_ELEMENT_INSPECTOR_SCHEMA.raw_html.capabilityNote).toBeUndefined();
  });

  it("將基礎值與手機覆寫輸出為結構化 update command，不建立第二份頁面", () => {
    const candidate = node();
    const base = createFunnelInspectorUpdate(candidate, "base", field("text", "text"), "更新後文字");
    const mobile = createFunnelInspectorUpdate(candidate, "mobile", field("text", "fontSize"), 14);
    const visibility = createFunnelInspectorUpdate(candidate, "desktop", field("text", "visible"), false);

    expect(base).toEqual({ type: "update", nodeId: "text_1", patch: { props: { text: "更新後文字" } } });
    expect(mobile).toEqual({ type: "update", nodeId: "text_1", patch: { overrides: { mobile: { style: { fontSize: 14 } } } } });
    expect(visibility).toEqual({ type: "update", nodeId: "text_1", patch: { overrides: { desktop: { visible: false } } } });
  });

  it("整理清單並拒絕超出 schema 範圍的數字", () => {
    const candidate = node("bulleted_list");
    const listUpdate = createFunnelInspectorUpdate(candidate, "base", field("bulleted_list", "items"), "第一項\n\n 第二項 ");
    const invalidSize = createFunnelInspectorUpdate(node(), "base", field("text", "fontSize"), 999);

    expect(listUpdate).toEqual({ type: "update", nodeId: "text_1", patch: { props: { items: ["第一項", "第二項"] } } });
    expect(invalidSize).toBeNull();
  });

  it("HTML ID 僅接受安全識別碼，且可以清除既有值", () => {
    const candidate = { ...node(), attributes: { id: "old-id" } };
    expect(sanitizeFunnelHtmlId("offer_hero-1")).toBe("offer_hero-1");
    expect(sanitizeFunnelHtmlId("onload=alert(1)")).toBeNull();
    expect(createFunnelInspectorUpdate(candidate, "base", field("text", "id"), "onload=alert(1)")).toBeNull();
    expect(createFunnelInspectorUpdate(candidate, "base", field("text", "id"), "")).toEqual({ type: "update", nodeId: "text_1", patch: { attributes: {} } });
  });

  it("動作拒絕 javascript URL，並接受 Popup 與 HTTPS 動作", () => {
    const candidate = node("button");
    expect(createFunnelInspectorActionUpdate(candidate, { type: "open_url", href: "javascript:alert(1)" })).toBeNull();
    expect(createFunnelInspectorActionUpdate(candidate, { type: "show_popup", popupId: "welcome_popup" })).toEqual({ type: "update", nodeId: "text_1", patch: { actions: [{ type: "show_popup", popupId: "welcome_popup" }] } });
    expect(createFunnelInspectorActionUpdate(candidate, { type: "open_url", href: "https://example.com", newTab: true })).toEqual({ type: "update", nodeId: "text_1", patch: { actions: [{ type: "open_url", href: "https://example.com", newTab: true }] } });
  });

  it.each(["/\\evil.example", "/\\\\evil.example", "/\t/evil.example", "/.//evil.example", "https://app.example@evil.example", "JaVaScRiPt:alert(1)"])("動作與選單拒絕會導向站外的網址 %s", (href) => {
    const candidate = node("button");
    expect(createFunnelInspectorActionUpdate(candidate, { type: "open_url", href })).toBeNull();
    expect(createFunnelInspectorActionUpdate(candidate, { type: "download", href })).toBeNull();
    const menu = createFunnelInspectorUpdate(node("menu"), "base", field("menu", "items"), `首頁 | /\n不安全 | ${href}`);
    expect(menu).toEqual({ type: "update", nodeId: "text_1", patch: { props: { items: [{ label: "首頁", href: "/" }, { label: "不安全", href: "#" }] } } });
  });

  it("動作接受站內路徑、錨點與 HTTPS", () => {
    for (const href of ["/lp/shop/order?utm_source=line#pricing", "#pricing", "https://example.com/offer"]) {
      expect(createFunnelInspectorActionUpdate(node("button"), { type: "open_url", href, newTab: false })).toEqual({ type: "update", nodeId: "text_1", patch: { actions: [{ type: "open_url", href, newTab: false }] } });
    }
  });

  it("讀取時先沿用基礎值，再套用手機覆寫", () => {
    const candidate = { ...node(), overrides: { mobile: { style: { fontSize: 14 }, props: { text: "手機文案" }, visible: false } } };
    expect(getFunnelInspectorFieldValue(candidate, "desktop", field("text", "fontSize"))).toBe(18);
    expect(getFunnelInspectorFieldValue(candidate, "mobile", field("text", "fontSize"))).toBe(14);
    expect(getFunnelInspectorFieldValue(candidate, "mobile", field("text", "text"))).toBe("手機文案");
    expect(getFunnelInspectorFieldValue(candidate, "mobile", field("text", "visible"))).toBe(false);
  });
});
