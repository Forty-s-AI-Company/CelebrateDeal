import { beforeEach, describe, expect, it, vi } from "vitest";

const actor = {
  id: "member-a", vendorId: "vendor-1", teamId: "team-1", vendorMemberId: "vendor-member-a", userId: "user-a",
  status: "ACTIVE" as const, leftAt: null, vendorMemberStatus: "active", vendorMemberDeactivatedAt: null,
};

const db = {
  teamMembership: { findMany: vi.fn() },
  teamMembershipRelationship: { findMany: vi.fn() },
  partnerFunnelPage: { findMany: vi.fn() },
  teamClickAttribution: { findMany: vi.fn() },
  teamLeadAttribution: { findMany: vi.fn() },
  teamConversionAttribution: { findMany: vi.fn() },
  refundRecord: { findMany: vi.fn() },
  analyticsEvent: { findMany: vi.fn() },
};

vi.mock("@/lib/db", () => ({ getDb: () => db }));
vi.mock("@/lib/team-funnel-access", async () => {
  const actual = await vi.importActual<typeof import("@/lib/team-funnel-access")>("@/lib/team-funnel-access");
  return { ...actual, requireTeamFunnelActor: vi.fn() };
});

import { getTeamFunnelPerformanceReport, resolvePerformanceRange } from "./team-funnel-performance";
import { requireTeamFunnelActor } from "@/lib/team-funnel-access";

function page(overrides: Record<string, unknown> = {}) {
  return {
    id: "page-a", slug: "a-page", liveId: "live-a", promoterMembershipId: "member-a",
    promoter: { vendorMember: { user: { name: "A 領隊" } } },
    templateVersion: { version: 2, templateId: "template-a", contentOwnerMembershipId: "member-a", template: { name: "夏季模板" } },
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(requireTeamFunnelActor).mockResolvedValue(actor);
  db.partnerFunnelPage.findMany.mockResolvedValue([page()]);
  db.teamClickAttribution.findMany.mockResolvedValue([]);
  db.teamLeadAttribution.findMany.mockResolvedValue([]);
  db.teamConversionAttribution.findMany.mockResolvedValue([]);
  db.refundRecord.findMany.mockResolvedValue([]);
  db.analyticsEvent.findMany.mockResolvedValue([]);
});

describe("team funnel performance", () => {
  it("shows a leader's owned template pages for a direct partner without widening the tenant", async () => {
    db.partnerFunnelPage.findMany.mockResolvedValue([page({ promoterMembershipId: "member-b", promoter: { vendorMember: { user: { name: "B 夥伴" } } } })]);

    const report = await getTeamFunnelPerformanceReport({ teamId: "team-1", timezone: "Asia/Taipei", startDate: "2026-07-01", endDate: "2026-07-01" });

    expect(report.rows[0]).toMatchObject({ pageId: "page-a", partnerMembershipId: "member-b", partnerName: "B 夥伴" });
    expect(db.partnerFunnelPage.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ vendorId: "vendor-1", teamId: "team-1", OR: [
        { promoterMembershipId: "member-a" }, { templateVersion: { contentOwnerMembershipId: "member-a" } },
      ] }),
    }));
  });

  it("limits a partner's report predicate to their own promoted pages, never a peer", async () => {
    vi.mocked(requireTeamFunnelActor).mockResolvedValue({ ...actor, id: "member-b", vendorMemberId: "vendor-member-b", userId: "user-b" });
    db.partnerFunnelPage.findMany.mockResolvedValue([page({ promoterMembershipId: "member-b" })]);

    const report = await getTeamFunnelPerformanceReport({ teamId: "team-1", timezone: "Asia/Taipei" });

    expect(report.rows.map((row) => row.partnerMembershipId)).toEqual(["member-b"]);
    expect(db.partnerFunnelPage.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ OR: [
        { promoterMembershipId: "member-b" }, { templateVersion: { contentOwnerMembershipId: "member-b" } },
      ] }),
    }));
  });

  it("does not scan the team graph when authorizing the actor's own report scope", async () => {
    await getTeamFunnelPerformanceReport({ teamId: "team-1", timezone: "Asia/Taipei" });

    expect(db.teamMembership.findMany).not.toHaveBeenCalled();
    expect(db.teamMembershipRelationship.findMany).not.toHaveBeenCalled();
  });

  it("applies the current tenant constraint to every page and event source query", async () => {
    await getTeamFunnelPerformanceReport({ teamId: "team-1", timezone: "Asia/Taipei", startDate: "2026-07-01", endDate: "2026-07-01" });

    expect(db.partnerFunnelPage.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ vendorId: "vendor-1", teamId: "team-1" }) }));
    expect(db.teamClickAttribution.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ vendorId: "vendor-1", teamId: "team-1" }) }));
    expect(db.teamLeadAttribution.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ vendorId: "vendor-1", teamId: "team-1" }) }));
    expect(db.teamConversionAttribution.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ vendorId: "vendor-1", teamId: "team-1" }) }));
    expect(db.refundRecord.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ vendorId: "vendor-1" }) }));
    expect(db.analyticsEvent.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: expect.objectContaining({ vendorId: "vendor-1" }) }));
  });

  it("does not invent views, keeps zero clicks and submissions, and leaves zero-denominator conversion unavailable", async () => {
    db.analyticsEvent.findMany.mockResolvedValue([{ payload: { pageId: "foreign-page" } }]);

    const report = await getTeamFunnelPerformanceReport({ teamId: "team-1", timezone: "Asia/Taipei", startDate: "2026-07-01", endDate: "2026-07-01" });

    expect(report.rows[0]).toMatchObject({ views: null, clicks: 0, submissions: 0, conversions: 0, netConversionAmountCents: 0, refundCount: 0, refundAmountCents: 0, viewToClickRate: null, viewToSubmissionRate: null, analyticsState: "missing" });
  });

  it("aggregates only page-scoped analytics plus attributable clicks and submissions", async () => {
    db.teamClickAttribution.findMany.mockResolvedValue([{ pageId: "page-a" }, { pageId: "page-a" }]);
    db.teamLeadAttribution.findMany.mockResolvedValue([{ pageId: "page-a" }]);
    db.analyticsEvent.findMany.mockResolvedValue([{ payload: { pageId: "page-a" } }, { payload: { pageId: "page-a" } }, { payload: { pageId: "other" } }]);

    const report = await getTeamFunnelPerformanceReport({ teamId: "team-1", timezone: "Asia/Taipei", startDate: "2026-07-01", endDate: "2026-07-01" });

    expect(report.rows[0]).toMatchObject({ views: 2, clicks: 2, submissions: 1, viewToClickRate: 100, viewToSubmissionRate: 50 });
  });

  it("aggregates only visible, in-range conversions for the current vendor and team, floored after refunds", async () => {
    db.teamConversionAttribution.findMany.mockResolvedValue([
      { pageId: "page-a", paymentTransaction: { grossAmountCents: 16_800, refundedAmountCents: 4_800 } },
      { pageId: "page-a", paymentTransaction: { grossAmountCents: 5_000, refundedAmountCents: 9_000 } },
    ]);

    const report = await getTeamFunnelPerformanceReport({ teamId: "team-1", timezone: "Asia/Taipei", startDate: "2026-07-01", endDate: "2026-07-01" });

    expect(report.rows[0]).toMatchObject({ conversions: 2, netConversionAmountCents: 12_000 });
    expect(db.teamConversionAttribution.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: {
        vendorId: "vendor-1", teamId: "team-1", pageId: { in: ["page-a"] },
        paymentTransaction: { occurredAt: { gte: new Date("2026-06-30T16:00:00.000Z"), lt: new Date("2026-07-01T16:00:00.000Z") } },
      },
      select: { pageId: true, paymentTransaction: { select: { grossAmountCents: true, refundedAmountCents: true } } },
    }));
  });

  it("includes cross-period refunds by processed date for only current vendor, team, and visible attributed pages", async () => {
    db.refundRecord.findMany.mockResolvedValue([
      { refundAmountCents: 4_800, paymentTransaction: { teamAttribution: { pageId: "page-a" } } },
      { refundAmountCents: 1_200, paymentTransaction: { teamAttribution: { pageId: "page-a" } } },
      { refundAmountCents: 9_999, paymentTransaction: { teamAttribution: { pageId: "foreign-page" } } },
    ]);

    const report = await getTeamFunnelPerformanceReport({ teamId: "team-1", timezone: "Asia/Taipei", startDate: "2026-07-01", endDate: "2026-07-01" });

    expect(report.rows[0]).toMatchObject({ refundCount: 2, refundAmountCents: 6_000 });
    expect(db.refundRecord.findMany).toHaveBeenCalledWith({
      where: {
        vendorId: "vendor-1",
        processedAt: { gte: new Date("2026-06-30T16:00:00.000Z"), lt: new Date("2026-07-01T16:00:00.000Z") },
        paymentTransaction: {
          teamAttribution: {
            vendorId: "vendor-1",
            teamId: "team-1",
            pageId: { in: ["page-a"] },
          },
        },
      },
      select: {
        refundAmountCents: true,
        paymentTransaction: { select: { teamAttribution: { select: { pageId: true } } } },
      },
      take: 5_001,
    });
  });

  it("uses half-open timezone-aware date boundaries for Asia/Taipei", () => {
    const range = resolvePerformanceRange("2026-07-17", "2026-07-17", "Asia/Taipei", new Date("2026-07-17T12:00:00Z"));

    expect(range.start.toISOString()).toBe("2026-07-16T16:00:00.000Z");
    expect(range.endExclusive.toISOString()).toBe("2026-07-17T16:00:00.000Z");
  });
});
