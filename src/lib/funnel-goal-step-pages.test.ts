import { describe, expect, it } from "vitest";
import { createGoalFunnelStepPages } from "./funnel-goal-step-pages";
import type { FunnelNode } from "./funnel-page-document";

const flatten = (nodes: FunnelNode[]): FunnelNode[] => nodes.flatMap((node) => [node, ...(node.children ? flatten(node.children) : [])]);

describe("goal funnel initial documents", () => {
  it.each(["sell", "audience", "custom", "webinar"] as const)("%s 建立每一步的獨立可渲染頁面", (goal) => {
    const state = createGoalFunnelStepPages({ id: `flow_${goal}`, name: goal, goal, domain: goal });
    expect(state).not.toBeNull();
    if (!state) return;
    expect(Object.keys(state.pages)).toHaveLength(state.flow.steps.length);
    expect(new Set(Object.values(state.pages).map((page) => page.id)).size).toBe(state.flow.steps.length);
    expect(Object.values(state.pages).every((page) => Array.isArray(page.root))).toBe(true);
  });

  it("名單 Funnel 的第一步等待選擇模板，沒有預先套用內容", () => {
    const state = createGoalFunnelStepPages({ id: "audience", name: "名單", goal: "audience", domain: "audience" });
    expect(state).not.toBeNull();
    if (!state) return;
    expect(state.flow.steps[0]!.template).toEqual({ source: "template" });
    expect(flatten(state.pages[state.flow.steps[0]!.id]!.root)).toEqual([]);
  });

  it("名單感謝頁確認資料已送出，而不是顯示待編輯提示", () => {
    const state = createGoalFunnelStepPages({ id: "audience_thanks", name: "名單", goal: "audience", domain: "audience-thanks" });
    expect(state).not.toBeNull();
    if (!state) return;
    const thankYouStep = state.flow.steps.find((step) => step.type === "opt_in_thank_you_page");
    expect(thankYouStep).toBeDefined();
    const copy = flatten(state.pages[thankYouStep!.id]!.root).map((node) => node.props.text);
    expect(copy).toContain("謝謝你完成這一步");
    expect(copy).toContain("你提供的資料已送出。接下來可在這裡說明後續流程。");
  });

  it("銷售 Funnel 的第一步等待選擇模板，避免建立後直接假裝已有結帳頁", () => {
    const state = createGoalFunnelStepPages({ id: "sell", name: "銷售", goal: "sell", domain: "sell" });
    expect(state).not.toBeNull();
    if (!state) return;
    expect(state.flow.steps[0]!.template).toEqual({ source: "template" });
    expect(flatten(state.pages[state.flow.steps[0]!.id]!.root)).toEqual([]);
  });

  it("自訂 Funnel 依實測從系統停用頁開始，由使用者新增第一個步驟", () => {
    const state = createGoalFunnelStepPages({ id: "custom", name: "自訂", goal: "custom", domain: "custom" });
    expect(state?.flow.steps.map((step) => [step.type, step.isSystem])).toEqual([["inactive_page", true]]);
    expect(state?.activeStepId).toBe("inactive");
  });
});
