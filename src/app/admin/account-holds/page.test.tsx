import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ requireFinanceAdmin: vi.fn(), list: vi.fn() }));
vi.mock("@/lib/auth", () => ({ requireFinanceAdmin: mocks.requireFinanceAdmin }));
vi.mock("@/lib/account-security-hold", () => ({ ACCOUNT_SECURITY_HOLDS_PATH: "/admin/account-holds", listAccountSecurityHolds: mocks.list }));
vi.mock("@/app/actions/account-security-hold-actions", () => ({ releaseAccountSecurityHoldAction: vi.fn() }));
vi.mock("@/components/csrf-field", () => ({ CsrfField: () => <input type="hidden" name="_csrf" value="synthetic" /> }));

import AdminAccountHoldsPage from "./page";

async function render(searchParams: Record<string, string> = {}) {
  return renderToStaticMarkup(await AdminAccountHoldsPage({ searchParams: Promise.resolve(searchParams) }));
}

beforeEach(() => {
  mocks.requireFinanceAdmin.mockReset().mockResolvedValue({ user: { id: "admin-1", mfaFactor: { id: "f" } }, session: { mfaVerifiedAt: new Date() } });
  mocks.list.mockReset().mockResolvedValue([]);
});

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
});
