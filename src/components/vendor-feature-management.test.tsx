import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/app/(app)/settings/features/actions", () => ({ updateVendorFeaturesAction: vi.fn() }));

import { VendorFeatureManagement } from "./vendor-feature-management";

describe("VendorFeatureManagement", () => {
  it("renders all presets and accessible module switches from saved state", () => {
    const html = renderToStaticMarkup(createElement(VendorFeatureManagement, {
      initialModules: ["funnel_builder", "live_webinar"],
      csrfToken: "synthetic-csrf",
    }));
    expect(html).toContain("🎯 純直播賣課模式");
    expect(html).toContain("💼 高客單諮詢模式");
    expect(html).toContain("🚀 全功能旗艦模式");
    expect((html.match(/role="switch"/g) ?? [])).toHaveLength(6);
    expect(html).toContain("一頁式銷講漏斗：已啟用");
    expect(html).toContain("團隊分銷與推廣夥伴：已停用");
    expect(html).toContain("諮詢預約工作台：已停用");
  });
});
