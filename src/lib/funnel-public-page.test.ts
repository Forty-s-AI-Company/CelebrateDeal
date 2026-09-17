import { describe, expect, it } from "vitest";
import { createGoalFunnelStepPages } from "./funnel-goal-step-pages";
import { getNextPublicFunnelStepPath, getPublicFunnelPage } from "./funnel-public-page";
import { switchFunnelStep } from "./funnel-step-pages";

describe("public funnel page selection", () => {
  it("根網址固定呈現第一步，與編輯器選取狀態無關", () => {
    const state = createGoalFunnelStepPages({ id: "flow", name: "名單 Funnel", goal: "audience", domain: "audience" });
    expect(state).not.toBeNull();
    if (!state) return;
    const second = state.flow.steps[1]!;
    const switched = switchFunnelStep(state, second.id);
    expect(switched.ok).toBe(true);
    if (!switched.ok) return;
    expect(getPublicFunnelPage(switched.state)?.id).toBe(state.pages[state.flow.steps[0]!.id]!.id);
  });

  it("依 path 取得各自的獨立 PageDocument，未知 path 回傳 null", () => {
    const state = createGoalFunnelStepPages({ id: "flow", name: "銷售 Funnel", goal: "sell", domain: "sell" });
    expect(state).not.toBeNull();
    if (!state) return;
    for (const step of state.flow.steps) expect(getPublicFunnelPage(state, step.path)?.id).toBe(state.pages[step.id]!.id);
    expect(getPublicFunnelPage(state, "missing")).toBeNull();
  });

  it("成功提交只導向下一個非系統 Step，最後一步不導向", () => {
    const state = createGoalFunnelStepPages({ id: "flow", name: "名單 Funnel", goal: "audience", domain: "audience" })!;
    const first = state.pages[state.flow.steps[0]!.id]!;
    const second = state.pages[state.flow.steps[1]!.id]!;
    expect(getNextPublicFunnelStepPath(state, first.id)).toBe(state.flow.steps[1]!.path);
    expect(getNextPublicFunnelStepPath(state, second.id)).toBeNull();
    expect(getNextPublicFunnelStepPath(state, "unknown")).toBeNull();
  });
});
