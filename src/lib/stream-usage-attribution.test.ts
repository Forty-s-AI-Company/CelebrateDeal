import { describe, expect, it } from "vitest";
import { parseLiveQuotaPolicyForm } from "@/lib/live-quota-policy";
import { buildStreamUsageAllocations } from "@/lib/stream-usage-attribution";

const base = {
  teamId: "team-1",
  liveOwnerMembershipId: "owner-1",
  promoterMembershipId: "promoter-1",
  contentOwnerMembershipId: "owner-1",
  watchSeconds: 45,
};

function policy(input: Parameters<typeof parseLiveQuotaPolicyForm>[0] = {}) {
  return parseLiveQuotaPolicyForm(input);
}

describe("stream usage attribution allocation", () => {
  it("defaults direct playback to the owner and team funnel playback to the promoter", () => {
    expect(buildStreamUsageAllocations({ ...base, source: "DIRECT_PLAYBACK", policy: policy() })).toEqual([
      expect.objectContaining({ recipientKey: "MEMBERSHIP:team-1:owner-1", allocationBps: 10_000, allocatedWatchSeconds: 45 }),
    ]);
    expect(buildStreamUsageAllocations({ ...base, source: "TEAM_FUNNEL_PAGE", policy: policy() })).toEqual([
      expect.objectContaining({ recipientKey: "MEMBERSHIP:team-1:promoter-1", allocationBps: 10_000, allocatedWatchSeconds: 45 }),
    ]);
  });

  it("keeps owner mode independent from source page attribution", () => {
    const allocations = buildStreamUsageAllocations({
      ...base,
      source: "TEAM_FUNNEL_PAGE",
      policy: policy({ usageAttributionMode: "OWNER" }),
    });
    expect(allocations).toEqual([
      expect.objectContaining({ recipientKey: "MEMBERSHIP:team-1:owner-1", allocatedWatchSeconds: 45 }),
    ]);
  });

  it("splits team funnel usage exactly and preserves integer seconds", () => {
    const allocations = buildStreamUsageAllocations({
      ...base,
      source: "TEAM_FUNNEL_PAGE",
      policy: policy({ usageAttributionMode: "SPLIT", splitOwnerBps: 3000, splitPromoterBps: 7000 }),
    });
    expect(allocations.map((allocation) => allocation.allocatedWatchSeconds)).toEqual([14, 31]);
    expect(allocations.reduce((sum, allocation) => sum + allocation.allocatedWatchSeconds, 0)).toBe(45);
    expect(allocations.reduce((sum, allocation) => sum + allocation.allocationBps, 0)).toBe(10_000);
  });

  it("fails closed to unattributed when promoter attribution is disabled or missing", () => {
    const disabled = buildStreamUsageAllocations({
      ...base,
      source: "TEAM_FUNNEL_PAGE",
      policy: policy({ affiliateMode: "disabled" }),
    });
    expect(disabled).toEqual([
      expect.objectContaining({ recipientKey: "UNATTRIBUTED", allocationBps: 10_000, allocatedWatchSeconds: 45 }),
    ]);
    const missing = buildStreamUsageAllocations({
      ...base,
      promoterMembershipId: null,
      source: "TEAM_FUNNEL_PAGE",
      policy: policy(),
    });
    expect(missing[0]?.recipientKey).toBe("UNATTRIBUTED");
  });

  it("uses only the declared custom recipients", () => {
    const allocations = buildStreamUsageAllocations({
      ...base,
      source: "TEAM_FUNNEL_PAGE",
      policy: policy({
        usageAttributionMode: "CUSTOM",
        customAllocations: [
          { teamId: "team-1", membershipId: "member-1", bps: 2500 },
          { teamId: "team-1", membershipId: "member-2", bps: 7500 },
        ],
      }),
    });
    expect(allocations.map((allocation) => allocation.recipientKey)).toEqual([
      "MEMBERSHIP:team-1:member-1",
      "MEMBERSHIP:team-1:member-2",
    ]);
    expect(allocations.reduce((sum, allocation) => sum + allocation.allocatedWatchSeconds, 0)).toBe(45);
  });

  it("combines duplicate persisted recipients before allocating watch time", () => {
    const parsed = policy({
      usageAttributionMode: "CUSTOM",
      customAllocations: [{ teamId: "team-1", membershipId: "member-1", bps: 10_000 }],
    });
    const allocations = buildStreamUsageAllocations({
      ...base,
      source: "TEAM_FUNNEL_LIVE_SHARE",
      policy: {
        ...parsed,
        customAllocations: [
          { teamId: "team-1", membershipId: "member-1", bps: 2_500 },
          { teamId: "team-1", membershipId: "member-1", bps: 7_500 },
        ],
      },
    });

    expect(allocations).toEqual([
      expect.objectContaining({
        recipientKey: "MEMBERSHIP:team-1:member-1",
        allocationBps: 10_000,
        allocatedWatchSeconds: 45,
      }),
    ]);
  });

  it("fails closed when persisted custom allocations do not sum to the full ledger", () => {
    const parsed = policy({
      usageAttributionMode: "CUSTOM",
      customAllocations: [{ teamId: "team-1", membershipId: "member-1", bps: 10_000 }],
    });

    expect(() => buildStreamUsageAllocations({
      ...base,
      source: "TEAM_FUNNEL_PAGE",
      policy: {
        ...parsed,
        customAllocations: [{ teamId: "team-1", membershipId: "member-1", bps: 9_000 }],
      },
    })).toThrowError("invalid_stream_usage_allocation");
  });
});
