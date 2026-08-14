import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import MerchantOnboardingPage from "./page";

describe("/merchant-onboarding route", () => {
  it("renders all eight stages and the sanitized handoff contract", () => {
    const html = renderToStaticMarkup(<MerchantOnboardingPage />);

    expect(html).toContain("商家 onboarding");
    expect(html).toContain("DRAFT — MERCHANT／SUPPORT／FINANCE／LEGAL／RELEASE ACCEPTANCE REQUIRED");
    for (const stage of ["商家／owner 身分與唯一責任", "方案與 PayUni 邊界", "DNS、條款、隱私、退款政策與正式 owner acceptance"]) {
      expect(html).toContain(stage);
    }
    expect(html).toContain("不得填入姓名、完整 email、密碼、Cookie、Token 或付款資料");
    expect(html).toContain('href="/support"');
  });
});
