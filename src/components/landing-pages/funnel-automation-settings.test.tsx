import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/app/actions/funnel-automation-actions", () => ({
  listFunnelAutomationRulesAction: vi.fn(),
  createFunnelAutomationRuleAction: vi.fn(),
  updateFunnelAutomationRuleAction: vi.fn(),
  setFunnelAutomationRuleEnabledAction: vi.fn(),
}));

import { FunnelAutomationSettings } from "./funnel-automation-settings";

describe("FunnelAutomationSettings", () => {
  it("renders a CSRF-bound page-local rule editor with visible loading and reload states", () => {
    const html = renderToStaticMarkup(<FunnelAutomationSettings pageId="page-1" csrfName="_csrf" csrfToken="synthetic-token" />);
    expect(html).toContain('name="_csrf"');
    expect(html).toContain('value="synthetic-token"');
    expect(html).toContain('value="page-1"');
    expect(html).toContain("報名後自動化");
    expect(html).toContain("已成功提交表單的訪客");
    expect(html).toContain("重新載入");
    expect(html).toContain("載入規則中");
    expect(html).toMatch(/<button type="submit" disabled=""[^>]*>建立標籤規則<\/button>/);
  });
});
