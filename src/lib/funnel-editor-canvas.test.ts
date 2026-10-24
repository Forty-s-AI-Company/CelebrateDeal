import { describe, expect, it } from "vitest";
import {
  funnelDropCommand,
  funnelDropIndicatorGeometry,
  funnelDropZone,
  funnelNodeAccepts,
  placeFunnelNodeToolbar,
  resolveFunnelDrop,
  resolveFunnelEndDrop,
  type FunnelDragPayload,
  type FunnelRect,
} from "./funnel-editor-canvas";
import { createEmptyPageDocument, type FunnelNode } from "./funnel-page-document";
import { createFunnelPageHistory, dispatchFunnelPageCommand, undoFunnelPageHistory } from "./funnel-page-history";

const node = (id: string, type: FunnelNode["type"], children?: FunnelNode[]): FunnelNode => ({ schemaVersion: 1, id, type, props: {}, style: {}, overrides: {}, visible: true, actions: [], attributes: {}, ...(children ? { children } : {}) });

/** Two sections; the first has a row with a two-column layout and two texts, the second an empty row. */
function tree(): FunnelNode[] {
  return [
    node("s1", "section", [node("r1", "row", [
      node("t1", "text"),
      node("cols", "columns_2", [node("c_text", "text"), node("c_head", "headline")]),
      node("t2", "text"),
    ])]),
    node("s2", "section", [node("r2", "row", [])]),
  ];
}

// Every node is stacked 100px tall at y = index * 100 unless overridden.
const rects: Record<string, FunnelRect> = {
  s1: { left: 0, top: 0, width: 400, height: 300 },
  r1: { left: 0, top: 0, width: 400, height: 300 },
  t1: { left: 0, top: 0, width: 400, height: 100 },
  cols: { left: 0, top: 100, width: 400, height: 100 },
  c_text: { left: 0, top: 100, width: 200, height: 100 },
  c_head: { left: 200, top: 100, width: 200, height: 100 },
  t2: { left: 0, top: 200, width: 400, height: 100 },
  s2: { left: 0, top: 300, width: 400, height: 100 },
  r2: { left: 0, top: 300, width: 400, height: 100 },
};
const measure = (id: string) => rects[id] ?? null;
const axisOf = (id: string) => (id === "c_text" || id === "c_head" ? "horizontal" as const : "vertical" as const);
const text: FunnelDragPayload = { kind: "element", nodeType: "text" };
const section: FunnelDragPayload = { kind: "block", templateId: "synthetic", nodeType: "section" };

describe("funnelDropZone", () => {
  const rect = { left: 0, top: 0, width: 200, height: 200 };
  it("maps edges to before/after and the middle to inside when both are legal", () => {
    expect(funnelDropZone(rect, { x: 10, y: 5 }, "vertical", { inside: true, beside: true })).toBe("before");
    expect(funnelDropZone(rect, { x: 10, y: 195 }, "vertical", { inside: true, beside: true })).toBe("after");
    expect(funnelDropZone(rect, { x: 10, y: 100 }, "vertical", { inside: true, beside: true })).toBe("inside");
  });
  it("uses halves when only beside is legal, the whole rect when only inside is, and nothing otherwise", () => {
    expect(funnelDropZone(rect, { x: 10, y: 99 }, "vertical", { inside: false, beside: true })).toBe("before");
    expect(funnelDropZone(rect, { x: 10, y: 101 }, "vertical", { inside: false, beside: true })).toBe("after");
    expect(funnelDropZone(rect, { x: 150, y: 10 }, "horizontal", { inside: false, beside: true })).toBe("after");
    expect(funnelDropZone(rect, { x: 10, y: 1 }, "vertical", { inside: true, beside: false })).toBe("inside");
    expect(funnelDropZone(rect, { x: 10, y: 1 }, "vertical", { inside: false, beside: false })).toBeNull();
  });
});

describe("resolveFunnelDrop", () => {
  const base = { root: tree(), measure, axisOf };
  it("places an element before or after a sibling from the pointer position", () => {
    expect(resolveFunnelDrop({ ...base, payload: text, hoveredId: "t1", point: { x: 10, y: 20 } })).toEqual({ parentId: "r1", index: 0, anchorId: "t1", placement: "before", axis: "vertical" });
    expect(resolveFunnelDrop({ ...base, payload: text, hoveredId: "t2", point: { x: 10, y: 280 } })).toEqual({ parentId: "r1", index: 3, anchorId: "t2", placement: "after", axis: "vertical" });
  });
  it("uses the horizontal axis for columns", () => {
    expect(resolveFunnelDrop({ ...base, payload: text, hoveredId: "c_head", point: { x: 390, y: 110 } })).toEqual({ parentId: "cols", index: 2, anchorId: "c_head", placement: "after", axis: "horizontal" });
  });
  it("drops inside an accepting container from its middle", () => {
    expect(resolveFunnelDrop({ ...base, payload: text, hoveredId: "r2", point: { x: 10, y: 350 } })).toEqual({ parentId: "r2", index: 0, anchorId: "r2", placement: "inside", axis: "vertical" });
  });
  it("walks out to the nearest legal level: a section dragged over a paragraph lands next to its section", () => {
    expect(resolveFunnelDrop({ ...base, payload: section, hoveredId: "c_text", point: { x: 10, y: 120 } })).toEqual({ parentId: null, index: 0, anchorId: "s1", placement: "before", axis: "vertical" });
    expect(resolveFunnelDrop({ ...base, payload: section, hoveredId: "r2", point: { x: 10, y: 390 } })).toEqual({ parentId: null, index: 2, anchorId: "s2", placement: "after", axis: "vertical" });
  });
  it("falls back to the end of the hovered section's last accepting container", () => {
    const root = [node("only", "section", [node("rowA", "row", [node("x", "text")]), node("rowB", "row", [])])];
    const sectionOnly = (id: string) => (id === "only" ? { left: 0, top: 0, width: 100, height: 100 } : null);
    expect(resolveFunnelDrop({ root, payload: text, hoveredId: "only", point: { x: 5, y: 5 }, measure: sectionOnly })).toEqual({ parentId: "rowB", index: 0, anchorId: "rowB", placement: "inside", axis: "vertical" });
    // An empty section has no row or form for a form field, so nothing is offered.
    expect(resolveFunnelDrop({ root: [node("bare", "section", [])], payload: { kind: "element", nodeType: "form_input" }, hoveredId: "bare", point: { x: 5, y: 5 }, measure: () => ({ left: 0, top: 0, width: 10, height: 10 }) })).toBeNull();
  });
  it("rejects the dragged node, its descendants, unknown targets and no-op moves", () => {
    expect(resolveFunnelDrop({ ...base, payload: { kind: "node", nodeId: "cols", nodeType: "columns_2" }, hoveredId: "c_text", point: { x: 10, y: 150 } })).toBeNull();
    expect(resolveFunnelDrop({ ...base, payload: { kind: "node", nodeId: "t1", nodeType: "text" }, hoveredId: "t1", point: { x: 10, y: 10 } })).toBeNull();
    expect(resolveFunnelDrop({ ...base, payload: text, hoveredId: "missing", point: { x: 0, y: 0 } })).toBeNull();
    // Right after itself (before its next sibling) is a no-op.
    expect(resolveFunnelDrop({ ...base, payload: { kind: "node", nodeId: "t1", nodeType: "text" }, hoveredId: "cols", point: { x: 10, y: 101 } })).toBeNull();
    expect(resolveFunnelDrop({ ...base, payload: text, hoveredId: "t1", point: { x: 0, y: 0 }, measure: () => null })).toBeNull();
  });
  it("moves an existing node to a legal place", () => {
    const target = resolveFunnelDrop({ ...base, payload: { kind: "node", nodeId: "t1", nodeType: "text" }, hoveredId: "t2", point: { x: 10, y: 290 } });
    expect(target).toEqual({ parentId: "r1", index: 3, anchorId: "t2", placement: "after", axis: "vertical" });
  });
});

describe("resolveFunnelEndDrop", () => {
  it("appends sections to the page and elements to the last accepting container", () => {
    expect(resolveFunnelEndDrop(tree(), section)).toEqual({ parentId: null, index: 2, anchorId: "s2", placement: "after", axis: "vertical" });
    expect(resolveFunnelEndDrop(tree(), text)).toEqual({ parentId: "r2", index: 0, anchorId: "r2", placement: "inside", axis: "vertical" });
    expect(resolveFunnelEndDrop([], section)).toEqual({ parentId: null, index: 0, anchorId: null, placement: "inside", axis: "vertical" });
  });
  it("has no target for elements on an empty page, for the last section itself, or inside the dragged node", () => {
    expect(resolveFunnelEndDrop([], text)).toBeNull();
    expect(resolveFunnelEndDrop(tree(), { kind: "node", nodeId: "s2", nodeType: "section" })).toBeNull();
    const root = [node("s", "section", [node("r", "row", [node("box", "content_box", []), node("after_box", "text")])])];
    expect(resolveFunnelEndDrop(root, { kind: "node", nodeId: "box", nodeType: "content_box" })).toEqual({ parentId: "r", index: 2, anchorId: "r", placement: "inside", axis: "vertical" });
    expect(resolveFunnelEndDrop([node("s", "section", [node("r", "row", [node("only", "text")])])], { kind: "node", nodeId: "only", nodeType: "text" })).toBeNull();
  });
});

describe("funnelDropCommand", () => {
  const target = { parentId: "r1", index: 1, anchorId: "t1", placement: "after" as const, axis: "vertical" as const };
  it("builds one add or move command", () => {
    const fresh = node("new_text", "text");
    expect(funnelDropCommand(target, text, null, fresh)).toEqual({ type: "add", node: fresh, parentId: "r1", popupId: null, index: 1 });
    expect(funnelDropCommand(target, { kind: "node", nodeId: "t2", nodeType: "text" }, "popup_1")).toEqual({ type: "move", nodeId: "t2", toParentId: "r1", index: 1 });
    expect(funnelDropCommand(target, text, null)).toBeNull();
    expect(funnelDropCommand(target, text, null, node("wrong", "headline"))).toBeNull();
  });
  it("commits a drop as a single undoable history entry", () => {
    const document = { ...createEmptyPageDocument("drop", "拖放"), root: tree() };
    const history = createFunnelPageHistory(document);
    const target = resolveFunnelDrop({ root: document.root, payload: text, hoveredId: "t1", point: { x: 10, y: 90 }, measure, axisOf })!;
    const next = dispatchFunnelPageCommand(history, funnelDropCommand(target, text, null, node("dropped", "text"))!);
    expect(next.past).toHaveLength(1);
    expect(next.present.root[0]!.children![0]!.children!.map((child) => child.id)).toEqual(["t1", "dropped", "cols", "t2"]);
    expect(undoFunnelPageHistory(next).present.root[0]!.children![0]!.children!.map((child) => child.id)).toEqual(["t1", "cols", "t2"]);
  });
});

describe("funnelNodeAccepts", () => {
  it("follows the registry's allowed parents and leaf rules", () => {
    expect(funnelNodeAccepts("root", "section")).toBe(true);
    expect(funnelNodeAccepts("root", "text")).toBe(false);
    expect(funnelNodeAccepts("row", "text")).toBe(true);
    expect(funnelNodeAccepts("text", "text")).toBe(false);
  });
});

describe("indicator and toolbar geometry", () => {
  const rect = { left: 10, top: 20, width: 100, height: 40 };
  it("draws a line on the leading or trailing edge, or a box for inside drops", () => {
    expect(funnelDropIndicatorGeometry({ parentId: null, index: 0, anchorId: "a", placement: "before", axis: "vertical" }, rect)).toEqual({ kind: "line", left: 10, top: 18, width: 100, height: 4 });
    expect(funnelDropIndicatorGeometry({ parentId: null, index: 0, anchorId: "a", placement: "after", axis: "vertical" }, rect)).toEqual({ kind: "line", left: 10, top: 58, width: 100, height: 4 });
    expect(funnelDropIndicatorGeometry({ parentId: null, index: 0, anchorId: "a", placement: "before", axis: "horizontal" }, rect)).toEqual({ kind: "line", left: 8, top: 20, width: 4, height: 40 });
    expect(funnelDropIndicatorGeometry({ parentId: null, index: 0, anchorId: "a", placement: "after", axis: "horizontal" }, rect)).toEqual({ kind: "line", left: 108, top: 20, width: 4, height: 40 });
    expect(funnelDropIndicatorGeometry({ parentId: "a", index: 0, anchorId: "a", placement: "inside", axis: "vertical" }, rect)).toEqual({ kind: "box", ...rect });
  });
  it("keeps the toolbar above, below or pinned inside the node and always within the visible canvas", () => {
    const visible = { left: 0, top: 0, width: 500, height: 400 };
    const size = { width: 200, height: 30 };
    expect(placeFunnelNodeToolbar({ left: 100, top: 100, width: 300, height: 50 }, visible, size)).toEqual({ left: 200, top: 64, side: "above" });
    expect(placeFunnelNodeToolbar({ left: 100, top: 10, width: 300, height: 50 }, visible, size)).toEqual({ left: 200, top: 66, side: "below" });
    expect(placeFunnelNodeToolbar({ left: 0, top: -200, width: 500, height: 900 }, visible, size)).toEqual({ left: 300, top: 6, side: "inside" });
    // Narrow nodes near the left edge keep the toolbar inside the canvas.
    expect(placeFunnelNodeToolbar({ left: 5, top: 100, width: 40, height: 20 }, visible, size).left).toBe(0);
    expect(placeFunnelNodeToolbar({ left: 480, top: 100, width: 100, height: 20 }, visible, size).left).toBe(300);
  });
});
