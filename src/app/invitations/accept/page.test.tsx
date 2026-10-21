import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ findInvitation: vi.fn(), findUser: vi.fn(), getCurrentAuth: vi.fn() }));

vi.mock("@/lib/vendor-member-invitation", () => ({ findPendingVendorMemberInvitation: mocks.findInvitation }));
vi.mock("@/lib/db", () => ({ getDb: () => ({ user: { findUnique: mocks.findUser } }) }));
vi.mock("@/lib/auth", () => ({ getCurrentAuth: mocks.getCurrentAuth }));
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
  });

  it("asks an existing invitee to sign in before accepting", async () => {
    mocks.findUser.mockResolvedValue({ id: "invitee", status: "active", platformRole: "none" });
    const html = await render();
    expect(html).toContain("請先以受邀的 Email 登入");
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

  it("renders fixed copy for result codes and ignores unknown ones", async () => {
    expect(await render({ token: "synthetic-token", error: "last_owner" })).toContain("沒有任何 owner");
    expect(await render({ token: "synthetic-token", error: "<script>" })).toContain("無法接受邀請");
  });
});
