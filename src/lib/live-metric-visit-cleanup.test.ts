import { describe, expect, it, vi } from "vitest";
import { deleteMetricVisitBatch } from "./live-metric-visit-cleanup";
const input = { vendorId: "v", liveId: "l", versionId: "version", visitorId: "visitor", before: new Date(1000), take: 1 };
function database(rows: unknown[][]) {
  const $queryRaw = vi.fn(); for (const row of rows) $queryRaw.mockResolvedValueOnce(row);
  return { $queryRaw, $transaction: vi.fn(async callback => callback({ $queryRaw })) };
}
describe("bounded visit cleanup", () => {
  it("rejects oversized batches before database access", async () => {
    const db = database([]);
    await expect(deleteMetricVisitBatch(db, { ...input, take: 1001 })).rejects.toThrow();
    expect(db.$transaction).not.toHaveBeenCalled();
  });
  it("refuses active collection before locking visitor rows", async () => {
    const db = database([[], [{ collectionEnabled: true, expiresAt: new Date(3000), now: new Date(2000) }]]);
    await expect(deleteMetricVisitBatch(db, input)).rejects.toThrow("must be closed");
    expect(db.$queryRaw).toHaveBeenCalledTimes(2);
  });
  it("rejects unavailable scope rather than reporting an empty cleanup", async () => {
    await expect(deleteMetricVisitBatch(database([[], []]), input)).rejects.toThrow("scope unavailable");
  });
  it("returns bounded deletion progress", async () => {
    const db = database([[], [{ collectionEnabled: false, expiresAt: new Date(3000), now: new Date(2000) }], [{}], [{ id: "event" }], [{}]]);
    expect(await deleteMetricVisitBatch(db, input)).toEqual({ deleted: 1, hasMore: true });
  });
});
