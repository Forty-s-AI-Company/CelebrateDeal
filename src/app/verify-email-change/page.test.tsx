import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ auth: vi.fn() }));
vi.mock("@/lib/auth", () => ({ getCurrentAuth: mocks.auth }));

import VerifyEmailChangePage from "./page";
import { createAccountEmailChangeToken } from "@/lib/account-email-change-token";

async function render(searchParams: Record<string, string>) {
  return renderToStaticMarkup(await VerifyEmailChangePage({ searchParams: Promise.resolve(searchParams) }));
}

beforeEach(() => {
  vi.stubEnv("CSRF_SECRET", "synthetic-verify-email-change-page-32-bytes");
  mocks.auth.mockReset().mockResolvedValue(null);
});
afterEach(() => vi.unstubAllEnvs());

describe("/verify-email-change", () => {
  it("shows a confirm button for a valid link, posting the token instead of changing anything on GET", async () => {
    const { token } = createAccountEmailChangeToken({ userId: "user-1", newEmail: "new-owner@example.test" });
    const html = await render({ token });
    expect(html).toContain("確認新的登入 Email");
    expect(html).toContain('action="/api/auth/email-change/confirm"');
    expect(html).toContain('method="post"');
    expect(html).toContain(`name="token" value="${token}"`);
    // The page shows no address and does not even look at the session.
    expect(html).not.toContain("example.test");
    expect(mocks.auth).not.toHaveBeenCalled();
  });

  it("explains an invalid or expired link and offers login when signed out", async () => {
    const expired = createAccountEmailChangeToken({ userId: "user-1", newEmail: "new-owner@example.test", now: new Date(Date.now() - 2 * 60 * 60 * 1_000) }).token;
    for (const token of ["garbage", expired]) {
      const html = await render({ token });
      expect(html).toContain("連結無效或已過期");
      expect(html).not.toContain("/api/auth/email-change/confirm");
      expect(html).toContain('href="/login"');
    }
  });

  it("reports a completed change and sends the visitor to log in again", async () => {
    mocks.auth.mockResolvedValue({ user: { id: "someone-else" } });
    const html = await render({ status: "changed" });
    expect(html).toContain("登入 Email 已變更");
    expect(html).toContain("所有裝置的登入狀態都已結束");
    expect(html).toContain('href="/login"');
    expect(mocks.auth).not.toHaveBeenCalled();
  });

  it("reports a taken address without changing the signed-in viewer's context", async () => {
    mocks.auth.mockResolvedValue({ user: { id: "user-1" } });
    const html = await render({ status: "email_taken" });
    expect(html).toContain("這個 Email 已被其他帳號使用");
    expect(html).toContain('href="/settings/security"');
  });

  it("treats an unknown status as invalid", async () => {
    const html = await render({ status: "verified" });
    expect(html).toContain("連結無效或已過期");
  });
});
