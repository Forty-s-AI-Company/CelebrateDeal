import { describe, expect, it, vi } from "vitest";
import { publishMetricCompletion, readMetricCompletion } from "./live-metric-completion-store";
const lease = { vendorId: "v", liveId: "l", versionId: "version", reportId: "r", workerId: "w" };
const scope = { vendorId: "v", liveId: "l", contentVersionId: "version", mode: "live" } as const;
describe("completion storage boundary", () => {
  it("keeps missing provenance distinct from audited empty rows", async () => {
    const db = { $queryRaw: vi.fn().mockResolvedValueOnce([{ isolation: "repeatable read", rowCount: null, cohortCount: null }]).mockResolvedValueOnce([{ isolation: "repeatable read", rowCount: 0, cohortCount: 1 }]).mockResolvedValueOnce([{ rows: [] }]) };
    expect(await readMetricCompletion(db, lease)).toEqual({ status: "available", rows: null, cohortCount: null });
    expect(await readMetricCompletion(db, lease)).toEqual({ status: "available", rows: [], cohortCount: 1 });
  });
  it("rejects wrong isolation and malformed durable facts", async () => {
    const db = { $queryRaw: vi.fn().mockResolvedValueOnce([{ isolation: "read committed", rowCount: 0, cohortCount: 1 }]).mockResolvedValueOnce([{ isolation: "repeatable read", rowCount: 1, cohortCount: 1 }]).mockResolvedValueOnce([{ rows: [{ personId: "p", firstCompletedAtMs: -1 }] }]) };
    await expect(readMetricCompletion(db, lease)).rejects.toThrow("repeatable-read");
    await expect(readMetricCompletion(db, lease)).rejects.toThrow();
  });
  it("does not fetch the payload when the shared row budget is exhausted", async () => {
    const db = { $queryRaw: vi.fn().mockResolvedValue([{ isolation: "repeatable read", rowCount: 10000, cohortCount: 10000 }]) };
    const reserve = vi.fn().mockReturnValue(false);
    expect(await readMetricCompletion(db, lease, reserve)).toEqual({ status: "unavailable", reason: "limit_exceeded" });
    expect(reserve).toHaveBeenCalledWith(10001);
    expect(db.$queryRaw).toHaveBeenCalledTimes(1);
    expect(db.$queryRaw.mock.calls[0][0].sql).not.toContain("jsonb_array_length");
    expect(db.$queryRaw.mock.calls[0][0].sql).not.toContain("SELECT rows");
  });
  it("rejects foreign candidates before SQL and retains DB lease rejection", async () => {
    const query = vi.fn().mockResolvedValue([{ changed: 0 }]);
    const db = { $transaction: vi.fn(async (run: (tx: { $queryRaw: typeof query }) => Promise<boolean>) => run({ $queryRaw: query })) };
    await expect(publishMetricCompletion(db as unknown as Parameters<typeof publishMetricCompletion>[0], lease, BigInt(1), scope, { status: "available", cohortCount: 1, rows: [{ scope: { ...scope, vendorId: "foreign" }, personId: "p", firstCompletedAtMs: 10 }] })).rejects.toThrow("scope");
    expect(db.$transaction).not.toHaveBeenCalled();
    expect(await publishMetricCompletion(db as unknown as Parameters<typeof publishMetricCompletion>[0], lease, BigInt(1), scope, { status: "available", cohortCount: 1, rows: [] })).toBe(false);
  });
});
