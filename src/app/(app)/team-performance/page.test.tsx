import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireVendor: vi.fn(),
  requireAuth: vi.fn(),
  membershipFindMany: vi.fn(),
  getTeamFunnelPerformanceReport: vi.fn(),
  resolvePerformanceRange: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({ requireVendor: mocks.requireVendor, requireAuth: mocks.requireAuth }));
vi.mock("@/lib/db", () => ({ getDb: () => ({ teamMembership: { findMany: mocks.membershipFindMany } }) }));
vi.mock("@/lib/team-funnel-performance", () => ({
  getTeamFunnelPerformanceReport: mocks.getTeamFunnelPerformanceReport,
  resolvePerformanceRange: mocks.resolvePerformanceRange,
}));
vi.mock("@/components/team-performance-dashboard", () => ({
  TeamPerformanceDashboard: ({ report, teams, selected }: { report: unknown; teams: unknown; selected: unknown }) => (
    <div data-testid="team-performance-dashboard">{JSON.stringify({ report, teams, selected })}</div>
  ),
}));

import TeamPerformancePage from "./page";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireVendor.mockResolvedValue({ id: "vendor-1", timezone: "Asia/Taipei" });
  mocks.requireAuth.mockResolvedValue({ member: { id: "member-1" } });
  mocks.membershipFindMany.mockResolvedValue([{ teamId: "team-1", team: { name: "第一團隊" } }]);
  mocks.resolvePerformanceRange.mockReturnValue({
    start: new Date("2026-08-01T00:00:00.000Z"),
    endExclusive: new Date("2026-08-08T00:00:00.000Z"),
  });
  mocks.getTeamFunnelPerformanceReport.mockResolvedValue({ totals: { visits: 4, leads: 2 } });
});

describe("/team-performance route", () => {
  it("renders an explicit empty state when the member has no active teams", async () => {
    mocks.membershipFindMany.mockResolvedValue([]);

    const html = renderToStaticMarkup(await TeamPerformancePage({ searchParams: Promise.resolve({}) }));

    expect(html).toContain("沒有可查看的團隊成效");
    expect(html).toContain("沒有有效團隊成員身分");
    expect(mocks.getTeamFunnelPerformanceReport).not.toHaveBeenCalled();
  });

  it("selects a valid queried team and forwards the constrained report options", async () => {
    const html = renderToStaticMarkup(await TeamPerformancePage({
      searchParams: Promise.resolve({
        teamId: "team-1",
        startDate: "2026-08-01",
        endDate: "2026-08-07",
        templateId: "template-1",
        partnerMembershipId: "membership-1",
      }),
    }));

    expect(html).toContain("team-performance-dashboard");
    expect(mocks.membershipFindMany).toHaveBeenCalledWith({
      where: { vendorId: "vendor-1", vendorMemberId: "member-1", status: "ACTIVE", leftAt: null },
      select: { teamId: true, team: { select: { name: true } } },
      orderBy: { joinedAt: "asc" },
      take: 50,
    });
    expect(mocks.resolvePerformanceRange).toHaveBeenCalledWith("2026-08-01", "2026-08-07", "Asia/Taipei");
    expect(mocks.getTeamFunnelPerformanceReport).toHaveBeenCalledWith({
      teamId: "team-1",
      startDate: "2026-08-01",
      endDate: "2026-08-07",
      templateId: "template-1",
      partnerMembershipId: "membership-1",
      timezone: "Asia/Taipei",
    });
  });
});
