import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import MerchantOnboardingPage, { metadata } from "./page";

describe("/merchant-onboarding route", () => {
  it("renders a merchant guide with real steps and no internal release data", () => {
    const html = renderToStaticMarkup(<MerchantOnboardingPage />);

    expect(String(metadata.title)).toContain("商家使用指南");
    expect(html).toContain("商家使用指南");
    expect(html).toContain("目前功能範圍");
    for (const step of ["建立帳號並啟用多因子驗證", "邀請成員並設定角色", "設定品牌與追蹤", "建立商品與直播活動", "選擇方案並設定 PayUni", "了解客服與退款流程"]) {
      expect(html).toContain(step);
    }
    expect(html).toContain("平台方案目前不會自動扣款");
    // F-123: the in-app checklist is the single source of truth for progress.
    expect(html).toContain('href="/onboarding"');
    expect(html).toContain("上線導引"); 
    for (const href of ["/settings/security", "/settings/team", "/settings/brand", "/settings/tracking", "/products", "/lives", "/billing/plans", "/billing/payment-methods", "/support-cases", "/policies/refunds", "/support", "/policies"]) {
      expect(html).toContain(`href="${href}"`);
    }
    for (const internal of ["owner", "handoff", "草稿", "REQUIRED", "evidence", "release", "DNS"]) {
      expect(html).not.toContain(internal);
    }
  });
});
