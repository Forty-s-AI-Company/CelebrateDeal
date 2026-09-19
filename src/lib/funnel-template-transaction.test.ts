import { describe, expect, it } from "vitest";

import {
  applyFunnelTemplateChange,
  changeFunnelTemplate,
  createFunnelTemplateUndoAdapter,
  previewFunnelTemplateChange,
} from "@/lib/funnel-template-transaction";
import { createEmptyPageDocument, parsePageDocument, type FunnelNode, type PageDocument } from "@/lib/funnel-page-document";

function node(id: string, type: FunnelNode["type"] = "text"): FunnelNode {
  return { schemaVersion: 1, id, type, props: { text: "舊內容" }, style: {}, overrides: {}, visible: true, actions: [], attributes: {} };
}

function fixture(): PageDocument {
  const document = createEmptyPageDocument("page_transaction", "保留我的頁面");
  const legacyRoot = node("legacy_root", "section");
  legacyRoot.children = [{ ...node("legacy_row", "row"), children: [{ ...node("legacy_columns", "columns_2"), children: [node("legacy_text")] }] }];
  return parsePageDocument({
    ...document,
    revision: 12,
    root: [legacyRoot],
    popups: [{ schemaVersion: 1, id: "legacy_popup", name: "舊視窗", settings: {}, root: [{ ...node("legacy_popup_text", "section"), children: [{ ...node("legacy_popup_row", "row"), children: [{ ...node("legacy_popup_columns", "columns_2"), children: [node("legacy_popup_leaf")] }] }] }] }],
    settings: { ...document.settings, language: "en", seo: { ...document.settings.seo, title: "我的 SEO" } },
  })!;
}

function ids(document: PageDocument): string[] {
  const output: string[] = [];
  const visit = (nodes: FunnelNode[]) => nodes.forEach((item) => { output.push(item.id); if (item.children) visit(item.children); });
  visit(document.root);
  document.popups.forEach((popup) => { output.push(popup.id); visit(popup.root); });
  return output;
}

describe("Funnel template replacement transaction", () => {
  it("先回傳確認警告，未確認時不替換文件", () => {
    const before = fixture();
    const result = previewFunnelTemplateChange(before, { templateId: "audience" });
    expect(result.status).toBe("preview");
    expect(result.requiresConfirmation).toBe(true);
    expect(result.impact?.warning).toContain("替換");
    expect(result.document).toEqual(before);
    expect(result.document.root[0]?.id).toBe("legacy_root");
  });

  it("確認後替換 root 與 popups，並保留 id/name/revision/settings", () => {
    const before = fixture();
    const result = applyFunnelTemplateChange(before, { templateId: "audience" });
    expect(result.status).toBe("applied");
    expect(result.document.id).toBe(before.id);
    expect(result.document.name).toBe(before.name);
    expect(result.document.revision).toBe(before.revision);
    expect(result.document.settings.language).toBe("en");
    expect(result.document.settings.seo.title).toBe("我的 SEO");
    expect(result.document.root[0]?.id).not.toBe("legacy_root");
    expect(result.document.popups).toHaveLength(0);
    expect(result.impact?.previousPopupCount).toBe(1);
  });

  it("可選擇重設 page settings，但仍保留文件 metadata", () => {
    const before = fixture();
    const result = applyFunnelTemplateChange(before, { templateId: "blank", settingsStrategy: "reset" });
    expect(result.document.id).toBe(before.id);
    expect(result.document.name).toBe(before.name);
    expect(result.document.revision).toBe(before.revision);
    expect(result.document.settings.language).toBe("zh-TW");
    expect(result.document.settings.seo.title).toBeUndefined();
  });

  it("每次套用都為整棵模板樹產生新的唯一 ID", () => {
    const before = fixture();
    const first = applyFunnelTemplateChange(before, { templateId: "custom-info" }).document;
    const second = applyFunnelTemplateChange(before, { templateId: "custom-info" }).document;
    expect(new Set(ids(first)).size).toBe(ids(first).length);
    expect(new Set(ids(second)).size).toBe(ids(second).length);
    expect(ids(first)).not.toEqual(ids(second));
    expect(ids(first)).not.toContain("legacy_root");
  });

  it("未知、Webinar unverified 與 disabled template 都 fail closed", () => {
    const before = fixture();
    expect(changeFunnelTemplate(before, { templateId: "missing", confirm: true }).status).toBe("rejected");
    expect(changeFunnelTemplate(before, { templateId: "webinar", confirm: true }).status).toBe("rejected");
    const rejected = changeFunnelTemplate(before, { templateId: "webinar", confirm: true });
    expect(rejected.document).toEqual(before);
    expect(rejected.requiresConfirmation).toBe(false);
  });

  it("undo adapter 可恢復與重做，且不會修改輸入", () => {
    const before = fixture();
    const after = applyFunnelTemplateChange(before, { templateId: "sell" }).document;
    const adapter = createFunnelTemplateUndoAdapter(before, after);
    expect(adapter).not.toBeNull();
    expect(adapter?.undo(after)).toEqual(before);
    expect(adapter?.redo(before)).toEqual(after);
    expect(before.root[0]?.id).toBe("legacy_root");
  });
});
