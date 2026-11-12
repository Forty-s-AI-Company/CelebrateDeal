import { describe, expect, it } from "vitest";

import {
  buildOnboardingChecklist,
  merchantOnboardingOutline,
  merchantOnboardingProgress,
  nextOnboardingChecklistItem,
  onboardingChecklistItems,
  type MerchantOnboardingSignals,
} from "@/lib/merchant-onboarding";
import { evaluateProjectOnboarding } from "@/lib/sales-workspace";

const completeSignals: MerchantOnboardingSignals = {
  supportEmailConfigured: true,
  verifiedVendorPaymentMethodCount: 1,
  sellableProductCount: 1,
  activeFormCount: 1,
  activeInteractionRoleCount: 1,
  publishedInteractionScriptCount: 1,
  registrationEmailTemplateCount: 1,
  sellableLiveCount: 1,
  readyVideoCount: 1,
  trackingConfigured: true,
};

describe("merchantOnboardingProgress", () => {
  it("marks completion only when every sellable prerequisite exists", () => {
    expect(merchantOnboardingProgress(completeSignals)).toMatchObject({
      completedSteps: 5,
      totalSteps: 5,
      percentage: 100,
      complete: true,
      nextStep: null,
    });
  });

  it("treats interaction roles and scripts as optional suggestions, not required steps", () => {
    const progress = merchantOnboardingProgress({
      ...completeSignals,
      activeInteractionRoleCount: 0,
      publishedInteractionScriptCount: 0,
    });

    // 互動角色與腳本是選配：不影響完成度，也不是下一個必要步驟。
    expect(progress.complete).toBe(true);
    expect(progress.nextStep).toBeNull();
    const journey = progress.steps.find((item) => item.key === "journey");
    expect(journey?.done).toBe(true);
    expect(journey?.requirements.map((item) => item.label)).toEqual(["啟用報名表單", "啟用報名確認 Email"]);
    expect(journey?.suggestions).toEqual([
      expect.objectContaining({ label: "啟用互動角色", done: false, href: "/interaction-roles/new" }),
      expect.objectContaining({ label: "發布互動腳本", done: false, href: "/interaction-scripts/new" }),
    ]);
  });

  it("does not make optional tracking block commerce onboarding", () => {
    const progress = merchantOnboardingProgress({ ...completeSignals, trackingConfigured: false });

    expect(progress.complete).toBe(true);
    expect(progress.trackingConfigured).toBe(false);
  });

  it("shows every sales-live blocker with a direct recovery route", () => {
    const progress = merchantOnboardingProgress({
      ...completeSignals,
      sellableProductCount: 0,
      activeFormCount: 0,
      registrationEmailTemplateCount: 0,
      publishedInteractionScriptCount: 0,
      readyVideoCount: 0,
      sellableLiveCount: 0,
    });
    const launch = progress.steps.find((item) => item.key === "launch");

    expect(launch?.requirements).toEqual([
      expect.objectContaining({ label: "準備可播放媒體", done: false, href: "/videos/new" }),
      expect.objectContaining({ label: "建立可販售商品", done: false, href: "/products/new" }),
      expect.objectContaining({ label: "準備有效報名表單", done: false, href: "/forms/new" }),
      expect.objectContaining({ label: "啟用報名成功 Email", done: false, href: "/messages/templates/new" }),
      expect.objectContaining({ label: "完成直播綁定並進入可販售狀態", done: false, href: "/lives/new" }),
    ]);
  });

  it("defers external payment verification while local product work remains", () => {
    const progress = merchantOnboardingProgress({
      ...completeSignals,
      verifiedVendorPaymentMethodCount: 0,
      sellableProductCount: 0,
      sellableLiveCount: 0,
    });

    expect(progress.steps.find((item) => item.key === "payment")?.deferred).toBe(true);
    expect(progress.nextStep).toMatchObject({ key: "catalog", href: "/products/new" });
  });

  it.each([0, 1])("explains platform payment purpose without changing the persisted count signal %i", (count) => {
    const payment = merchantOnboardingProgress({ ...completeSignals, verifiedVendorPaymentMethodCount: count }).steps.find(item => item.key === "payment");
    expect(payment).toMatchObject({ key: "payment", title: "平台服務付款驗證", href: "/billing/payment-methods", actionLabel: "設定平台付款方式", deferred: true });
    expect(payment?.description).toContain("顧客收款設定需另外確認");
    expect(payment?.description).toContain("這不是顧客結帳收款設定");
    expect(payment?.requirements).toEqual([{ label: "有效的商家平台服務付款紀錄", done: count > 0 }]);
  });
});

describe("merchantOnboardingProgress required path", () => {
  it("still routes the merchant to the first missing required requirement", () => {
    const progress = merchantOnboardingProgress({ ...completeSignals, activeFormCount: 0 });
    expect(progress.complete).toBe(false);
    expect(progress.nextStep).toMatchObject({ key: "journey", href: "/forms/new" });
  });
});

describe("buildOnboardingChecklist (the single 上線任務 list)", () => {
  const incomplete = merchantOnboardingProgress({ ...completeSignals, verifiedVendorPaymentMethodCount: 0, activeFormCount: 0, sellableLiveCount: 0 });

  function projectProgress(flow: "live" | "consultation", signals: Partial<Parameters<typeof evaluateProjectOnboarding>[1]> = {}, states: Parameters<typeof evaluateProjectOnboarding>[2] = []) {
    return evaluateProjectOnboarding(flow, {
      exists: true, hasLinkedProduct: true, hasPricedProduct: true, hasFunnelTemplate: false, hasLiveSession: true,
      hasConsultationService: false, hasAvailability: false, hasPaymentMethod: true, hasPreviewableFlow: true, isPublished: false,
      ...signals,
    }, states);
  }

  it("is exactly the merchant steps when no project is selected", () => {
    const checklist = buildOnboardingChecklist(incomplete);
    expect(checklist.steps).toEqual(incomplete.steps);
    expect(checklist).toMatchObject({ completedSteps: incomplete.completedSteps, totalSteps: 5, percentage: incomplete.percentage, complete: false, project: null });
    expect(checklist.nextStep).toBe(incomplete.nextStep);
  });

  it("appends the selected project's publish gate as one step linking to the first missing task", () => {
    const checklist = buildOnboardingChecklist(merchantOnboardingProgress(completeSignals), { id: "p 1", name: "春季講座", primaryFlow: "live", progress: projectProgress("live"), cardBindingRequired: true });
    const project = checklist.steps.at(-1)!;
    expect(checklist.totalSteps).toBe(6);
    expect(project).toMatchObject({ key: "project", title: "發布專案「春季講座」", done: false, href: "/forms/new", actionLabel: "建立報名表單" });
    expect(project.requirements.map((item) => [item.label, item.href, item.done])).toEqual([
      ["建立商品", "/products/new", true],
      ["建立報名表單", "/forms/new", false],
      ["設定直播場次", "/lives/new", true],
      ["檢查發布所需付款驗證", "/billing/payment-methods", true],
      ["預覽流程", "/projects/p%201", true],
      ["發布並取得分享連結", "/projects/p%201", false],
    ]);
    expect(checklist.nextStep).toBe(project);
  });

  it("hides the card-binding requirement while funnel_binding is closed, like the publish gate", () => {
    const checklist = buildOnboardingChecklist(merchantOnboardingProgress(completeSignals), { id: "p1", name: "P", primaryFlow: "live", progress: projectProgress("live"), cardBindingRequired: false });
    expect(checklist.steps.at(-1)!.requirements.map((item) => item.label)).not.toContain("檢查發布所需付款驗證");
  });

  it("explains a skipped project task instead of counting it as done", () => {
    const progress = projectProgress("live", { hasPaymentMethod: false }, [{ taskKey: "project_payment", status: "skipped" }]);
    const project = buildOnboardingChecklist(merchantOnboardingProgress(completeSignals), { id: "p1", name: "P", primaryFlow: "live", progress, cardBindingRequired: true }).steps.at(-1)!;
    const payment = project.requirements.find((item) => item.label === "檢查發布所需付款驗證")!;
    expect(payment.done).toBe(false);
    expect(payment.note).toContain("顧客收款狀態需另行確認");
  });

  it("is complete only once the project is published", () => {
    const published = buildOnboardingChecklist(merchantOnboardingProgress(completeSignals), { id: "p1", name: "P", primaryFlow: "live", progress: projectProgress("live", { hasFunnelTemplate: true, isPublished: true }), cardBindingRequired: true });
    expect(published).toMatchObject({ complete: true, completedSteps: 6, totalSteps: 6, percentage: 100, nextStep: null });
  });

  it("does not send a consultation project to build a sellable live first", () => {
    const checklist = buildOnboardingChecklist(
      merchantOnboardingProgress({ ...completeSignals, sellableLiveCount: 0, readyVideoCount: 0 }),
      { id: "c1", name: "諮詢", primaryFlow: "consultation", progress: projectProgress("consultation"), cardBindingRequired: true },
    );
    expect(checklist.steps.find((item) => item.key === "launch")).toMatchObject({ done: false, deferred: true, deferredLabel: "諮詢專案不需要，可稍後" });
    expect(checklist.nextStep).toMatchObject({ key: "project", href: "/consultations", actionLabel: "建立諮詢服務" });
  });
});

describe("onboardingChecklistItems (sidebar panel rows)", () => {
  it.each([
    ["new merchant", { ...completeSignals, supportEmailConfigured: false, verifiedVendorPaymentMethodCount: 0, sellableProductCount: 0, activeFormCount: 0, registrationEmailTemplateCount: 0, sellableLiveCount: 0, readyVideoCount: 0 }],
    ["payment is the only gap", { ...completeSignals, verifiedVendorPaymentMethodCount: 0 }],
    ["local work and payment remain", { ...completeSignals, verifiedVendorPaymentMethodCount: 0, activeFormCount: 0 }],
    ["complete", completeSignals],
  ] as const)("mirrors /onboarding step by step: %s", (_name, signals) => {
    const checklist = buildOnboardingChecklist(merchantOnboardingProgress(signals));
    const items = onboardingChecklistItems(checklist);
    expect(items.map((item) => [item.key, item.title, item.href, item.status === "completed"])).toEqual(checklist.steps.map((item) => [item.key, item.title, item.href, item.done]));
    expect(items.filter((item) => item.status === "completed")).toHaveLength(checklist.completedSteps);
    expect(nextOnboardingChecklistItem(items)?.key ?? null).toBe(checklist.nextStep?.key ?? null);
  });
});

describe("merchantOnboardingOutline (public guide)", () => {
  it("lists the same steps without any status", () => {
    const outline = merchantOnboardingOutline();
    expect(outline.map((item) => item.key)).toEqual(merchantOnboardingProgress(completeSignals).steps.map((item) => item.key));
    for (const item of outline) expect(item).not.toHaveProperty("done");
    expect(outline.find((item) => item.key === "payment")).toMatchObject({ title: "平台服務付款驗證", deferred: true, href: "/billing/payment-methods" });
  });
});
