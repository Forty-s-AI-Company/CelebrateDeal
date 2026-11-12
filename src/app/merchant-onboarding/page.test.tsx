import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { merchantOnboardingOutline } from "@/lib/merchant-onboarding";
import MerchantOnboardingPage, { metadata } from "./page";

describe("/merchant-onboarding route", () => {
  it("renders the same steps as the signed-in onboarding list, with no internal release data", () => {
    const html = renderToStaticMarkup(<MerchantOnboardingPage />);

    expect(String(metadata.title)).toContain("商家使用指南");
    expect(html).toContain("商家使用指南");
    expect(html).toContain("目前功能範圍");
    // U1: one list. The public guide renders the /onboarding steps in the same order.
    const outline = merchantOnboardingOutline();
    expect(outline.map((step) => step.title)).toEqual(["商店與客服資料", "平台服務付款驗證", "建立可販售商品", "完成報名流程", "準備第一場可販售直播"]);
    let cursor = 0;
    for (const step of outline) {
      const at = html.indexOf(step.title, cursor);
      expect(at, step.title).toBeGreaterThan(cursor);
      cursor = at;
      expect(html).toContain(`href="${step.href}"`);
    }
    expect(html).toContain("開始銷售的 5 個步驟");
    expect(html).toContain("平台方案目前不會自動扣款");
    // F-123: the in-app checklist is the single source of truth for progress.
    expect(html).toContain('href="/onboarding"');
    expect(html).toContain("上線導引");
    for (const href of ["/settings/security", "/settings/team", "/settings/brand", "/settings/tracking", "/billing/plans", "/billing/payment-methods", "/support-cases", "/policies/refunds", "/support", "/policies"]) {
      expect(html).toContain(`href="${href}"`);
    }
    for (const internal of ["owner", "handoff", "草稿", "REQUIRED", "evidence", "release", "DNS"]) {
      expect(html).not.toContain(internal);
    }
  });

  it("does not imply that platform payment setup enables customer checkout", () => {
    const html = renderToStaticMarkup(<MerchantOnboardingPage />);
    expect(html).not.toContain("選擇方案並設定 PayUni");
    expect(html).toContain("平台服務付款驗證");
    expect(html).toContain("這不是顧客結帳收款設定");
    expect(html).toContain("顧客收款設定需另外確認");
  });
});
