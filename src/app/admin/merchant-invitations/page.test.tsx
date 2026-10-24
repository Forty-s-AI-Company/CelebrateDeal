import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ requireFinanceAdmin: vi.fn(), recent: vi.fn(), actionState: null as unknown }));

vi.mock("@/lib/auth", () => ({ requireFinanceAdmin: mocks.requireFinanceAdmin }));
vi.mock("@/lib/merchant-registration-invite-records", () => ({ recentMerchantInvitations: mocks.recent }));
vi.mock("@/app/actions/merchant-invitation-actions", () => ({ createMerchantInvitationAction: vi.fn(), revokeMerchantInvitationAction: vi.fn() }));
vi.mock("@/components/csrf-field", () => ({ CsrfField: () => <input type="hidden" name="_csrf" value="synthetic" /> }));
vi.mock("react", async (importOriginal) => {
  const react = await importOriginal<typeof import("react")>();
  return {
    ...react,
    useActionState: (action: unknown, initial: unknown) => [mocks.actionState ?? initial, action, false],
  };
});

import AdminMerchantInvitationsPage from "./page";

async function render(searchParams: Record<string, string> = {}) {
  return renderToStaticMarkup(await AdminMerchantInvitationsPage({ searchParams: Promise.resolve(searchParams) }));
}

function admin(mfaVerifiedAt: Date | null = new Date()) {
  return { user: { id: "admin-1", mfaFactor: { id: "mfa-1" } }, session: { mfaVerifiedAt }, isPlatformAdmin: true };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.actionState = null;
  vi.stubEnv("REGISTRATION_MODE", "");
  mocks.requireFinanceAdmin.mockResolvedValue(admin());
  mocks.recent.mockResolvedValue([]);
});
afterEach(() => vi.unstubAllEnvs());

describe("/admin/merchant-invitations", () => {
  it("runs the platform-admin guard before reading anything", async () => {
    mocks.requireFinanceAdmin.mockRejectedValue(new Error("redirect:/dashboard"));
    await expect(render()).rejects.toThrow("redirect:/dashboard");
    expect(mocks.recent).not.toHaveBeenCalled();
  });

  it("renders the invite form, the current mode and an empty history without a note field", async () => {
    const html = await render();
    expect(html).toContain("商家邀請");
    expect(html).toContain("14 天內有效");
    expect(html).toContain("系統不會自動寄信");
    expect(html).toContain('data-registration-mode="invite"');
    expect(html).toContain("目前註冊模式：僅限受邀");
    expect(html).toContain('name="email"');
    expect(html).not.toContain('name="note"');
    expect(html).toContain('name="_csrf"');
    expect(html).toContain("產生邀請連結");
    expect(html).toContain("還沒有產生過邀請");
    expect(html).not.toContain("需要驗證");
    expect(html).not.toContain("data-invitation-result");
  });

  it("asks for a fresh MFA verification when the step-up window has passed", async () => {
    mocks.requireFinanceAdmin.mockResolvedValue(admin(new Date(Date.now() - 20 * 60_000)));
    const html = await render();
    expect(html).toContain("需要驗證");
    expect(html).toContain("產生或撤銷商家邀請前，請先輸入手機上的驗證碼");
    expect(html).toContain("/mfa/verify?reason=step_up");
    expect(html).toContain("next=%2Fadmin%2Fmerchant-invitations");
  });

  it("states when registration is open", async () => {
    vi.stubEnv("REGISTRATION_MODE", "open");
    const html = await render();
    expect(html).toContain('data-registration-mode="open"');
    expect(html).toContain("目前註冊模式：開放註冊");
  });

  it("lists masked invitations with status and a revoke form only for pending ones", async () => {
    mocks.recent.mockResolvedValue([
      { jti: "jti-registered-000001", createdAt: new Date("2026-10-24T02:00:00.000Z"), maskedEmail: "d***@example.test", expiresAt: "2026-11-07T02:00:00.000Z", status: "registered" },
      { jti: "jti-pending-0000000001", createdAt: new Date("2026-10-24T03:00:00.000Z"), maskedEmail: "p***@example.test", expiresAt: "2099-01-01T00:00:00.000Z", status: "pending" },
      { jti: "jti-revoked-0000000001", createdAt: new Date("2026-10-24T04:00:00.000Z"), maskedEmail: "r***@example.test", expiresAt: "2026-11-07T04:00:00.000Z", status: "revoked" },
      { jti: "jti-expired-0000000001", createdAt: new Date("2026-10-01T02:00:00.000Z"), maskedEmail: null, expiresAt: null, status: "expired" },
    ]);
    const html = await render();
    const row = (status: string) => html.slice(html.indexOf(`data-invitation-status="${status}"`), html.indexOf("</tr>", html.indexOf(`data-invitation-status="${status}"`)));
    expect(row("registered")).toContain("d***@example.test");
    expect(row("registered")).toContain("已註冊");
    expect(row("registered")).toContain("2026/10/24 10:00");
    expect(row("registered")).not.toContain("撤銷");
    expect(row("pending")).toContain("尚未註冊");
    expect(row("pending")).toContain('name="jti" value="jti-pending-0000000001"');
    expect(row("pending")).toContain('name="_csrf"');
    expect(row("pending")).toContain("撤銷 p***@example.test 的邀請");
    expect(row("revoked")).toContain("已撤銷");
    expect(row("revoked")).not.toContain('name="jti"');
    expect(row("expired")).toContain("已過期");
    expect(row("expired")).toContain("—");
    expect(html.match(/name="jti"/gu)).toHaveLength(1);
  });

  it("confirms a revocation and explains an unknown one", async () => {
    expect(await render({ revoked: "1" })).toContain("邀請已撤銷，這個連結不能再用來註冊。");
    const error = await render({ error: "revoke_not_found" });
    expect(error).toContain('role="alert"');
    expect(error).toContain("找不到這個邀請，未做任何變更。");
  });

  it("shows a generated link with its expiry and a copy button", async () => {
    mocks.actionState = { status: "created", email: "new@example.test", link: "https://app.example.test/register?invite=mri1.synthetic.sig", expiresAt: "2026-11-08T00:00:00.000Z" };
    const html = await render();
    expect(html).toContain('data-invitation-result="created"');
    expect(html).toContain("已產生 new@example.test 的邀請連結");
    expect(html).toContain("有效期限至 2026/11/08 08:00（台灣時間）");
    expect(html).toContain('value="https://app.example.test/register?invite=mri1.synthetic.sig"');
    expect(html).toContain("複製邀請連結");
  });

  it("shows an action error as an alert", async () => {
    mocks.actionState = { status: "error", message: "這個 Email 已經有帳號，請對方直接登入，不需要邀請連結。" };
    const html = await render();
    expect(html).toContain('role="alert"');
    expect(html).toContain("這個 Email 已經有帳號");
    expect(html).not.toContain("data-invitation-result");
  });
});
