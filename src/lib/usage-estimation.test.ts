import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  streamAggregate: vi.fn(),
  eventCount: vi.fn(),
  affiliateCount: vi.fn(),
  videoAggregate: vi.fn(),
  usageUpsert: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  getDb: () => ({
    streamUsageLedgerEntry: { aggregate: mocks.streamAggregate },
    analyticsEvent: { count: mocks.eventCount },
    affiliate: { count: mocks.affiliateCount },
    video: { aggregate: mocks.videoAggregate },
    usageRecord: { upsert: mocks.usageUpsert },
  }),
}));

import { estimateVendorUsage, upsertUsageSnapshot, usageMonthRange } from "@/lib/usage-estimation";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.streamAggregate.mockResolvedValue({ _sum: { watchSeconds: 61 } });
  mocks.eventCount.mockResolvedValue(7);
  mocks.affiliateCount.mockResolvedValue(3);
  mocks.videoAggregate.mockResolvedValue({ _sum: { estimatedMinutes: 125 } });
  mocks.usageUpsert.mockResolvedValue({
    id: "usage-snapshot-record",
    createdAt: new Date("2026-08-08T00:00:00.000Z"),
  });
});

describe("usageMonthRange", () => {
  it("builds a strict UTC month range", () => {
    expect(usageMonthRange("2026-07")).toEqual({
      start: new Date("2026-07-01T00:00:00.000Z"),
      end: new Date("2026-08-01T00:00:00.000Z"),
    });
  });

  it("rejects an invalid month before reading the database", () => {
    expect(() => usageMonthRange("2026-13")).toThrowError("invalid_month");
    expect(mocks.streamAggregate).not.toHaveBeenCalled();
  });
});

describe("estimateVendorUsage", () => {
  it("uses server-owned ledger, analytics, affiliate and stored-minute sources", async () => {
    await expect(estimateVendorUsage("vendor-1", "2026-07")).resolves.toEqual({
      totalWatchMinutes: 2,
      totalEvents: 7,
      totalAffiliates: 3,
      totalStorageMinutes: 125,
    });

    expect(mocks.streamAggregate).toHaveBeenCalledWith({
      where: { vendorId: "vendor-1", monthKey: "2026-07" },
      _sum: { watchSeconds: true },
    });
    expect(mocks.eventCount).toHaveBeenCalledWith({
      where: {
        vendorId: "vendor-1",
        createdAt: {
          gte: new Date("2026-07-01T00:00:00.000Z"),
          lt: new Date("2026-08-01T00:00:00.000Z"),
        },
      },
    });
  });
});

describe("upsertUsageSnapshot", () => {
  it("writes one deterministic monthly record with source attribution metadata", async () => {
    const result = await upsertUsageSnapshot("vendor-1", "2026-07");

    expect(result.snapshot).toEqual({
      totalWatchMinutes: 2,
      totalEvents: 7,
      totalAffiliates: 3,
      totalStorageMinutes: 125,
    });
    expect(mocks.usageUpsert).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: expect.stringMatching(/^usage-snapshot-[a-f0-9]{40}$/) },
      create: expect.objectContaining({
        vendorId: "vendor-1",
        monthKey: "2026-07",
        recordType: "monthly_usage_snapshot",
        quantity: 2,
        totalEvents: 7,
        totalAffiliates: 3,
        totalStorageMinutes: 125,
        metadata: expect.objectContaining({ schemaVersion: 1 }),
      }),
      update: expect.objectContaining({ totalWatchMinutes: 2, totalEvents: 7 }),
    }));
  });
});
