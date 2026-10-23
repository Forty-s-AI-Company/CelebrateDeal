import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ requireAuth: vi.fn() }));
vi.mock("@/lib/auth", () => ({ requireAuth: mocks.requireAuth }));
vi.mock("@/app/actions", () => ({ verifyMfaAction: vi.fn() }));
vi.mock("@/components/csrf-field", () => ({ CsrfField: () => null }));

import MfaVerifyPage from "./page";

async function hiddenNext(next: string | undefined) {
  const html = renderToStaticMarkup(await MfaVerifyPage({ searchParams: Promise.resolve({ next }) }));
  return /name="next" value="([^"]*)"/u.exec(html)?.[1];
}

describe("/mfa/verify return path", () => {
  beforeEach(() => {
    mocks.requireAuth.mockResolvedValue({ user: { id: "user-1" } });
  });

  it("keeps an in-app destination", async () => {
    expect(await hiddenNext("/billing/plans")).toBe("/billing/plans");
  });

  it.each(["/\t/evil.example", "//evil.example", "/\\evil.example", "javascript:alert(1)", "https://evil.example", undefined])(
    "replaces the unsafe next %j with the default page",
    async (next) => {
      expect(await hiddenNext(next)).toBe("/admin/billing/dashboard");
    },
  );

  it("explains a step-up request", async () => {
    const html = renderToStaticMarkup(await MfaVerifyPage({ searchParams: Promise.resolve({ reason: "step_up" }) }));
    expect(html).toContain("回到剛才的頁面，請再按一次送出");
  });

  it("用白話說明標題、輸入來源與備用救援碼格式", async () => {
    const html = renderToStaticMarkup(await MfaVerifyPage({ searchParams: Promise.resolve({}) }));
    expect(html).toContain("輸入驗證碼");
    expect(html).toContain("打開手機上的驗證碼 App");
    expect(html).toContain("備用救援碼（格式像 ABCDE-12345）");
    expect(html).not.toMatch(/TOTP|MFA|[Rr]ecovery/);
  });

  it.each([
    ["invalid", "每 30 秒會換一組"],
    ["rate_limited", "請稍後再試"],
    ["locked", "已暫停 1 小時"],
    ["temporarily_unavailable", "聯絡平台客服"],
  ])("錯誤碼 %s 對應白話文案", async (error, text) => {
    const html = renderToStaticMarkup(await MfaVerifyPage({ searchParams: Promise.resolve({ error }) }));
    expect(html).toContain('role="alert"');
    expect(html).toContain(text);
  });
});
