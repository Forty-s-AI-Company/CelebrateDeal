import { describe, expect, it } from "vitest";

import {
  createFunnelPageHistory,
  dispatchFunnelPageCommand,
  redoFunnelPageHistory,
  undoFunnelPageHistory,
  type FunnelPageHistory,
} from "@/lib/funnel-page-history";
import { createEmptyPageDocument, type FunnelNode, type PageDocument } from "@/lib/funnel-page-document";

function node(type: FunnelNode["type"], id: string, children?: FunnelNode[], props: Record<string, unknown> = {}): FunnelNode {
  return { schemaVersion: 1, id, type, props, style: {}, overrides: {}, visible: true, actions: [], attributes: {}, ...(children ? { children } : {}) };
}

function fixture(): PageDocument {
  const first = node("columns_2", "column_a", [node("text", "text_a", undefined, { text: "A" })]);
  const second = node("columns_2", "column_b", [node("text", "text_b", undefined, { text: "B" })]);
  return { ...createEmptyPageDocument("page_history"), root: [node("section", "section_1", [node("row", "row_1", [first, second])])] };
}

function current(history: FunnelPageHistory, id: string): FunnelNode {
  const visit = (nodes: FunnelNode[]): FunnelNode | undefined => {
    for (const item of nodes) { if (item.id === id) return item; const found = item.children ? visit(item.children) : undefined; if (found) return found; }
    return undefined;
  };
  const found = visit(history.present.root);
  if (!found) throw new Error(`missing ${id}`);
  return found;
}

describe("Funnel page structured command history", () => {
  it("新增、修改 responsive override、刪除並可 undo/redo", () => {
    let history = createFunnelPageHistory(fixture());
    history = dispatchFunnelPageCommand(history, { type: "add", parentId: "row_1", node: node("button", "button_1", undefined, { label: "開始" }) });
    expect(current(history, "button_1").props.label).toBe("開始");
    history = dispatchFunnelPageCommand(history, { type: "update", nodeId: "button_1", patch: { props: { label: "立即開始" }, overrides: { mobile: { style: { fontSize: 14 }, visible: false } } } });
    expect(current(history, "button_1").props.label).toBe("立即開始");
    expect(current(history, "button_1").overrides.mobile?.visible).toBe(false);
    history = undoFunnelPageHistory(history);
    expect(current(history, "button_1").props.label).toBe("開始");
    expect(current(history, "button_1").overrides.mobile).toBeUndefined();
    history = redoFunnelPageHistory(history);
    expect(current(history, "button_1").props.label).toBe("立即開始");
    history = dispatchFunnelPageCommand(history, { type: "delete", nodeId: "button_1" });
    expect(() => current(history, "button_1")).toThrow();
    history = undoFunnelPageHistory(history);
    expect(current(history, "button_1").props.label).toBe("立即開始");
  });

  it("支援同層排序、跨容器移動與結構化 undo", () => {
    let history = createFunnelPageHistory(fixture());
    history = dispatchFunnelPageCommand(history, { type: "move_down", nodeId: "text_a" });
    expect(current(history, "column_a").children?.map((item) => item.id)).toEqual(["text_a"]);
    history = dispatchFunnelPageCommand(history, { type: "move", nodeId: "text_a", toParentId: "column_b", index: 0 });
    expect(current(history, "column_b").children?.map((item) => item.id)).toContain("text_a");
    expect(current(history, "column_a").children).toEqual([]);
    history = undoFunnelPageHistory(history);
    expect(current(history, "column_a").children?.map((item) => item.id)).toEqual(["text_a"]);
  });

  it("duplicate 會遞迴產生不重複 ID，失敗 command 不會改變 present", () => {
    let history = createFunnelPageHistory(fixture());
    history = dispatchFunnelPageCommand(history, { type: "duplicate", nodeId: "column_a", newId: "column_copy" });
    expect(current(history, "column_copy").children?.[0]?.id).not.toBe("text_a");
    const before = history;
    const failed = dispatchFunnelPageCommand(history, { type: "duplicate", nodeId: "column_a", newId: "column_copy" });
    expect(failed).toBe(before);
    const invalidMove = dispatchFunnelPageCommand(history, { type: "move", nodeId: "section_1", toParentId: "text_a" });
    expect(invalidMove).toBe(history);
  });

  it("redo 在新 command 後會清空，且歷史只保存結構化 command", () => {
    let history = createFunnelPageHistory(fixture());
    history = dispatchFunnelPageCommand(history, { type: "update", nodeId: "text_a", patch: { style: { fontSize: 24 } } });
    history = undoFunnelPageHistory(history);
    history = dispatchFunnelPageCommand(history, { type: "update", nodeId: "text_a", patch: { style: { fontSize: 30 } } });
    expect(history.future).toHaveLength(0);
    expect(JSON.stringify(history.past)).not.toContain("<html");
    expect(current(history, "text_a").style.fontSize).toBe(30);
  });
});

