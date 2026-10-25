import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ findInvitation: vi.fn(), findUser: vi.fn(), getCurrentAuth: vi.fn(), requireAuth: vi.fn() }));

vi.mock("@/lib/vendor-member-invitation", () => ({ findPendingVendorMemberInvitation: mocks.findInvitation }));
vi.mock("@/lib/db", () => ({ getDb: () => ({ user: { findUnique: mocks.findUser } }) }));
vi.mock("@/lib/auth", () => ({ getCurrentAuth: mocks.getCurrentAuth, requireAuth: mocks.requireAuth }));
vi.mock("@/app/actions/vendor-member-invitation-actions", () => ({ acceptVendorMemberInvitationAction: vi.fn() }));
vi.mock("@/components/csrf-field", () => ({ CsrfField: () => <input type="hidden" name="csrf" value="synthetic" /> }));

import AcceptVendorInvitationPage from "./page";

const invitation = {
  id: "invitation-1",
  vendorId: "vendor-1",
  email: "member@example.test",
  name: "王小明",
  role: "accountant",
  expiresAt: new Date("2026-10-24T00:00:00.000Z"),
  vendor: { name: "測試商家" },
};

async function render(params: { token?: string; error?: string } = { token: "synthetic-token" }) {
  return renderToStaticMarkup(await AcceptVendorInvitationPage({ searchParams: Promise.resolve(params) }));
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.findInvitation.mockResolvedValue(invitation);
  mocks.findUser.mockResolvedValue(null);
  mocks.getCurrentAuth.mockResolvedValue(null);
  // requireAuth returns the verified session; MFA redirects are covered in auth.test.ts.
  mocks.requireAuth.mockImplementation(async () => mocks.getCurrentAuth());
});

describe("/invitations/accept", () => {
  it("shows one expired message for a missing, used or forged token", async () => {
    mocks.findInvitation.mockResolvedValue(null);
    const html = await render();
    expect(html).toContain("邀請已失效");
    expect(html).not.toContain("測試商家");
  });

  it.each([
    [{ id: "admin", status: "active", platformRole: "platform_admin" }],
    [{ id: "suspended", status: "inactive", platformRole: "none" }],
  ])("shows the same expired message for an ineligible invitee %j", async (user) => {
    mocks.findUser.mockResolvedValue(user);
    mocks.getCurrentAuth.mockResolvedValue({ user: { id: user.id } });
    const html = await render();
    expect(html).toContain("邀請已失效");
    expect(html).not.toContain("接受邀請");
  });

  it("offers account creation with policy consent for an address without an account", async () => {
    const html = await render();
    expect(html).toContain("加入 測試商家");
    expect(html).toContain('name="password"');
    expect(html).toContain('name="acceptPolicies"');
    expect(html).toContain('name="token" value="synthetic-token"');
    expect(html).toContain('minLength="8"');
    expect(html).toContain('maxLength="128"');
    expect(html).toContain("至少 8 個字元，可以用一句好記的話。");
    expect(html).toContain('aria-describedby="invitation-password-hint"');
  });

  it("asks an existing invitee to sign in before accepting", async () => {
    mocks.findUser.mockResolvedValue({ id: "invitee", status: "active", platformRole: "none" });
    const html = await render();
    expect(html).toContain("請先以受邀的 Email 登入");
    expect(html).toContain('href="/login?next=%2Finvitations%2Faccept%3Ftoken%3Dsynthetic-token"');
    expect(html).not.toContain('name="password"');
    expect(html).not.toContain("接受邀請</button>");
  });

  it("lets only the signed-in invitee accept", async () => {
    mocks.findUser.mockResolvedValue({ id: "invitee", status: "active", platformRole: "none" });
    mocks.getCurrentAuth.mockResolvedValue({ user: { id: "invitee" } });
    expect(await render()).toContain("接受邀請");

    mocks.getCurrentAuth.mockResolvedValue({ user: { id: "someone-else" } });
    const html = await render();
    expect(html).toContain("目前登入的帳號不是受邀的 Email");
    expect(html).not.toContain("建立帳號並接受邀請");
  });

  it("does not require vendor context and routes an unverified MFA session through verification", async () => {
    mocks.getCurrentAuth.mockResolvedValue({ user: { id: "invitee" }, vendor: null });
    mocks.requireAuth.mockRejectedValueOnce(new Error("redirect:/mfa/verify"));
    await expect(render()).rejects.toThrow("redirect:/mfa/verify");
    expect(mocks.getCurrentAuth).toHaveBeenCalledWith({ allowUnverifiedMfa: true });
    expect(mocks.requireAuth).toHaveBeenCalledWith({ nextPath: "/invitations/accept?token=synthetic-token" });
  });

  it("tells a signed-in user without a token to open the e-mailed link", async () => {
    mocks.getCurrentAuth.mockResolvedValue({ user: { id: "invitee" }, vendor: null });
    expect(await render({})).toContain("請開啟邀請信中的連結");
  });

  it("renders fixed copy for result codes and ignores unknown ones", async () => {
    expect(await render({ token: "synthetic-token", error: "last_owner" })).toContain("沒有任何 owner");
    expect(await render({ token: "synthetic-token", error: "retry" })).toContain("請再按一次接受邀請");
    expect(await render({ token: "synthetic-token", error: "<script>" })).toContain("無法接受邀請");
    expect(await render({ token: "synthetic-token", error: "short" })).toContain("密碼至少需要 8 個字元。");
    expect(await render({ token: "synthetic-token", error: "long" })).toContain("密碼最多 128 個字元。");
    expect(await render({ token: "synthetic-token", error: "common" })).toContain("這個密碼太常見，請換一個。");
    expect(await render({ token: "synthetic-token", error: "personal" })).toContain("密碼不要包含你的 Email 帳號名稱。");
  });
});
