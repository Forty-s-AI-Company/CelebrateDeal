import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const formStatus = vi.hoisted(() => ({ pending: true }));

vi.mock("react-dom", async (importOriginal) => {
  const reactDom = await importOriginal<typeof import("react-dom")>();
  return { ...reactDom, useFormStatus: () => ({ pending: formStatus.pending }) };
});
vi.mock("@/components/csrf-field", () => ({
  CsrfField: () => <input type="hidden" name="_csrf" value="synthetic" />,
}));

import LoginPage from "./login/page";
import PasswordResetConfirmPage from "./password-reset/confirm/page";
import PasswordResetRequestPage from "./password-reset/request/page";

describe("auth entry pending feedback", () => {
  beforeEach(() => {
    formStatus.pending = true;
  });

  it("shows an accessible login loader while authentication is pending", async () => {
    const html = renderToStaticMarkup(await LoginPage({ searchParams: Promise.resolve({}) }));

    expect(html).toContain("登入中…");
    expect(html).toContain("正在驗證帳號並登入，請勿重複送出。");
    expect(html).toContain('data-loading-indicator="true"');
    expect(html).toContain('aria-busy="true"');
    expect(html).toContain('href="/affiliate-portal/login"');
  });

  it("shows action-specific request and confirmation loaders", async () => {
    const request = renderToStaticMarkup(await PasswordResetRequestPage({ searchParams: Promise.resolve({}) }));
    const confirmation = renderToStaticMarkup(await PasswordResetConfirmPage({
      searchParams: Promise.resolve({ token: "synthetic-reset-token" }),
    }));

    expect(request).toContain("申請中…");
    expect(request).toContain("正在申請密碼重設信，請勿重複送出。");
    expect(confirmation).toContain("更新中…");
    expect(confirmation).toContain("正在更新密碼並撤銷舊 session，請勿重複送出。");
    expect(confirmation).toContain('autoComplete="new-password"');
    expect(confirmation).toContain('minLength="12"');
  });

  it("exposes password reset failures as an alert", async () => {
    formStatus.pending = false;
    const html = renderToStaticMarkup(await PasswordResetConfirmPage({
      searchParams: Promise.resolve({ token: "synthetic-reset-token", error: "mismatch" }),
    }));

    expect(html).toContain('role="alert"');
    expect(html).toContain("兩次輸入的密碼不一致。");
  });
});
