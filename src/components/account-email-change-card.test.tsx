import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/components/csrf-field", () => ({ CsrfField: () => <input type="hidden" name="_csrf" value="synthetic" /> }));
vi.mock("@/app/actions/account-email-change-actions", () => ({ requestAccountEmailChangeAction: vi.fn() }));

import { AccountEmailChangeCard } from "./account-email-change-card";

describe("AccountEmailChangeCard", () => {
  it("asks for the new address and the current password, names no user, and mentions the revert link", () => {
    const html = renderToStaticMarkup(<AccountEmailChangeCard currentEmail="demo@celebratedeal.local" mfaStatus="setup_required" platformRole="none" />);
    expect(html).toContain("變更登入 Email");
    expect(html).toContain("demo@celebratedeal.local");
    expect(html).toContain('name="newEmail"');
    expect(html).toContain('type="email"');
    expect(html).toContain('maxLength="320"');
    expect(html).toContain('name="currentPassword"');
    expect(html).toContain('autoComplete="current-password"');
    expect(html).toContain('name="_csrf"');
    expect(html).not.toContain('name="userId"');
    expect(html).toContain("60 分鐘內有效");
    expect(html).toContain("不是我操作，還原 Email");
    expect(html).toContain("舊信箱 7 天內仍可還原；若舊信箱已外洩，請聯絡客服");
    // No self-service way to void the old mailbox's links (#518 review B1).
    expect(html).not.toContain("作廢");
  });

  it("shows the step-up notice only to an account with a factor whose verification is stale", () => {
    expect(renderToStaticMarkup(<AccountEmailChangeCard currentEmail="a@example.test" mfaStatus="verification_required" platformRole="none" />)).toContain("/mfa/verify?reason=step_up");
    // No factor: not pushed into enrolment. Fresh verification: nothing to do.
    for (const status of ["setup_required", "verified"] as const) {
      const html = renderToStaticMarkup(<AccountEmailChangeCard currentEmail="a@example.test" mfaStatus={status} platformRole="none" />);
      expect(html).not.toContain("需要驗證");
      expect(html).not.toContain("/mfa/");
    }
  });

  it("sends a platform role without a factor to enrolment first, like the action", () => {
    const html = renderToStaticMarkup(<AccountEmailChangeCard currentEmail="a@example.test" mfaStatus="setup_required" platformRole="platform_admin" />);
    expect(html).toContain("/mfa/setup?reason=step_up");
    expect(renderToStaticMarkup(<AccountEmailChangeCard currentEmail="a@example.test" mfaStatus="verified" platformRole="platform_admin" />)).not.toContain("/mfa/");
  });
});
