import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ auth: vi.fn() }));
vi.mock("@/components/csrf-field", () => ({ CsrfField: () => <input type="hidden" name="_csrf" value="synthetic" /> }));
vi.mock("@/app/actions/email-verification-actions", () => ({ resendMerchantEmailVerificationAction: vi.fn() }));
vi.mock("@/lib/auth", () => ({ getCurrentAuth: mocks.auth }));

import VerifyEmailPage from "./page";
import { createMerchantEmailVerificationToken } from "@/lib/merchant-email-verification-token";

async function render(searchParams: Record<string, string>) {
  return renderToStaticMarkup(await VerifyEmailPage({ searchParams: Promise.resolve(searchParams) }));
}

const unverified = { user: { id: "user-1", email: "owner@example.test", emailVerifiedAt: null }, isPlatformAdmin: false };

beforeEach(() => {
  vi.stubEnv("CSRF_SECRET", "synthetic-verify-email-page-secret-32-bytes");
  mocks.auth.mockReset().mockResolvedValue(null);
});
afterEach(() => vi.unstubAllEnvs());

describe("/verify-email", () => {
  it("shows a confirm button for a valid link, posting the token instead of verifying on GET", async () => {
    const { token } = createMerchantEmailVerificationToken({ userId: "user-1", email: "owner@example.test" });
    const html = await render({ token });
    expect(html).toContain("確認你的 Email");
    expect(html).toContain('action="/api/auth/email-verification/confirm"');
    expect(html).toContain('method="post"');
    expect(html).toContain(`name="token" value="${token}"`);
    // Before the POST the page shows no address at all, not even masked.
    expect(html).not.toContain("example.test");
    expect(html).not.toContain("***@");
  });

  it("explains an invalid or expired link and offers login when signed out", async () => {
    const expired = createMerchantEmailVerificationToken({ userId: "user-1", email: "owner@example.test", now: new Date(Date.now() - 48 * 60 * 60 * 1_000) }).token;
    for (const token of ["garbage", expired]) {
      const html = await render({ token });
      expect(html).toContain("驗證連結無效或已過期");
      expect(html).not.toContain("/api/auth/email-verification/confirm");
      expect(html).toContain('href="/login"');
    }
  });

  it("asks a signed-in unverified user to verify, with a resend form", async () => {
    mocks.auth.mockResolvedValue(unverified);
    const html = await render({});
    expect(html).toContain("請先驗證 Email");
    expect(html).toContain("重新寄送驗證信");
    expect(html).toContain("o***@example.test");
    expect(html).toContain('name="_csrf"');
    expect(html).not.toContain("data-turnstile-widget");
  });

  it("adds the Turnstile widget to the resend form when configured", async () => {
    vi.stubEnv("NEXT_PUBLIC_TURNSTILE_SITE_KEY", "1x00000000000000000000AA");
    vi.stubEnv("TURNSTILE_SECRET_KEY", "1x0000000000000000000000000000000AA");
    mocks.auth.mockResolvedValue(unverified);
    expect(await render({})).toContain("data-turnstile-widget");
  });

  it.each([
    ["sent", "驗證信已寄出"],
  ])("reports status %s", async (status, text) => {
    mocks.auth.mockResolvedValue(unverified);
    expect(await render({ status })).toContain(text);
  });

  it.each([
    ["rate_limited", "驗證信寄送次數太多"],
    ["send_failed", "驗證信暫時無法寄出"],
    ["turnstile_failed", "請先完成「確認你是真人」的驗證"],
  ])("reports error %s", async (error, text) => {
    mocks.auth.mockResolvedValue(unverified);
    expect(await render({ error })).toContain(text);
  });

  it("confirms success and links back to the back office for a verified user", async () => {
    mocks.auth.mockResolvedValue({ ...unverified, user: { ...unverified.user, emailVerifiedAt: new Date() } });
    const html = await render({ status: "verified" });
    expect(html).toContain("Email 已完成驗證");
    expect(html).toContain('href="/dashboard"');
    expect(html).not.toContain("重新寄送驗證信");
  });
});
