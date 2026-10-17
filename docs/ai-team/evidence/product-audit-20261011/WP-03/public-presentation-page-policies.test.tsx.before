import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import PoliciesPage from "./page";

describe("/policies route", () => {
  it("renders the public policy center and its human acceptance boundary", () => {
    const html = renderToStaticMarkup(<PoliciesPage />);

    expect(html).toContain("政策與協助中心");
    expect(html).toContain("DRAFT — HUMAN OWNER ACCEPTANCE REQUIRED");
    expect(html).toContain('href="/policies/terms"');
    expect(html).toContain('href="/policies/privacy"');
    expect(html).toContain('href="/policies/refunds"');
    expect(html).toContain('href="/support"');
    expect(html).toContain('href="/merchant-onboarding"');
    expect(html).toContain("AI 不代替法律、財務、客服或 release 簽核");
  });
});
