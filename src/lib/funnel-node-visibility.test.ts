import { expect, it } from "vitest";
import { funnelDeviceVisibilityCommand, funnelNodeVisibility, funnelNodeVisibleOn } from "./funnel-node-visibility";
import { createEmptyPageDocument, type FunnelNode } from "./funnel-page-document";
import { createFunnelPageHistory, dispatchFunnelPageCommand, undoFunnelPageHistory } from "./funnel-page-history";

const node = (overrides: FunnelNode["overrides"] = {}, visible = true): FunnelNode => ({ schemaVersion: 1, id: "n", type: "text", props: { text: "合成" }, style: {}, overrides, visible, actions: [], attributes: {} });

it("resolves per-device visibility the same way as the renderer", () => {
  expect(funnelNodeVisibility(node())).toEqual({ desktop: true, mobile: true });
  expect(funnelNodeVisibility(node({ mobile: { visible: false } }))).toEqual({ desktop: true, mobile: false });
  expect(funnelNodeVisibility(node({ desktop: { visible: true } }, false))).toEqual({ desktop: true, mobile: false });
  expect(funnelNodeVisibleOn(node({ mobile: { style: { fontSize: 12 } } }), "mobile")).toBe(true);
});

it("writes only the toggled device's override and skips no-op toggles", () => {
  expect(funnelDeviceVisibilityCommand(node(), "mobile", false)).toEqual({ type: "update", nodeId: "n", patch: { overrides: { mobile: { visible: false } } } });
  expect(funnelDeviceVisibilityCommand(node(), "desktop", true)).toBeNull();
});

it("keeps existing overrides and undoes a toggle in one step", () => {
  const document = createEmptyPageDocument("visibility", "合成頁面");
  const text = node({ mobile: { style: { fontSize: 14 } } });
  document.root = [{ ...node(), id: "s", type: "section", props: {}, children: [{ ...node(), id: "r", type: "row", props: {}, children: [text] }] }];
  const history = createFunnelPageHistory(document);
  const hidden = dispatchFunnelPageCommand(history, funnelDeviceVisibilityCommand(text, "mobile", false)!);
  const stored = hidden.present.root[0]!.children![0]!.children![0]!;
  expect(stored.overrides.mobile).toEqual({ style: { fontSize: 14 }, visible: false });
  expect(stored.visible).toBe(true);
  expect(undoFunnelPageHistory(hidden).present.root[0]!.children![0]!.children![0]!.overrides).toEqual({ mobile: { style: { fontSize: 14 } } });
});
