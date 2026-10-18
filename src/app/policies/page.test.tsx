import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import PoliciesPage, { revalidate } from "./page";
import { policyCenterPublication } from "@/lib/public-policy-content";

describe("/policies route", () => {
  afterEach(() => vi.useRealTimers());

  it("offers the active policy version and help links without internal review data", () => {
    vi.useFakeTimers({ now: new Date("2026-10-18T00:00:00+08:00") });
    const html = renderToStaticMarkup(<PoliciesPage />);

    expect(revalidate).toBe(3600);
    expect(html).toContain("政策與協助中心");
    expect(html).not.toContain("查看目前生效的政策");
    expect(html).toContain(`預定政策版本 ${policyCenterPublication.version}`);
    expect(html).toContain(`預定生效日為 ${policyCenterPublication.effectiveDateLabel}`);
    expect(html).toContain("避免倒填生效");
    for (const href of ["/policies/terms", "/policies/privacy", "/policies/refunds", "/support", "/merchant-onboarding"]) {
      expect(html).toContain(`href="${href}"`);
    }
    expect(html).toContain("退款進度");
    for (const internal of ["DRAFT", "HUMAN OWNER", "P0", "P1", "P2", "acceptance receipt", "rollback"]) {
      expect(html).not.toContain(internal);
    }
  });

  it("switches to the effective wording from the Taipei effective date onward", () => {
    vi.useFakeTimers({ now: new Date("2026-10-31T23:59:59+08:00") });
    expect(renderToStaticMarkup(<PoliciesPage />)).toContain("預定生效日為");

    vi.setSystemTime(new Date("2026-11-01T00:00:00+08:00"));
    const html = renderToStaticMarkup(<PoliciesPage />);
    expect(html).toContain(`本版本已於 ${policyCenterPublication.effectiveDateLabel}生效`);
    expect(html).not.toContain("預定生效日為");
    expect(html).not.toContain("預定政策版本");
  });
});
