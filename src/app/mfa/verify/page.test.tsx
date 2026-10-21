import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ requireAuth: vi.fn() }));
vi.mock("@/lib/auth", () => ({ requireAuth: mocks.requireAuth }));
vi.mock("@/app/actions", () => ({ verifyMfaAction: vi.fn() }));
vi.mock("@/components/csrf-field", () => ({ CsrfField: () => null }));

import MfaVerifyPage from "./page";

async function hiddenNext(next: string | undefined) {
  const html = renderToStaticMarkup(await MfaVerifyPage({ searchParams: Promise.resolve({ next }) }));
  return /name="next" value="([^"]*)"/u.exec(html)?.[1];
}

describe("/mfa/verify return path", () => {
  beforeEach(() => {
    mocks.requireAuth.mockResolvedValue({ user: { id: "user-1" } });
  });

  it("keeps an in-app destination", async () => {
    expect(await hiddenNext("/billing/plans")).toBe("/billing/plans");
  });

  it.each(["/\t/evil.example", "//evil.example", "/\\evil.example", "javascript:alert(1)", "https://evil.example", undefined])(
    "replaces the unsafe next %j with the default page",
    async (next) => {
      expect(await hiddenNext(next)).toBe("/admin/billing/dashboard");
    },
  );

  it("explains a step-up request", async () => {
    const html = renderToStaticMarkup(await MfaVerifyPage({ searchParams: Promise.resolve({ reason: "step_up" }) }));
    expect(html).toContain("15 分鐘內完成雙重驗證");
  });
});
