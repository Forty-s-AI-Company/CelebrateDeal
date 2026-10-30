import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ requireFinanceAdmin: vi.fn(), list: vi.fn(), describe: vi.fn() }));
vi.mock("@/lib/auth", () => ({ requireFinanceAdmin: mocks.requireFinanceAdmin }));
vi.mock("@/lib/account-security-hold", () => ({
  ACCOUNT_SECURITY_HOLDS_PATH: "/admin/account-holds",
  ACCOUNT_SECURITY_HOLD_STATUS: "security_hold",
  ACCOUNT_MFA_REMOVAL_REASON_MIN_LENGTH: 10,
  ACCOUNT_MFA_REMOVAL_REASON_MAX_LENGTH: 500,
  listAccountSecurityHolds: mocks.list,
  describeAccountForMfaRemoval: mocks.describe,
}));
vi.mock("@/app/actions/account-security-hold-actions", () => ({
  releaseAccountSecurityHoldAction: vi.fn(),
  lookupAccountForMfaRemovalAction: vi.fn(),
  removeAccountMfaAction: vi.fn(),
}));
vi.mock("@/components/csrf-field", () => ({ CsrfField: () => <input type="hidden" name="_csrf" value="synthetic" /> }));

import AdminAccountHoldsPage from "./page";

async function render(searchParams: Record<string, string> = {}) {
  return renderToStaticMarkup(await AdminAccountHoldsPage({ searchParams: Promise.resolve(searchParams) }));
}

beforeEach(() => {
  mocks.requireFinanceAdmin.mockReset().mockResolvedValue({ user: { id: "admin-1", mfaFactor: { id: "f" } }, session: { mfaVerifiedAt: new Date() } });
  mocks.list.mockReset().mockResolvedValue([]);
  mocks.describe.mockReset().mockResolvedValue(null);
});

const target = { userId: "user-9", maskedEmail: "t***@example.test", status: "active", hasMfaFactor: true, recoveryCodeCount: 8, isPlatformAdmin: false };

describe("/admin/account-holds", () => {
  it("is guarded by the platform-admin check and shows an empty state", async () => {
    const html = await render();
    expect(mocks.requireFinanceAdmin).toHaveBeenCalledOnce();
    expect(html).toContain("帳號安全暫停");
    expect(html).toContain("目前沒有暫停的帳號");
  });

  it("lists held accounts by masked address with a release form per account", async () => {
    mocks.list.mockResolvedValue([{ userId: "user-1", maskedEmail: "o***@example.test", heldAt: new Date("2026-10-30T02:00:00Z"), hasMfaFactor: true }]);
    const html = await render({ released: "1" });
    expect(html).toContain("o***@example.test");
    expect(html).toContain('name="userId" value="user-1"');
    expect(html).toContain('name="removeMfaFactor"');
    expect(html).toContain("確認身分後恢復帳號");
    expect(html).toContain("帳號已恢復");
  });

  it("offers the MFA lookup without a target and never reads an account for a malformed id", async () => {
    const html = await render({ mfaUser: "../x" });
    expect(html).toContain("移除兩步驟驗證");
    expect(html).toContain('name="email"');
    expect(html).not.toContain('name="confirmation"');
    expect(mocks.describe).not.toHaveBeenCalled();
  });

  it("shows a looked-up account masked, with a removal form that asks for a reason and the retyped masked address", async () => {
    mocks.describe.mockResolvedValue(target);
    const html = await render({ mfaUser: "user-9" });
    expect(mocks.describe).toHaveBeenCalledWith("user-9");
    expect(html).toContain("t***@example.test");
    expect(html).toContain("8 組");
    expect(html).toContain('name="userId" value="user-9"');
    expect(html).toMatch(/<textarea[^>]*name="reason"[^>]*required/u);
    expect(html).toContain('name="confirmation"');
    expect(html).toContain("確認身分後移除兩步驟驗證");
    // Only the masked address appears.
    expect(html.replaceAll("t***@example.test", "")).not.toContain("@example.test");
  });

  it("offers no removal form for the admin's own account or an account that is not active", async () => {
    mocks.describe.mockResolvedValue({ ...target, userId: "admin-1" });
    let html = await render({ mfaUser: "admin-1" });
    expect(html).toContain("這是你自己的帳號");
    expect(html).not.toContain('name="confirmation"');
    mocks.describe.mockResolvedValue({ ...target, status: "security_hold" });
    html = await render({ mfaUser: "user-9" });
    expect(html).toContain("安全暫停");
    expect(html).not.toContain('name="confirmation"');
    mocks.describe.mockResolvedValue({ ...target, isPlatformAdmin: true });
    html = await render({ mfaUser: "user-9" });
    expect(html).toContain("平台管理員帳號不能用這個工具");
    expect(html).not.toContain('name="confirmation"');
  });

  it.each([
    ["self", "不能移除自己帳號的兩步驟驗證"],
    ["confirmation_mismatch", "確認欄位與遮罩後的 Email 不一致"],
    ["invalid_reason", "請填寫原因（10–500 字）"],
    ["not_active", "不是使用中狀態"],
    ["platform_role", "平台管理員帳號不能用這個工具"],
    ["unexpected", "找不到這個登入 Email 的帳號"],
  ])("explains the %s result", async (mfaError, text) => {
    expect(await render({ mfaError })).toContain(text);
  });

  it("confirms a removal", async () => {
    const html = await render({ mfaRemoved: "1" });
    expect(html).toContain("已移除兩步驟驗證與備用碼、停用密碼");
    expect(html).toContain("忘記密碼");
  });
});
