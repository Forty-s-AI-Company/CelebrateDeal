import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ requireAuth: vi.fn(), pending: null as unknown, codes: null as unknown }));
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined }) }));
vi.mock("@/components/csrf-field", () => ({ CsrfField: () => null }));
vi.mock("@/lib/mfa", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/mfa")>()),
  parsePendingMfaSetup: () => mocks.pending,
  parseRecoveryCodes: () => mocks.codes,
}));
vi.mock("@/lib/auth", () => ({ requireAuth: mocks.requireAuth }));
vi.mock("@/app/actions", () => ({ sendPasswordResetSmokeAction: vi.fn() }));
vi.mock("@/lib/password-reset-smoke-policy", () => ({ isPasswordResetSmokeEnabled: () => false }));
vi.mock("@/lib/e2e-loading-diagnostic", () => ({ applyE2eLoadingDelay: vi.fn() }));

import MfaSetupPage from "./page";
import SecuritySettingsPage from "../../(app)/settings/security/page";

describe("MFA page authentication return context", () => {
  beforeEach(() => {
    mocks.requireAuth.mockReset();
    // Stop at the guard as an unverified session would; no private setup data is read.
    mocks.requireAuth.mockRejectedValue(new Error("auth-guard-redirect"));
  });

  for (const [name, page] of [["setup", MfaSetupPage], ["settings", SecuritySettingsPage]] as const) {
    it.each(["/orders?status=paid", "//outside.invalid", "/\t/evil.example", "/\\evil.example", "javascript:alert(1)"])(`${name} passes only a safe next to the authentication guard: %j`, async (next) => {
      await expect(page({ searchParams: Promise.resolve({ next }) })).rejects.toThrow("auth-guard-redirect");
      expect(mocks.requireAuth).toHaveBeenCalledWith({ nextPath: next === "/orders?status=paid" ? next : undefined });
    });
  }
});

const FAKE_SECRET = ["JBSW", "Y3DP", "EHPK"].join("");
const FAKE_RECOVERY = ["ABCDE", "12345"].join("-");

async function render(searchParams: Record<string, string> = {}, auth: { mfaFactor: boolean; verified?: boolean; unused?: number } = { mfaFactor: false }) {
  mocks.requireAuth.mockResolvedValue({
    user: {
      id: "user-1",
      email: "owner@example.com",
      mfaFactor: auth.mfaFactor ? { id: "f1" } : null,
      recoveryCodes: Array.from({ length: auth.unused ?? 0 }, () => ({ usedAt: null })),
    },
    isMfaVerified: auth.verified ?? false,
  });
  return renderToStaticMarkup(await MfaSetupPage({ searchParams: Promise.resolve(searchParams) }));
}

describe("/mfa/setup 白話教學", () => {
  beforeEach(() => {
    mocks.pending = null;
    mocks.codes = null;
  });

  it("尚未設定時先說明原因，並用有序步驟列出三步與第四步標題", async () => {
    const html = await render();
    expect(html).toContain("登入帳號時不需要");
    expect(html).toContain("<ol");
    for (const title of ["第一步：在手機安裝「驗證碼 App」", "第二步：用 App 掃描 QR code", "第三步：輸入 App 上的 6 位數數字", "第四步：保存備用救援碼"]) {
      expect(html).toContain(title);
    }
    expect(html).toContain("開始設定雙重驗證");
    expect(html).not.toMatch(/TOTP|MFA|[Rr]ecovery/);
  });

  it("產生 QR code 後顯示輸入欄位，手動輸入區預設收合", async () => {
    mocks.pending = { userId: "user-1", secret: FAKE_SECRET };
    const html = await render({ updated: "mfa_started" });
    expect(html).toContain("掃不了？改用手動輸入");
    expect(html).toContain(FAKE_SECRET);
    expect(html).toMatch(/<details(?![^>]*sopen)/u);
    expect(html).toContain("完成設定");
    expect(html).toContain('role="status"');
    expect(html).toContain("已產生 QR code");
  });

  it("設定成功後顯示備用救援碼說明與保存按鈕", async () => {
    mocks.codes = [FAKE_RECOVERY];
    const html = await render({ updated: "mfa_enabled" }, { mfaFactor: true, verified: true, unused: 8 });
    expect(html).toContain(FAKE_RECOVERY);
    expect(html).toContain("每一組只能用一次");
    expect(html).toContain("離開這個頁面後就不會再顯示");
    expect(html).toContain("我已保存備用救援碼");
    expect(html).toContain("複製全部");
    expect(html).toContain("下載成文字檔");
    expect(html).toContain("建議先下載或複製，再按「我已保存」");
    expect(html).toContain("已開啟雙重驗證，請先保存備用救援碼。");
  });

  it("已登記時說明已開啟、剩餘組數與重新產生方式", async () => {
    const html = await render({}, { mfaFactor: true, verified: true, unused: 7 });
    expect(html).toContain("雙重驗證已開啟");
    expect(html).toContain("你還有 7 組備用救援碼可用");
    expect(html).toContain("重新產生備用救援碼");
    expect(html).not.toContain("第一步");
  });

  it.each([
    ["mfa_code", "每 30 秒會換一組"],
    ["recovery_rate_limited", "請 15 分鐘後再試"],
    ["recovery_unavailable", "請稍後再試"],
    ["mfa_required", "請先完成雙重驗證設定"],
  ])("錯誤碼 %s 對應白話文案", async (error, text) => {
    const html = await render({ error });
    expect(html).toContain('role="alert"');
    expect(html).toContain(text);
  });
});
