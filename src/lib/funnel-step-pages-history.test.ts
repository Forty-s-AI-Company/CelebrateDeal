import { describe, expect, it } from "vitest";
import { createFunnelFlow, renameFunnelStep } from "./funnel-flow";
import { createFunnelStepPages } from "./funnel-step-pages";
import { createFunnelStepPagesHistory, recordFunnelStepPages, redoFunnelStepPages, undoFunnelStepPages } from "./funnel-step-pages-history";

describe("Funnel step structured history", () => {
  it("還原與重做 step metadata，且新紀錄會清除 redo", () => {
    const flow = createFunnelFlow({ id: "flow", name: "流程", goal: "audience", domain: "flow" })!;
    const original = createFunnelStepPages(flow)!;
    const renamed = renameFunnelStep(flow, "opt_in", "新版名單頁");
    if (!renamed.ok) throw new Error(renamed.error);
    const current = createFunnelStepPages(renamed.flow)!;
    let history = recordFunnelStepPages(createFunnelStepPagesHistory(), original);
    const undone = undoFunnelStepPages(history, current)!;
    expect(undone.state.flow.steps[0]?.name).toBe("名單頁");
    const redone = redoFunnelStepPages(undone.history, undone.state)!;
    expect(redone.state.flow.steps[0]?.name).toBe("新版名單頁");
    history = recordFunnelStepPages(undone.history, undone.state);
    expect(history.future).toEqual([]);
  });
});
