import { describe, expect, it } from "vitest";
import { dashboardChecklistForRole, isDashboardManagerRole } from "@/lib/dashboard-checklist";
import { buildOnboardingChecklist, merchantOnboardingProgress, type MerchantOnboardingSignals } from "@/lib/merchant-onboarding";

const signals: MerchantOnboardingSignals = {
  supportEmailConfigured: true,
  verifiedVendorPaymentMethodCount: 0,
  sellableProductCount: 1,
  activeFormCount: 0,
  activeInteractionRoleCount: 1,
  publishedInteractionScriptCount: 0,
  registrationEmailTemplateCount: 0,
  sellableLiveCount: 0,
  readyVideoCount: 0,
  trackingConfigured: true,
};
const checklist = buildOnboardingChecklist(merchantOnboardingProgress(signals));

describe("dashboardChecklistForRole", () => {
  it.each(["owner", "admin"])("identifies %s as a dashboard manager", (role) => {
    expect(isDashboardManagerRole(role)).toBe(true);
  });

  it.each(["accountant", "member", null])(
    "does not identify non-manager role %s as a dashboard manager",
    (role) => {
      expect(isDashboardManagerRole(role)).toBe(false);
    },
  );

  it.each(["owner", "admin"])("shows %s the same steps, links and status as /onboarding", (role) => {
    expect(dashboardChecklistForRole(checklist, role)).toEqual(checklist.steps.map((step) => ({ label: step.title, href: step.href, done: step.done })));
    expect(dashboardChecklistForRole(checklist, role)).toEqual([
      { label: "商店與客服資料", href: "/settings/brand", done: true },
      { label: "平台服務付款驗證", href: "/billing/payment-methods", done: false },
      { label: "建立可販售商品", href: "/products/new", done: true },
      { label: "完成報名流程", href: "/forms/new", done: false },
      { label: "準備第一場可販售直播", href: "/videos/new", done: false },
    ]);
  });

  it.each(["accountant", "member", null])(
    "removes manager-only setup links for non-manager role %s",
    (role) => {
      expect(dashboardChecklistForRole(checklist, role)).toEqual([]);
    },
  );

  it("shows nothing when the onboarding list was not loaded", () => {
    expect(dashboardChecklistForRole(null, "owner")).toEqual([]);
  });
});
