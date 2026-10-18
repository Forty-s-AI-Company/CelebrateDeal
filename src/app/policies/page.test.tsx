import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import PoliciesPage from "./page";
import { policyCenterPublication } from "@/lib/public-policy-content";

describe("/policies route", () => {
  it("offers the active policy version and help links without internal review data", () => {
    const html = renderToStaticMarkup(<PoliciesPage />);

    expect(html).toContain("政策與協助中心");
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
});
