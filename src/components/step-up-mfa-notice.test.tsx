import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { StepUpMfaNotice } from "./step-up-mfa-notice";

describe("StepUpMfaNotice", () => {
  it("renders nothing once the session has a fresh verification", () => {
    expect(renderToStaticMarkup(<StepUpMfaNotice status="verified" nextPath="/billing/plans" operation="選擇付費方案" />)).toBe("");
  });

  it("asks a user without a factor to enable MFA before the operation", () => {
    const html = renderToStaticMarkup(<StepUpMfaNotice status="setup_required" nextPath="/settings/security" operation="邀請商家成員" />);
    expect(html).toContain("需要驗證");
    expect(html).toContain("邀請商家成員前需先啟用雙重驗證");
    expect(html).toContain('href="/mfa/setup?reason=step_up&amp;next=%2Fsettings%2Fsecurity"');
  });

  it("asks a user with a stale verification to verify again within 15 minutes", () => {
    const html = renderToStaticMarkup(<StepUpMfaNotice status="verification_required" nextPath="/billing/payment-methods" operation="設定付款方式" />);
    expect(html).toContain("15 分鐘內完成雙重驗證");
    expect(html).toContain('href="/mfa/verify?reason=step_up&amp;next=%2Fbilling%2Fpayment-methods"');
  });
});
