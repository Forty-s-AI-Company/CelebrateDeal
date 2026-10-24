import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/components/csrf-field", () => ({ CsrfField: () => <input type="hidden" name="_csrf" value="synthetic" /> }));
vi.mock("@/app/actions/registration-actions", () => ({ registerAction: vi.fn() }));

import RegisterPage from "./page";
import LoginPage from "../login/page";
import { createMerchantRegistrationInvite } from "@/lib/merchant-registration-invite";
import { publicSupportContact } from "@/lib/public-policy-content";

const INVITE_ONLY = "封測期間僅限受邀商家註冊。請使用平台寄給你的邀請連結。";
const INVALID = "這個邀請連結無效或已過期，請聯絡平台重新取得。";

async function render(searchParams: Record<string, string | string[]>) {
  return renderToStaticMarkup(await RegisterPage({ searchParams: Promise.resolve(searchParams) }));
}

beforeEach(() => {
  vi.stubEnv("CSRF_SECRET", "synthetic-register-page-secret-at-least-32-bytes");
  vi.stubEnv("REGISTRATION_MODE", "");
});
afterEach(() => vi.unstubAllEnvs());

describe("/register in invite mode (default)", () => {
  it("shows the invite-only notice with contact links instead of the form", async () => {
    const html = await render({});
    expect(html).toContain("受邀商家註冊");
    expect(html).toContain(INVITE_ONLY);
    expect(html).toContain(`href="mailto:${publicSupportContact.email}"`);
    expect(html).toContain('href="/support"');
    expect(html).toContain('href="/login"');
    expect(html).not.toContain("<form");
    expect(html).not.toContain('name="password"');
    expect(html).not.toContain('role="alert"');
  });

  it.each([
    [{ invite: "garbage" }],
    [{ invite: "" }],
    [{ invite: ["a", "b"] }],
    [{ error: "invite_required" }],
  ])("explains an invalid or missing invitation %j without rendering the form", async (params) => {
    const html = await render(params);
    expect(html).toContain('role="alert"');
    expect(html).toContain(INVALID);
    expect(html).not.toContain("<form");
  });

  it("treats an expired invitation as invalid", async () => {
    const { token } = createMerchantRegistrationInvite({ email: "owner@example.test", now: new Date(Date.now() - 15 * 24 * 60 * 60 * 1_000) });
    const html = await render({ invite: token });
    expect(html).toContain(INVALID);
    expect(html).not.toContain("<form");
  });

  it("prefills the invited email read-only and carries the token in a hidden field", async () => {
    const { token } = createMerchantRegistrationInvite({ email: "Owner@Example.test" });
    const html = await render({ invite: token });
    expect(html).toContain("建立你的商家帳號");
    expect(html).toContain("你已受邀加入 CelebrateDeal 封測。");
    expect(html).toMatch(/<input type="email" required="" readOnly=""[^>]*name="email" value="owner@example.test"\/>/u);
    expect(html).toContain("這是受邀的 Email，無法修改。");
    expect(html).toContain(`<input type="hidden" name="invite" value="${token}"/>`);
    expect(html).toContain('name="acceptPolicies"');
    expect(html).not.toContain(INVITE_ONLY);
  });

  it("shows retryable errors on the invited form", async () => {
    const { token } = createMerchantRegistrationInvite({ email: "owner@example.test" });
    expect(await render({ invite: token, error: "invite_mismatch" })).toContain("Email 必須和邀請連結上的 Email 相同。");
    const exists = await render({ invite: token, error: "exists" });
    expect(exists).toContain("這個 Email 已註冊，請直接登入。");
    expect(exists).toContain('name="invite"');
  });
});

describe("/register in open mode", () => {
  beforeEach(() => vi.stubEnv("REGISTRATION_MODE", "open"));

  it("renders the original editable form and ignores any invite parameter", async () => {
    const { token } = createMerchantRegistrationInvite({ email: "owner@example.test" });
    for (const params of [{}, { invite: token }, { invite: "garbage" }] as Array<Record<string, string>>) {
      const html = await render(params);
      expect(html).toContain("建立你的商家帳號");
      expect(html).toMatch(/<input type="email" required="" maxLength="320" autoComplete="email"[^>]*name="email"\/>/u);
      expect(html).not.toContain("readOnly");
      expect(html).not.toContain('name="invite"');
      expect(html).not.toContain(INVITE_ONLY);
      expect(html).not.toContain("你已受邀加入");
    }
  });
});

describe("/login registration entry", () => {
  async function renderLogin() {
    return renderToStaticMarkup(await LoginPage({ searchParams: Promise.resolve({}) }));
  }

  it("is relabelled for invited merchants in invite mode", async () => {
    const html = await renderLogin();
    expect(html).toContain("封測期間僅限受邀商家。");
    expect(html).toMatch(/<a [^>]*href="\/register"[^>]*>受邀商家註冊<\/a>/u);
    expect(html).not.toContain("建立商家工作區");
  });

  it("keeps the original create-workspace link in open mode", async () => {
    vi.stubEnv("REGISTRATION_MODE", "open");
    const html = await renderLogin();
    expect(html).toMatch(/<a [^>]*href="\/register"[^>]*>建立商家工作區<\/a>/u);
    expect(html).not.toContain("受邀商家註冊");
  });
});
