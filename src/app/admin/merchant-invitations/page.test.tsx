import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ requireFinanceAdmin: vi.fn(), auditFindMany: vi.fn(), userFindMany: vi.fn(), actionState: null as unknown }));

vi.mock("@/lib/auth", () => ({ requireFinanceAdmin: mocks.requireFinanceAdmin }));
vi.mock("@/lib/db", () => ({ getDb: () => ({ auditLog: { findMany: mocks.auditFindMany }, user: { findMany: mocks.userFindMany } }) }));
vi.mock("@/app/actions/merchant-invitation-actions", () => ({ createMerchantInvitationAction: vi.fn() }));
vi.mock("@/components/csrf-field", () => ({ CsrfField: () => <input type="hidden" name="_csrf" value="synthetic" /> }));
vi.mock("react", async (importOriginal) => {
  const react = await importOriginal<typeof import("react")>();
  return {
    ...react,
    useActionState: (action: unknown, initial: unknown) => [mocks.actionState ?? initial, action, false],
  };
});

import AdminMerchantInvitationsPage from "./page";

async function render() {
  return renderToStaticMarkup(await AdminMerchantInvitationsPage());
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.actionState = null;
  vi.stubEnv("REGISTRATION_MODE", "");
  mocks.requireFinanceAdmin.mockResolvedValue({ user: { id: "admin-1" }, isPlatformAdmin: true });
  mocks.auditFindMany.mockResolvedValue([]);
  mocks.userFindMany.mockResolvedValue([]);
});
afterEach(() => vi.unstubAllEnvs());

describe("/admin/merchant-invitations", () => {
  it("runs the platform-admin guard before reading anything", async () => {
    mocks.requireFinanceAdmin.mockRejectedValue(new Error("redirect:/dashboard"));
    await expect(render()).rejects.toThrow("redirect:/dashboard");
    expect(mocks.auditFindMany).not.toHaveBeenCalled();
    expect(mocks.userFindMany).not.toHaveBeenCalled();
  });

  it("renders the invite form, the current mode and an empty history", async () => {
    const html = await render();
    expect(html).toContain("商家邀請");
    expect(html).toContain("14 天內有效");
    expect(html).toContain("系統不會自動寄信");
    expect(html).toContain('data-registration-mode="invite"');
    expect(html).toContain("目前註冊模式：僅限受邀");
    expect(html).toContain('name="email"');
    expect(html).toContain('name="note"');
    expect(html).toContain('name="_csrf"');
    expect(html).toContain("產生邀請連結");
    expect(html).toContain("還沒有產生過邀請");
    expect(html).not.toContain("data-invitation-result");
    expect(mocks.auditFindMany).toHaveBeenCalledWith({
      where: { action: "merchant_registration_invite_created", vendorId: null },
      orderBy: { createdAt: "desc" },
      take: 30,
      select: { id: true, createdAt: true, after: true },
    });
    expect(mocks.userFindMany).not.toHaveBeenCalled();
  });

  it("states when registration is open", async () => {
    vi.stubEnv("REGISTRATION_MODE", "open");
    const html = await render();
    expect(html).toContain('data-registration-mode="open"');
    expect(html).toContain("目前註冊模式：開放註冊");
  });

  it("lists recent invitations with their registration status from audit entries", async () => {
    mocks.auditFindMany.mockResolvedValue([
      { id: "a1", createdAt: new Date("2026-10-24T02:00:00.000Z"), after: { email: "done@example.test", expiresAt: "2026-11-07T02:00:00.000Z", note: "第一批" } },
      { id: "a2", createdAt: new Date("2026-10-01T02:00:00.000Z"), after: { email: "late@example.test", expiresAt: "2026-10-15T02:00:00.000Z" } },
      { id: "a3", createdAt: new Date("2026-10-24T03:00:00.000Z"), after: { email: "pending@example.test", expiresAt: "2099-01-01T00:00:00.000Z" } },
      { id: "a4", createdAt: new Date("2026-10-24T04:00:00.000Z"), after: ["unexpected"] },
    ]);
    mocks.userFindMany.mockResolvedValue([{ email: "done@example.test" }]);
    const html = await render();
    expect(mocks.userFindMany).toHaveBeenCalledWith({ where: { email: { in: ["done@example.test", "late@example.test", "pending@example.test"] } }, select: { email: true } });
    const row = (email: string) => html.slice(html.indexOf(email), html.indexOf("</tr>", html.indexOf(email)));
    expect(row("done@example.test")).toContain("已註冊");
    expect(row("done@example.test")).toContain("第一批");
    expect(row("done@example.test")).toContain("2026/10/24 10:00");
    expect(row("late@example.test")).toContain("已過期");
    expect(row("pending@example.test")).toContain("尚未註冊");
    expect(html).toContain("—");
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
