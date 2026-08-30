import { describe, expect, it, vi } from "vitest";

import {
  createDashboardMeasurement,
  dashboardMeasurementAttributes,
  readDashboardAnalyticsCounts,
  readDashboardEmailCounts,
  readDashboardLiveSubmissionCounts,
  readDashboardRegistrationCounts,
} from "./dashboard-read-model";

describe("dashboard read model", () => {
  it("records sanitized read-operation count and duration without query payloads", async () => {
    const measurement = createDashboardMeasurement();
    await measurement.measure("example.count", async () => 3);

    expect(measurement.snapshot()).toMatchObject({
      readOperationCount: 1,
      totalDurationMs: expect.any(Number),
      entries: [{ name: "example.count", durationMs: expect.any(Number) }],
    });
  });

  it("exposes only aggregate read-operation attributes for browser QA", () => {
    expect(dashboardMeasurementAttributes({
      readOperationCount: 6,
      totalDurationMs: 12.7,
      entries: [{ name: "should-not-render", durationMs: 12.7 }],
    })).toEqual({
      "data-dashboard-read-operation-count": "6",
      "data-dashboard-read-operation-duration-ms": "13",
    });
  });

  it("uses grouped registration counts when Prisma supports groupBy", async () => {
    const groupBy = vi.fn().mockResolvedValue([
      { verificationStatus: "UNVERIFIED", _count: { _all: 3 } },
      { verificationStatus: "VERIFIED", _count: { _all: 5 } },
    ]);
    const db = { formSubmission: { groupBy } } as unknown as Parameters<typeof readDashboardRegistrationCounts>[0];

    await expect(readDashboardRegistrationCounts(db, "vendor-1", new Date("2026-08-01T00:00:00.000Z")))
      .resolves.toEqual({ total: 8, verified: 5 });
    expect(groupBy).toHaveBeenCalledOnce();
  });

  it("uses grouped email status counts when Prisma supports groupBy", async () => {
    const groupBy = vi.fn().mockResolvedValue([
      { status: "sent", _count: { _all: 7 } },
      { status: "failed", _count: { _all: 2 } },
    ]);
    const db = { emailDelivery: { groupBy } } as unknown as Parameters<typeof readDashboardEmailCounts>[0];

    await expect(readDashboardEmailCounts(db, "vendor-1", new Date("2026-08-01T00:00:00.000Z")))
      .resolves.toEqual({ sent: 7, failed: 2 });
    expect(groupBy).toHaveBeenCalledOnce();
  });

  it("returns provider-independent analytics counts without loading visitor rows", async () => {
    const queryRaw = vi.fn().mockResolvedValue([
        { eventType: "page_view", uniqueVisitors: 100 },
        { eventType: "product_click", uniqueVisitors: 20 },
      ]);
    const db = { $queryRaw: queryRaw } as unknown as Parameters<typeof readDashboardAnalyticsCounts>[0];

    await expect(readDashboardAnalyticsCounts(db, "vendor-1", new Date("2026-08-01T00:00:00.000Z")))
      .resolves.toEqual({ views: 100, productClicks: 20, ctaClicks: 0 });
    expect(queryRaw).toHaveBeenCalledOnce();
  });

  it("aggregates recent-live submission counts without selecting submission rows", async () => {
    const groupBy = vi.fn().mockResolvedValue([
      { liveId: "live-1", verificationStatus: "VERIFIED", _count: { _all: 4 } },
      { liveId: "live-1", verificationStatus: "UNVERIFIED", _count: { _all: 2 } },
    ]);
    const db = { formSubmission: { groupBy } } as unknown as Parameters<typeof readDashboardLiveSubmissionCounts>[0];

    await expect(readDashboardLiveSubmissionCounts(db, "vendor-1", ["live-1"]))
      .resolves.toEqual({ "live-1": { verified: 4, pending: 2 } });
    expect(groupBy).toHaveBeenCalledOnce();
  });
});
