import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { TeamPerformanceDashboard } from "./team-performance-dashboard";

describe("TeamPerformanceDashboard", () => {
  it("shows filters and makes missing, zero-denominator, and delayed data explicit", () => {
    const html = renderToStaticMarkup(<TeamPerformanceDashboard
      teams={[{ id: "team-1", name: "北區團隊" }]}
      selected={{ teamId: "team-1", startDate: "2026-07-01", endDate: "2026-07-17" }}
      report={{
        scope: "leader_template", range: { start: new Date("2026-06-30T16:00:00Z"), endExclusive: new Date("2026-07-17T16:00:00Z"), timezone: "Asia/Taipei" }, generatedAt: new Date(), delayedData: true, truncated: false,
        templates: [{ id: "template-1", name: "夏季模板" }], partners: [{ id: "member-b", name: "B 夥伴" }],
        rows: [
          { pageId: "page-1", pageSlug: "b-page", templateId: "template-1", templateName: "夏季模板", templateVersion: 2, partnerMembershipId: "member-b", partnerName: "B 夥伴", views: null, clicks: 0, submissions: 0, conversions: 0, netConversionAmountCents: 0, viewToClickRate: null, viewToSubmissionRate: null, analyticsState: "missing" },
          { pageId: "page-2", pageSlug: "zero-page", templateId: "template-1", templateName: "夏季模板", templateVersion: 1, partnerMembershipId: "member-b", partnerName: "B 夥伴", views: 0, clicks: 0, submissions: 0, conversions: 0, netConversionAmountCents: 0, viewToClickRate: null, viewToSubmissionRate: null, analyticsState: "available" },
        ],
      }}
    />);

    expect(html).toContain("開始日期");
    expect(html).toContain("模板");
    expect(html).toContain("夥伴");
    expect(html).toContain("未回傳");
    expect(html).toContain("—");
    expect(html).toContain("最近 15 分鐘");
    expect(html).toContain("成交");
    expect(html).toContain("淨成交額");
    expect(html).toContain("$0");
    expect(html).toContain("轉換率在瀏覽為 0 或未回傳時不計算");
  });

  it("renders observed counts and rates without replacing them with estimates", () => {
    const html = renderToStaticMarkup(<TeamPerformanceDashboard
      teams={[{ id: "team-1", name: "北區團隊" }]}
      selected={{ teamId: "team-1", startDate: "2026-07-01", endDate: "2026-07-17" }}
      report={{
        scope: "partner_self", range: { start: new Date("2026-06-30T16:00:00Z"), endExclusive: new Date("2026-07-17T16:00:00Z"), timezone: "Asia/Taipei" }, generatedAt: new Date(), delayedData: false, truncated: false,
        templates: [], partners: [],
        rows: [{ pageId: "page-1", pageSlug: "mine", templateId: "template-1", templateName: "夏季模板", templateVersion: 2, partnerMembershipId: "member-b", partnerName: "B 夥伴", views: 20, clicks: 4, submissions: 2, conversions: 1, netConversionAmountCents: 168_000, viewToClickRate: 20, viewToSubmissionRate: 10, analyticsState: "available" }],
      }}
    />);

    expect(html).toContain(">20<");
    expect(html).toContain("20%");
    expect(html).toContain("10%");
    expect(html).toContain("$1,680");
    expect(html).toContain("僅我的頁面");
  });
});
