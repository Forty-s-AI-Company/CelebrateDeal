import { describe, expect, it } from "vitest";

import { merchantOnboardingProgress, type MerchantOnboardingSignals } from "@/lib/merchant-onboarding";

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

  it("routes the merchant to the first missing persisted requirement", () => {
    const progress = merchantOnboardingProgress({
      ...completeSignals,
      activeInteractionRoleCount: 0,
      publishedInteractionScriptCount: 0,
    });

    expect(progress.complete).toBe(false);
    expect(progress.nextStep).toMatchObject({
      key: "journey",
      href: "/interaction-roles/new",
      actionLabel: "啟用互動角色",
    });
    expect(progress.steps.find((item) => item.key === "journey")?.requirements).toContainEqual({
      label: "發布互動腳本",
      done: false,
    });
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
      expect.objectContaining({ label: "發布互動腳本", done: false, href: "/interaction-scripts/new" }),
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
});
