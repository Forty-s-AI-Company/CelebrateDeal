import { describe, expect, it } from "vitest";
import { FUNNEL_INLINE_TEXT_MAX_LENGTH, funnelInlineField, funnelInlineTextCommand, isFunnelInlineEditable, sanitizeFunnelInlineText } from "./funnel-inline-text";
import { createEmptyPageDocument, type FunnelNode } from "./funnel-page-document";
import { createFunnelPageHistory, dispatchFunnelPageCommand, redoFunnelPageHistory, undoFunnelPageHistory } from "./funnel-page-history";

const node = (id: string, type: FunnelNode["type"], props: Record<string, unknown> = {}, overrides: FunnelNode["overrides"] = {}): FunnelNode => ({ schemaVersion: 1, id, type, props, style: {}, overrides, visible: true, actions: [], attributes: {} });

describe("funnelInlineField", () => {
  it("maps editable node types to the prop they write", () => {
    expect(funnelInlineField("text")).toEqual({ key: "text", multiline: true });
    expect(funnelInlineField("headline")).toEqual({ key: "text", multiline: false });
    expect(funnelInlineField("button")).toEqual({ key: "label", multiline: false });
    expect(funnelInlineField("bulleted_list", 2)).toEqual({ key: "items", multiline: false, itemIndex: 2 });
  });
  it("needs a valid list entry and rejects every other node type", () => {
    expect(funnelInlineField("bulleted_list")).toBeNull();
    expect(funnelInlineField("bulleted_list", -1)).toBeNull();
    expect(funnelInlineField("bulleted_list", 1.5)).toBeNull();
    expect(funnelInlineField("image")).toBeNull();
    expect(funnelInlineField("section")).toBeNull();
    expect(isFunnelInlineEditable("bulleted_list")).toBe(true);
    expect(isFunnelInlineEditable("form")).toBe(false);
  });
});

describe("sanitizeFunnelInlineText", () => {
  it("keeps plain text and line breaks for multiline fields", () => {
    expect(sanitizeFunnelInlineText("  第一行  \r\n第二行\r第三行\n\n\n\n第四行 ", true)).toBe("第一行\n第二行\n第三行\n\n第四行");
  });
  it("strips control, zero-width and bidi characters and normalises spaces", () => {
    expect(sanitizeFunnelInlineText("A\u0000B​C‮D E\tF﻿", true)).toBe("ABCD E F");
  });
  it("folds line breaks into one space for single-line fields and caps the length", () => {
    expect(sanitizeFunnelInlineText("立即\n  報名\r\n吧", false)).toBe("立即 報名 吧");
    expect(sanitizeFunnelInlineText("字".repeat(FUNNEL_INLINE_TEXT_MAX_LENGTH + 50), false)).toHaveLength(FUNNEL_INLINE_TEXT_MAX_LENGTH);
  });
  it("never keeps markup characters as structure: pasted HTML stays literal text", () => {
    // The canvas only reads text/plain, so this is what a pasted "<b>x</b>" string becomes.
    expect(sanitizeFunnelInlineText("<b>粗體</b>", false)).toBe("<b>粗體</b>");
  });
});

describe("funnelInlineTextCommand", () => {
  const text = node("t", "text", { text: "原本文字" });
  it("turns one edit into one update of the base prop", () => {
    expect(funnelInlineTextCommand({ node: text, field: funnelInlineField("text")!, viewport: "desktop", previous: "原本文字", value: "新的文字\n第二行" }))
      .toEqual({ type: "update", nodeId: "t", patch: { props: { text: "新的文字\n第二行" } } });
  });
  it("ignores unchanged or empty edits", () => {
    const field = funnelInlineField("text")!;
    expect(funnelInlineTextCommand({ node: text, field, viewport: "desktop", previous: "原本文字", value: " 原本文字 \n" })).toBeNull();
    expect(funnelInlineTextCommand({ node: text, field, viewport: "desktop", previous: "原本文字", value: "​  " })).toBeNull();
  });
  it("edits the viewport override when that viewport already overrides the prop", () => {
    const headline = node("h", "headline", { text: "桌機標題" }, { mobile: { props: { text: "手機標題" } } });
    expect(funnelInlineTextCommand({ node: headline, field: funnelInlineField("headline")!, viewport: "mobile", previous: "手機標題", value: "新的\n手機標題" }))
      .toEqual({ type: "update", nodeId: "h", patch: { overrides: { mobile: { props: { text: "新的 手機標題" } } } } });
    expect(funnelInlineTextCommand({ node: headline, field: funnelInlineField("headline")!, viewport: "desktop", previous: "桌機標題", value: "新桌機標題" }))
      .toEqual({ type: "update", nodeId: "h", patch: { props: { text: "新桌機標題" } } });
  });
  it("replaces or removes one list entry and always keeps one", () => {
    const list = node("l", "bulleted_list", { items: ["一", "二", "三"] });
    const items = ["一", "二", "三"];
    expect(funnelInlineTextCommand({ node: list, field: funnelInlineField("bulleted_list", 1)!, viewport: "desktop", previous: "二", value: "貳", items }))
      .toEqual({ type: "update", nodeId: "l", patch: { props: { items: ["一", "貳", "三"] } } });
    expect(funnelInlineTextCommand({ node: list, field: funnelInlineField("bulleted_list", 1)!, viewport: "desktop", previous: "二", value: "", items }))
      .toEqual({ type: "update", nodeId: "l", patch: { props: { items: ["一", "三"] } } });
    expect(funnelInlineTextCommand({ node: list, field: funnelInlineField("bulleted_list", 1)!, viewport: "desktop", previous: "二", value: "二", items })).toBeNull();
    expect(funnelInlineTextCommand({ node: list, field: funnelInlineField("bulleted_list", 0)!, viewport: "desktop", previous: "唯一", value: " ", items: ["唯一"] })).toBeNull();
    expect(funnelInlineTextCommand({ node: list, field: funnelInlineField("bulleted_list", 7)!, viewport: "desktop", previous: "", value: "x", items })).toBeNull();
    // The placeholder entry of an empty list becomes the first real entry.
    expect(funnelInlineTextCommand({ node: node("empty", "bulleted_list"), field: funnelInlineField("bulleted_list", 0)!, viewport: "desktop", previous: "清單項目", value: "第一項" }))
      .toEqual({ type: "update", nodeId: "empty", patch: { props: { items: ["第一項"] } } });
  });
  it("undoes and redoes an inline edit in exactly one step", () => {
    const document = createEmptyPageDocument("inline", "合成頁面");
    document.root = [{ ...node("s", "section"), children: [{ ...node("r", "row"), children: [node("b", "button", { label: "立即報名" })] }] }];
    const history = createFunnelPageHistory(document);
    const command = funnelInlineTextCommand({ node: node("b", "button", { label: "立即報名" }), field: funnelInlineField("button")!, viewport: "desktop", previous: "立即報名", value: "馬上加入" })!;
    const edited = dispatchFunnelPageCommand(history, command);
    const label = (state: typeof history) => state.present.root[0]!.children![0]!.children![0]!.props.label;
    expect(label(edited)).toBe("馬上加入");
    expect(edited.past).toHaveLength(1);
    const undone = undoFunnelPageHistory(edited);
    expect(label(undone)).toBe("立即報名");
    expect(undone.past).toHaveLength(0);
    expect(label(redoFunnelPageHistory(undone))).toBe("馬上加入");
  });
});
