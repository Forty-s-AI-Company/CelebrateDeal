// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  buildOnboardingChecklist,
  merchantOnboardingProgress,
  onboardingChecklistItems,
  type MerchantOnboardingSignals,
} from "@/lib/merchant-onboarding";
import { dashboardChecklistForRole } from "@/lib/dashboard-checklist";

const navigation = vi.hoisted(() => ({ pathname: "/dashboard", refresh: vi.fn() }));
vi.mock("next/navigation", () => ({ usePathname: () => navigation.pathname, useRouter: () => ({ refresh: navigation.refresh }) }));
vi.mock("@/app/actions/sales-workspace-actions", () => ({ controlOnboardingGuideAction: vi.fn() }));

import { OnboardingTaskPanel } from "./onboarding-task-panel";
import MerchantOnboardingPage from "@/app/merchant-onboarding/page";

const signals: MerchantOnboardingSignals = {
  supportEmailConfigured: true,
  verifiedVendorPaymentMethodCount: 0,
  sellableProductCount: 1,
  activeFormCount: 0,
  activeInteractionRoleCount: 0,
  publishedInteractionScriptCount: 0,
  registrationEmailTemplateCount: 1,
  sellableLiveCount: 0,
  readyVideoCount: 0,
  trackingConfigured: false,
};

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  navigation.pathname = "/dashboard";
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

function renderPanel(items: ReturnType<typeof onboardingChecklistItems>) {
  act(() => root.render(<OnboardingTaskPanel title="上線任務" tasks={items} initiallyCollapsed={false} persistCollapsed={async () => {}} />));
}

describe("every entry point shows the same onboarding steps and status", () => {
  const checklist = buildOnboardingChecklist(merchantOnboardingProgress(signals));
  const items = onboardingChecklistItems(checklist);

  it("sidebar panel: same count, progress and next step as /onboarding", () => {
    renderPanel(items);
    const toggle = container.querySelector("button[aria-expanded]")!;
    expect(toggle.textContent).toContain(`上線任務 ${checklist.completedSteps}/${checklist.totalSteps}`);
    const progressbar = container.querySelector('[role="progressbar"]')!;
    expect(progressbar.getAttribute("aria-valuenow")).toBe(String(checklist.percentage));
    // The deferred external payment step is not offered first, exactly like /onboarding's「繼續」.
    expect(checklist.nextStep?.key).toBe("journey");
    expect(container.textContent).toContain(checklist.nextStep!.title);
    const next = [...container.querySelectorAll("a")].find((link) => link.textContent === "繼續設定")!;
    expect(next.getAttribute("href")).toBe(checklist.nextStep!.href);
    const all = [...container.querySelectorAll("a")].find((link) => link.textContent === "查看全部任務")!;
    expect(all.getAttribute("href")).toBe("/onboarding");
  });

  it("sidebar panel: no emoji, gradient or skip control for checklist steps", () => {
    renderPanel(items);
    expect(container.innerHTML).not.toMatch(/gradient/u);
    expect(container.textContent).not.toMatch(/\p{Extended_Pictographic}/u);
    expect(container.textContent).not.toContain("略過此任務");
  });

  it("sidebar panel: tells the merchant when they are already on the next step's page", () => {
    navigation.pathname = checklist.nextStep!.href;
    renderPanel(items);
    expect(container.textContent).toContain("你已在這個任務的設定頁");
  });

  it("dashboard card: same titles, links and status", () => {
    expect(dashboardChecklistForRole(checklist, "owner")).toEqual(items.map((item) => ({ label: item.title, href: item.href, done: item.status === "completed" })));
  });

  it("public guide: same step titles in the same order", () => {
    const html = renderToStaticMarkup(<MerchantOnboardingPage />);
    const positions = checklist.steps.map((step) => html.indexOf(step.title));
    expect(positions.every((position) => position >= 0)).toBe(true);
    expect([...positions].sort((a, b) => a - b)).toEqual(positions);
  });
});
