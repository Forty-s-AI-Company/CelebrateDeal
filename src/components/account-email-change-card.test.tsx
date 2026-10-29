import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/components/csrf-field", () => ({ CsrfField: () => <input type="hidden" name="_csrf" value="synthetic" /> }));
vi.mock("@/app/actions/account-email-change-actions", () => ({ requestAccountEmailChangeAction: vi.fn() }));

import { AccountEmailChangeCard } from "./account-email-change-card";

describe("AccountEmailChangeCard", () => {
  it("asks for the new address and the current password, and names no user", () => {
    const html = renderToStaticMarkup(<AccountEmailChangeCard currentEmail="demo@celebratedeal.local" mfaStatus="setup_required" />);
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
  });

  it("shows the step-up notice only to an account with a factor whose verification is stale", () => {
    expect(renderToStaticMarkup(<AccountEmailChangeCard currentEmail="a@example.test" mfaStatus="verification_required" />)).toContain("/mfa/verify?reason=step_up");
    // No factor: not pushed into enrolment. Fresh verification: nothing to do.
    for (const status of ["setup_required", "verified"] as const) {
      const html = renderToStaticMarkup(<AccountEmailChangeCard currentEmail="a@example.test" mfaStatus={status} />);
      expect(html).not.toContain("需要驗證");
      expect(html).not.toContain("/mfa/");
    }
  });
});
