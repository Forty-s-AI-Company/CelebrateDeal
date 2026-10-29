import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/components/csrf-field", () => ({ CsrfField: () => <input type="hidden" name="_csrf" value="synthetic" /> }));
vi.mock("@/app/actions/account-email-change-actions", () => ({ requestAccountEmailChangeAction: vi.fn(), voidAccountEmailRevertLinksAction: vi.fn() }));

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

  it("explains the old mailbox's revert window to every account", () => {
    for (const status of ["setup_required", "verification_required", "verified"] as const) {
      const html = renderToStaticMarkup(<AccountEmailChangeCard currentEmail="a@example.test" mfaStatus={status} platformRole="none" />);
      expect(html).toContain("舊信箱 7 天內仍可還原；若舊信箱已外洩，請啟用兩步驟驗證後作廢還原連結，或聯絡客服");
    }
  });

  it("offers the void button only to an account with a factor, and points the others to MFA or support", () => {
    for (const status of ["verification_required", "verified"] as const) {
      const html = renderToStaticMarkup(<AccountEmailChangeCard currentEmail="a@example.test" mfaStatus={status} platformRole="none" />);
      expect(html).toContain("確認是我本人，作廢舊信箱的還原連結");
      expect(html.match(/name="_csrf"/gu)).toHaveLength(2);
    }
    const html = renderToStaticMarkup(<AccountEmailChangeCard currentEmail="a@example.test" mfaStatus="setup_required" platformRole="none" />);
    expect(html).not.toContain("確認是我本人，作廢舊信箱的還原連結");
    expect(html).toContain("請聯絡客服");
    expect(html.match(/name="_csrf"/gu)).toHaveLength(1);
  });
});
