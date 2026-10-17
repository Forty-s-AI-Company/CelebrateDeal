vi.mock("./live-metric-completion-store", () => ({ publishMetricCompletion: ports.publish }));
import { beforeEach, describe, expect, it, vi } from "vitest";
const ports = vi.hoisted(() => ({ publish: vi.fn(), claim: vi.fn(), snapshot: vi.fn(), convert: vi.fn(), finish: vi.fn() }));
vi.mock("./live-metric-report-lease", () => ({ claimMetricReport: ports.claim, finishMetricReport: ports.finish }));
vi.mock("./live-metric-report-snapshot", () => ({ loadMetricViewingSnapshot: ports.snapshot }));
vi.mock("./live-metric-snapshot-input", () => ({ metricSnapshotInput: ports.convert }));
import { runMetricReportJob } from "./live-metric-report-job";
import { calculateCoreMetrics } from "./live-core-metrics-read-model";
const db = { $queryRaw: vi.fn(), $transaction: vi.fn() };
const lease = { vendorId: "v", liveId: "l", versionId: "version", reportId: "r", workerId: "w" };
const input = { scope: { vendorId: "v", liveId: "l", contentVersionId: "version", mode: "replay" as const },
  startMs: 0, endMs: 1000, durationMs: null, visits: null, registrations: null, viewing: null, completions: null, orders: null };
beforeEach(() => {
  vi.resetAllMocks(); ports.claim.mockResolvedValue(true); ports.snapshot.mockResolvedValue({ status: "available", data: {} });
  ports.convert.mockReturnValue(input); ports.finish.mockResolvedValue(true);
});
describe("single report job orchestration", () => {
  it("persists unavailable aggregates without converting unknown history to zero", async () => {
    const execute = vi.fn(async () => ({ status: "available" as const, metrics: calculateCoreMetrics(input) }));
    expect(await runMetricReportJob(db, lease, execute)).toEqual({ status: "recorded" });
    expect(ports.finish.mock.calls[0][2].registrationRate).toEqual({ status: "unavailable", reason: "missing_data" });
    expect(execute).toHaveBeenCalledWith(input);
  });
  it("never reads or computes without claiming", async () => {
    ports.claim.mockResolvedValue(false); const execute = vi.fn();
    expect(await runMetricReportJob(db, lease, execute)).toEqual({ status: "not_claimed" });
    expect(ports.snapshot).not.toHaveBeenCalled(); expect(execute).not.toHaveBeenCalled();
  });
  it("never completes missing snapshots or failed workers", async () => {
    const execute = vi.fn().mockResolvedValue({ status: "unavailable", reason: "timeout" });
    ports.snapshot.mockResolvedValueOnce({ status: "unavailable", reason: "limit_exceeded" });
    expect(await runMetricReportJob(db, lease, execute)).toEqual({ status: "snapshot_unavailable", reason: "limit_exceeded" });
    expect(execute).not.toHaveBeenCalled();
    expect(await runMetricReportJob(db, lease, execute)).toEqual({ status: "execution_unavailable", reason: "timeout" });
    expect(ports.finish).not.toHaveBeenCalled();
  });
  it("reports a lost lease after computation as unfinished", async () => {
    ports.finish.mockResolvedValue(false);
    expect(await runMetricReportJob(db, lease, async () => ({ status: "available", metrics: calculateCoreMetrics(input) }))).toEqual({ status: "lease_lost" });
  });
  it("sanitizes failures and keeps the initial scope stable across awaits", async () => {
    const mutable = { ...lease }; ports.claim.mockImplementation(async () => { mutable.vendorId = "changed"; return true; });
    ports.snapshot.mockRejectedValue(new Error("synthetic private details"));
    expect(await runMetricReportJob(db, mutable, vi.fn())).toEqual({ status: "failed", stage: "snapshot" });
    expect(ports.snapshot.mock.calls[0][1]).toEqual(lease);
  });
});


it("publishes candidates then reloads durable facts before calculation", async () => {
  const complete = { ...input, durationMs: 1000, registrations: [], viewing: [] };
  ports.snapshot.mockResolvedValue({ status: "available", data: { context: { sourceRevision: BigInt(4) } } });
  ports.convert.mockReturnValueOnce(complete).mockReturnValueOnce({ ...complete, completions: [] });
  ports.publish.mockResolvedValue(true);
  const project = vi.fn().mockResolvedValue({ status: "available", projection: { status: "available", cohortCount: 0, rows: [] } });
  const execute = vi.fn().mockResolvedValue({ status: "available", metrics: calculateCoreMetrics(input) });
  expect(await runMetricReportJob(db, lease, execute, project)).toEqual({ status: "recorded" });
  expect(ports.snapshot).toHaveBeenCalledTimes(2);
  expect(ports.publish.mock.calls[0][2]).toBe(BigInt(4));
  expect(execute.mock.calls[0][0].completions).toEqual([]);
});
it("does not finish a projection rejected after source change", async () => {
  ports.snapshot.mockResolvedValue({ status: "available", data: { context: { sourceRevision: BigInt(4) } } });
  ports.convert.mockReturnValue({ ...input, durationMs: 1000, registrations: [], viewing: [] });
  ports.publish.mockResolvedValue(false);
  const execute = vi.fn();
  expect(await runMetricReportJob(db, lease, execute, vi.fn().mockResolvedValue({ status: "available", projection: { status: "available", cohortCount: 0, rows: [] } }))).toEqual({ status: "lease_lost" });
  expect(execute).not.toHaveBeenCalled(); expect(ports.finish).not.toHaveBeenCalled();
});
