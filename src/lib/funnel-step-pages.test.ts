import { describe, expect, it } from "vitest";

import { createFunnelFlow } from "@/lib/funnel-flow";
import { parsePageDocument, type PageDocument } from "@/lib/funnel-page-document";
import {
  addFunnelStepPage,
  createFunnelStepPages,
  deserializeFunnelStepPages,
  duplicateFunnelStepPage,
  getActiveFunnelStepPage,
  moveFunnelStepPage,
  parseFunnelStepPages,
  removeFunnelStepPage,
  renameFunnelStepPage,
  replaceFunnelStepPage,
  serializeFunnelStepPages,
  setFunnelStepPathPage,
  switchFunnelStep,
} from "@/lib/funnel-step-pages";

function flow(goal: "audience" | "sell" | "custom" = "audience") {
  return createFunnelFlow({ id: `flow_${goal}`, name: "秋季活動", goal, domain: `autumn-${goal}` })!;
}

function editablePage(nextStepId = "opt_in"): PageDocument {
  const page = parsePageDocument({
    schemaVersion: 1,
    id: "source_page",
    name: "名單頁",
    root: [{
      schemaVersion: 1, id: "section_a", type: "section", props: {}, style: {}, overrides: {}, visible: true, actions: [], attributes: {}, children: [{
        schemaVersion: 1, id: "row_a", type: "row", props: {}, style: {}, overrides: {}, visible: true, actions: [], attributes: {}, children: [{
          schemaVersion: 1, id: "column_a", type: "columns_2", props: {}, style: {}, overrides: {}, visible: true, actions: [], attributes: {}, children: [{
            schemaVersion: 1, id: "form_a", type: "form", props: {}, style: {}, overrides: {}, visible: true, actions: [], attributes: {}, children: [{
              schemaVersion: 1,
              id: "button_a",
              type: "button",
              props: { label: "送出" },
              style: {},
              overrides: {},
              visible: true,
              actions: [
                { type: "show_popup", popupId: "popup_a" },
                { type: "submit_form", formId: "form_a" },
                { type: "next_step", stepId: nextStepId },
              ],
              attributes: {},
            }],
          }],
        }],
      }],
    }],
    popups: [{
      schemaVersion: 1,
      id: "popup_a",
      name: "歡迎視窗",
      settings: {},
      root: [{
        schemaVersion: 1, id: "popup_section", type: "section", props: {}, style: {}, overrides: {}, visible: true, actions: [], attributes: {}, children: [{
          schemaVersion: 1, id: "popup_row", type: "row", props: {}, style: {}, overrides: {}, visible: true, actions: [], attributes: {}, children: [{
            schemaVersion: 1, id: "popup_column", type: "columns_2", props: {}, style: {}, overrides: {}, visible: true, actions: [], attributes: {}, children: [{
              schemaVersion: 1, id: "popup_text", type: "text", props: { text: "謝謝" }, style: {}, overrides: {}, visible: true, actions: [], attributes: {},
            }],
          }],
        }],
      }],
      capabilities: { exitIntent: { status: "unverified", reason: "尚未驗證" } },
    }],
    settings: {},
  });
  if (!page) throw new Error("測試頁面應通過 PageDocument 驗證");
  return page;
}

function idsFromPage(page: PageDocument | { root: PageDocument["root"]; popups: PageDocument["popups"] }): string[] {
  const ids: string[] = [];
  const walk = (nodes: PageDocument["root"]) => nodes.forEach((node) => {
    ids.push(node.id);
    if (node.children) walk(node.children);
  });
  walk(page.root);
  page.popups.forEach((popup) => {
    ids.push(popup.id);
    walk(popup.root);
  });
  return ids;
}

describe("Funnel step pages", () => {
  it("為 Audience、Sell、Custom 的每個一般 step 與停用頁建立獨立快照", () => {
    for (const goal of ["audience", "sell", "custom"] as const) {
      const state = createFunnelStepPages(flow(goal));
      expect(state).not.toBeNull();
      expect(Object.keys(state!.pages).sort()).toEqual(state!.flow.steps.map((step) => step.id).sort());
      expect(state!.flow.steps.map((step) => state!.pages[step.id]?.id).filter(Boolean)).toHaveLength(state!.flow.steps.length);
      expect(new Set(Object.values(state!.pages).map((page) => page.id)).size).toBe(state!.flow.steps.length);
      expect(state!.pages.inactive?.name).toBe("停用頁");
    }
  });

  it("新增、複製、移動、移除與改名 step 時同步快照，不共用頁面或節點 ID", () => {
    const initial = createFunnelStepPages(flow("custom"))!;
    const added = addFunnelStepPage(initial, { id: "info_one", name: "活動資訊", path: "event-info", type: "info_page" });
    if (!added.ok) throw new Error(added.error);
    expect(added.state.pages.info_one).toBeDefined();
    expect(added.state.pages.info_one).not.toBe(initial.pages.inactive);

    const replaced = replaceFunnelStepPage(added.state, "info_one", editablePage("info_one"));
    if (!replaced.ok) throw new Error(replaced.error);
    const copied = duplicateFunnelStepPage(replaced.state, "info_one", { id: "info_two", name: "活動資訊副本", path: "event-info-copy" });
    if (!copied.ok) throw new Error(copied.error);
    const original = copied.state.pages.info_one!;
    const copy = copied.state.pages.info_two!;
    expect(copy).not.toBe(original);
    expect(copy.id).not.toBe(original.id);
    expect(new Set([...idsFromPage(original), ...idsFromPage(copy)]).size).toBe(idsFromPage(original).length + idsFromPage(copy).length);
    const copyButton = copy.root[0]!.children![0]!.children![0]!.children![0]!.children![0]!;
    expect(copyButton.actions).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: "show_popup", popupId: expect.not.stringMatching(/^popup_a$/u) }),
      expect.objectContaining({ type: "submit_form", formId: expect.not.stringMatching(/^form_a$/u) }),
      { type: "next_step", stepId: "info_two" },
    ]));

    const renamed = renameFunnelStepPage(copied.state, "info_two", "  新的　資訊頁 ");
    if (!renamed.ok) throw new Error(renamed.error);
    expect(renamed.state.pages.info_two?.name).toBe("新的 資訊頁");
    const pathUpdated = setFunnelStepPathPage(renamed.state, "info_two", "/event-info-next/");
    if (!pathUpdated.ok) throw new Error(pathUpdated.error);
    expect(pathUpdated.state.flow.steps.find((step) => step.id === "info_two")?.path).toBe("event-info-next");
    expect(pathUpdated.state.pages.info_two).toEqual(renamed.state.pages.info_two);
    expect(setFunnelStepPathPage(pathUpdated.state, "info_two", "event-info")).toMatchObject({ ok: false });
    const moved = moveFunnelStepPage(pathUpdated.state, "info_two", 0);
    if (!moved.ok) throw new Error(moved.error);
    expect(moved.state.flow.steps.map((step) => step.id)).toEqual(["info_two", "info_one", "inactive"]);
    expect(moved.state.pages.info_one).toBeDefined();
    const removed = removeFunnelStepPage(moved.state, "info_one");
    if (!removed.ok) throw new Error(removed.error);
    expect(removed.state.pages.info_one).toBeUndefined();
    expect(parseFunnelStepPages(removed.state)).toEqual(removed.state);
  });

  it("切換是純 transaction，停用頁可查看但不可覆寫", () => {
    const initial = createFunnelStepPages(flow())!;
    const switched = switchFunnelStep(initial, "inactive");
    if (!switched.ok) throw new Error(switched.error);
    expect(initial.activeStepId).toBe("opt_in");
    expect(switched.state.activeStepId).toBe("inactive");
    expect(getActiveFunnelStepPage(switched.state)).toMatchObject({ step: { id: "inactive", isSystem: true }, editable: false });
    expect(replaceFunnelStepPage(switched.state, "inactive", editablePage())).toMatchObject({ ok: false });
    expect(switchFunnelStep(switched.state, "missing")).toMatchObject({ ok: false });
  });

  it("round-trip 保留各 step snapshot，並拒絕遺失、重複或失效動作", () => {
    const initial = createFunnelStepPages(flow(), { initialStepId: "opt_in", initialPage: editablePage() })!;
    const restored = deserializeFunnelStepPages(serializeFunnelStepPages(initial));
    expect(restored).toEqual(initial);
    expect(deserializeFunnelStepPages("{")).toBeNull();
    expect(parseFunnelStepPages({ ...initial, pages: { opt_in: initial.pages.opt_in } })).toBeNull();
    const invalidAction = structuredClone(initial);
    invalidAction.pages.opt_in!.root[0]!.children![0]!.children![0]!.children![0]!.children![0]!.actions = [{ type: "next_step", stepId: "missing" }];
    expect(parseFunnelStepPages(invalidAction)).toBeNull();
  });
});
