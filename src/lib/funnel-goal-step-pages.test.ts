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
    expect(Object.values(state.pages).every((page) => page.root.length > 0)).toBe(true);
  });

  it("名單 Funnel 的第一步含可編輯表單、輸入與送出按鈕", () => {
    const state = createGoalFunnelStepPages({ id: "audience", name: "名單", goal: "audience", domain: "audience" });
    expect(state).not.toBeNull();
    if (!state) return;
    const types = flatten(state.pages[state.flow.steps[0]!.id]!.root).map((node) => node.type);
    expect(types).toEqual(expect.arrayContaining(["form", "form_input", "button"]));
  });

  it("銷售 Funnel 的付款節點全部維持 disabled 且沒有 actions", () => {
    const state = createGoalFunnelStepPages({ id: "sell", name: "銷售", goal: "sell", domain: "sell" });
    expect(state).not.toBeNull();
    if (!state) return;
    const payment = flatten(state.pages[state.flow.steps[0]!.id]!.root).filter((node) => ["offer_price", "payment_method", "payment_button"].includes(node.type));
    expect(payment.length).toBeGreaterThan(0);
    expect(payment.every((node) => node.props.disabled === true && node.actions.length === 0)).toBe(true);
  });

  it("自訂 Funnel 依實測從系統停用頁開始，由使用者新增第一個步驟", () => {
    const state = createGoalFunnelStepPages({ id: "custom", name: "自訂", goal: "custom", domain: "custom" });
    expect(state?.flow.steps.map((step) => [step.type, step.isSystem])).toEqual([["inactive_page", true]]);
    expect(state?.activeStepId).toBe("inactive");
  });
});
