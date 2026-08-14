import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import SupportPage from "./page";

describe("/support route", () => {
  it("renders the SLA matrix, safe intake rules and escalation links", () => {
    const html = renderToStaticMarkup(<SupportPage />);

    expect(html).toContain("客服與事件升級");
    expect(html).toContain("DRAFT — SUPPORT／FINANCE OWNER ACCEPTANCE REQUIRED");
    expect(html).toContain("目標 15 分鐘內首次回應");
    expect(html).toContain("不要求完整卡號、CVV、密碼、Token、Cookie");
    expect(html).toContain('href="/support/orders"');
    expect(html).toContain('href="/policies/refunds"');
    expect(html).toContain('href="/merchant-onboarding"');
  });
});
