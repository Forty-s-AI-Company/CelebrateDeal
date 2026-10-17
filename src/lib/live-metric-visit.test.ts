import { describe, expect, it, vi } from "vitest";
import { recordMetricVisit } from "./live-metric-visit";

const scope = { vendorId: "v", liveId: "l", versionId: "version", visitorId: "visitor" };
const eventId = "10000000-0000-4000-8000-000000000001";
function database(rows: unknown[][]) {
  const $queryRaw = vi.fn();
  for (const result of rows) $queryRaw.mockResolvedValueOnce(result);
  return { $queryRaw, $transaction: vi.fn(async callback => callback({ $queryRaw })) };
}
describe("server visit persistence", () => {
  it.each([true, false])("returns the stored timestamp for inserted=%s", async inserted => {
    const db = database([[], [{ id: "version" }], [{ id: "visitor" }], [], inserted ? [{ id: eventId }] : [], [{ visitedAt: new Date(1234) }]]);
    expect(await recordMetricVisit(db, scope, { eventId })).toEqual({ eventId, visitedAtMs: 1234, replayed: !inserted });
    expect(db.$transaction).toHaveBeenCalledWith(expect.any(Function), { isolationLevel: "ReadCommitted", timeout: 10000, maxWait: 5000 });
    // Stored row identity is server-generated; the client key is scoped separately.
    expect(db.$queryRaw.mock.calls[4][0].values[0]).not.toBe(eventId);
  });
  it("replays committed receipts without another insert", async () => {
    const db = database([[], [{}], [{}], [{ visitedAt: new Date(1234) }]]);
    expect(await recordMetricVisit(db, scope, { eventId })).toEqual({ eventId, visitedAtMs: 1234, replayed: true });
    expect(db.$queryRaw).toHaveBeenCalledTimes(4);
  });
  it("rejects client timestamps and identity fields before touching the database", async () => {
    const db = database([]);
    await expect(recordMetricVisit(db, scope, { eventId, visitedAtMs: 1 })).rejects.toThrow();
    await expect(recordMetricVisit(db, scope, { eventId, visitorId: "foreign" })).rejects.toThrow();
    expect(db.$transaction).not.toHaveBeenCalled();
  });
  it("does not insert for a missing scoped visitor", async () => {
    const db = database([[], [], []]);
    await expect(recordMetricVisit(db, scope, { eventId })).rejects.toThrow("scope unavailable");
    expect(db.$queryRaw).toHaveBeenCalledTimes(3);
  });
  it("fails closed if the scoped receipt is unexpectedly missing", async () => {
    const db = database([[], [{}], [{}], [], [], []]);
    await expect(recordMetricVisit(db, scope, { eventId })).rejects.toThrow("scope unavailable");
  });
});
