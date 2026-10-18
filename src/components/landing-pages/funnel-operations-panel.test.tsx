import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { createGoalFunnelStepPages } from "@/lib/funnel-goal-step-pages";
import { defaultFunnelOperations } from "@/lib/funnel-operations";
import { FunnelOperationsPanel } from "./funnel-operations-panel";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));
vi.mock("@/app/actions/landing-page-actions", () => ({ landingPageAction: vi.fn() }));
vi.mock("@/app/actions/funnel-operations-actions", () => ({ readFunnelOperations: vi.fn(), updateFunnelOperations: vi.fn() }));
vi.mock("@/components/landing-pages/funnel-automation-settings", () => ({ FunnelAutomationSettings: () => null }));

// 真實 flow 與 panel：可見名稱改變，但頁面路徑、步驟識別值與資料完全保留。
describe("localized merchant operations", () => {
  it("renders translated tabs and step labels without mutating stored content", () => {
    const content = createGoalFunnelStepPages({ id: "synthetic", name: "測試網站", goal: "audience", domain: "synthetic" })!;
    const initial: Parameters<typeof FunnelOperationsPanel>[0]["initial"] = {
      pageId: "synthetic", name: "測試網站", slug: "synthetic", currency: "TWD", revision: 7,
      status: "draft", operations: defaultFunnelOperations(), content, formId: null, liveId: null,
      steps: content.flow.steps.filter((step) => !step.isSystem).map(({ id, name, path }) => ({ id, name, path })),
    };
    const before = structuredClone(initial);
    const html = renderToStaticMarkup(<FunnelOperationsPanel initial={initial} initialStepId={content.activeStepId} csrfName="synthetic" csrfToken="synthetic" />);
    for (const label of ["一頁式網站", "建立名單", "版本", "名單頁", "頁面設定", "自動化規則", "成效統計", "報名名單", "銷售紀錄", "截止設定"]) expect(html).toContain(label);
    for (const oldLabel of ["Configuration", "Automation Rules", "opt_in_page", "audience · revision"]) expect(html).not.toContain(oldLabel);
    expect(html).toContain('href="/lp/synthetic"');
    expect(initial).toEqual(before);
  });
});
