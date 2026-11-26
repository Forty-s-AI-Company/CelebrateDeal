import { describe, expect, it, vi } from "vitest";

const monitoring = vi.hoisted(() => ({ captureOperationalError: vi.fn() }));
vi.mock("@/lib/monitoring", () => monitoring);

import { dataRetentionPolicy, purgeExpiredData } from "@/lib/data-retention";

function sqlOf(call: unknown[]) {
  return (call[0] as TemplateStringsArray).join("?");
}

describe("purgeExpiredData viewer nickname step", () => {
  it("reconciles finished VODs oldest-idle first, skips one that fails, and still purges", async () => {
    const unsettled = [{ vendorId: "vendor-1", liveId: "live-broken" }, { vendorId: "vendor-1", liveId: "live-ok" }];
    const queryRaw = vi.fn(async (...call: unknown[]) => (sqlOf(call).includes('"deleted"') ? [{ count: 2 }] : unsettled));
    const findFirst = vi.fn(async (args: { where: { id: string } }) => {
      if (args.where.id === "live-broken") throw new Error("synthetic read failure");
      return null;
    });
    const db = {
      $executeRaw: vi.fn(async () => 0),
      $queryRaw: queryRaw,
      live: { findFirst, updateMany: vi.fn() },
    };

    const result = await purgeExpiredData(db as never, { now: new Date("2027-01-01T00:00:00.000Z"), policy: dataRetentionPolicy({}) });

    expect(result.liveViewerProfilesDeleted).toBe(2);
    expect(findFirst).toHaveBeenCalledTimes(2);
    expect(monitoring.captureOperationalError).toHaveBeenCalledTimes(1);
    expect(monitoring.captureOperationalError).toHaveBeenCalledWith(
      expect.any(Error),
      { source: "data_retention", operation: "live_viewer_profile_reconcile" },
      { level: "warning" },
    );

    const unsettledSql = sqlOf(queryRaw.mock.calls[0] as unknown[]);
    expect(unsettledSql).toMatch(/"live"\."videoId" IS NOT NULL/u);
    expect(unsettledSql).toMatch(/ORDER BY MIN\("profile"\."lastActiveAt"\) ASC/u);

    // The DELETE re-checks idleness and only deleted rows are detached.
    const purgeSql = sqlOf(queryRaw.mock.calls[1] as unknown[]);
    expect(purgeSql).toMatch(/DELETE FROM "LiveViewerProfile"\s+WHERE "id" IN \(SELECT "id" FROM "doomed"\)\s+AND "lastActiveAt" < \?/u);
    expect(purgeSql).toMatch(/WHERE "viewerProfileId" IN \(SELECT "id" FROM "deleted"\)/u);
  });
});
