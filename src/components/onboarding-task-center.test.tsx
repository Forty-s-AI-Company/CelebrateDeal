import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock("@/app/actions/sales-workspace-actions", () => ({
  controlOnboardingGuideAction: vi.fn(),
  setOnboardingTaskStatusAction: vi.fn(),
}));

import { OnboardingTaskCenter } from "./onboarding-task-center";
import { OnboardingTaskPanel } from "./onboarding-task-panel";

const tasks = [
  { key: "workspace_profile", title: "完成商家基本資料", status: "completed", estimateMinutes: 2, href: "/settings/brand", required: true },
  { key: "workspace_payment", title: "串接付款方式", status: "skipped", estimateMinutes: 4, href: "/billing/payment-methods", required: true, impact: "已略過付款設定，目前無法接受線上付款。" },
  { key: "workspace_team", title: "邀請團隊成員", status: "not_started", estimateMinutes: 1, href: "/settings/team", required: false },
];

describe("OnboardingTaskCenter", () => {
  it("renders explicit progress, every task status, skip impact, and restart control", () => {
    const html = renderToStaticMarkup(
      <OnboardingTaskCenter scopeKey="workspace" scopeLabel="商家 Workspace" tasks={tasks} guideStopped />,
    );

    expect(html).toContain("商家 Workspace");
    expect(html).toContain("已完成 1/3");
    expect(html).toContain('aria-valuetext="1/3 已完成"');
    expect(html).toContain("已略過付款設定，目前無法接受線上付款。");
    expect(html).toContain("尚未開始");
    expect(html).toContain("可略過");
    expect(html).toContain("重新開始導引");
    expect(html).not.toContain("標記已完成");
  });

  it("keeps sidebar controls discoverable beside the task-center link", () => {
    const html = renderToStaticMarkup(
      <OnboardingTaskPanel
        title="商家上線任務"
        tasks={tasks.map((task) => ({ key: task.key, title: task.title, status: task.status, estimateMinutes: task.estimateMinutes, href: task.href, impact: task.impact }))}
        initiallyCollapsed={false}
        persistCollapsed={vi.fn(async () => {})}
      />,
    );

    expect(html).toContain("查看全部任務");
    expect(html).toContain("導引選項");
    expect(html).toContain("暫時隱藏 1 天");
    expect(html).toContain("一週後提醒");
    expect(html).toContain("停止顯示導引");
  });
});
