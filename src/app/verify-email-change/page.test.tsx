import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ auth: vi.fn(), describe: vi.fn() }));
vi.mock("@/lib/auth", () => ({ getCurrentAuth: mocks.auth }));
vi.mock("@/lib/account-email-change", () => ({ describeAccountEmailChangeLink: mocks.describe }));

import VerifyEmailChangePage from "./page";

async function render(searchParams: Record<string, string>) {
  return renderToStaticMarkup(await VerifyEmailChangePage({ searchParams: Promise.resolve(searchParams) }));
}

beforeEach(() => {
  vi.stubEnv("CSRF_SECRET", "synthetic-verify-email-change-page-32-bytes");
  mocks.auth.mockReset().mockResolvedValue(null);
  mocks.describe.mockReset().mockResolvedValue(null);
});
afterEach(() => vi.unstubAllEnvs());

describe("/verify-email-change", () => {
  it("names the account by its masked current address and warns before the confirm button, posting instead of changing on GET", async () => {
    mocks.describe.mockResolvedValue({ maskedCurrentEmail: "o***@example.test" });
    const html = await render({ token: "aec1.payload.signature" });
    expect(mocks.describe).toHaveBeenCalledWith("aec1.payload.signature");
    expect(html).toContain("確認新的登入 Email");
    expect(html).toContain("o***@example.test");
    expect(html).toContain("若不認得此帳號請勿確認");
    expect(html).toContain("舊信箱 7 天內仍可還原；若舊信箱已外洩，請啟用兩步驟驗證後作廢還原連結，或聯絡客服");
    expect(html).toContain('action="/api/auth/email-change/confirm"');
    expect(html).toContain('method="post"');
    expect(html).toContain('name="token" value="aec1.payload.signature"');
    expect(mocks.auth).not.toHaveBeenCalled();
  });

  it("explains a link the confirmation would refuse and offers login when signed out", async () => {
    const html = await render({ token: "aec1.payload.signature" });
    expect(html).toContain("連結無效或已過期");
    expect(html).not.toContain("/api/auth/email-change/confirm");
    expect(html).toContain('href="/login"');
  });

  it("reports a completed change and sends the visitor to log in again", async () => {
    mocks.auth.mockResolvedValue({ user: { id: "someone-else" } });
    const html = await render({ status: "changed" });
    expect(html).toContain("登入 Email 已變更");
    expect(html).toContain("所有裝置的登入狀態都已結束");
    expect(html).toContain("舊信箱 7 天內仍可還原；若舊信箱已外洩，請啟用兩步驟驗證後作廢還原連結，或聯絡客服");
    expect(html).toContain('href="/login"');
    expect(mocks.auth).not.toHaveBeenCalled();
    expect(mocks.describe).not.toHaveBeenCalled();
  });

  it("reports a taken address and a busy retry without changing the signed-in viewer's context", async () => {
    mocks.auth.mockResolvedValue({ user: { id: "user-1" } });
    expect(await render({ status: "email_taken" })).toContain("這個 Email 已被其他帳號使用");
    const retry = await render({ status: "retry" });
    expect(retry).toContain("系統忙碌");
    expect(retry).toContain("連結仍然有效");
    expect(retry).toContain('href="/settings/security"');
  });

  it("treats an unknown status as invalid", async () => {
    expect(await render({ status: "verified" })).toContain("連結無效或已過期");
  });
});
