import { describe, expect, it, vi } from "vitest";
import { claimMetricReport, finishMetricReport } from "./live-metric-report-lease";
import { calculateCoreMetrics } from "./live-core-metrics-read-model";
const scope = { vendorId: "v", liveId: "l", versionId: "version", reportId: "r", workerId: "w" };
const result = () => calculateCoreMetrics({ scope: { vendorId: "v", liveId: "l", contentVersionId: "version", mode: "live" }, startMs: 0, endMs: 1000, durationMs: 1000, visits: [], registrations: [], viewing: [], completions: [], orders: [] });
describe("background report lease boundary", () => {
  it("claims through the guarded database function with server-clock expiry", async () => {
    const $queryRaw = vi.fn().mockResolvedValue([{ changed: 1 }]);
    expect(await claimMetricReport({ $queryRaw }, scope)).toBe(true);
    expect($queryRaw.mock.calls[0][0].strings.join("?")).toContain("clock_timestamp()");
    expect($queryRaw.mock.calls[0][0].values).toEqual(["v", "l", "version", "r", "w"]);
  });
  it("does not report a lost lease as success", async () => {
    const $queryRaw = vi.fn().mockResolvedValue([{ changed: 0 }]);
    expect(await claimMetricReport({ $queryRaw }, scope)).toBe(false);
    expect(await finishMetricReport({ $queryRaw }, scope, result())).toBe(false);
  });
  it("rejects raw facts before executing SQL", async () => {
    const $queryRaw = vi.fn();
    await expect(finishMetricReport({ $queryRaw }, scope, { ...result(), personId: "private" } as ReturnType<typeof result>)).rejects.toThrow();
    expect($queryRaw).not.toHaveBeenCalled();
  });
  it("rejects inconsistent numbers instead of persisting a plausible percentage", async () => {
    const $queryRaw = vi.fn();
    await expect(finishMetricReport({ $queryRaw }, scope, { ...result(), attendanceRate: { status: "available", value: 50, numerator: 1, denominator: 4, unit: "percent" } })).rejects.toThrow();
    expect($queryRaw).not.toHaveBeenCalled();
  });
  it("preserves unavailable data instead of replacing it with zero", async () => {
    const $queryRaw = vi.fn().mockResolvedValue([{ changed: 1 }]);
    const data = { ...result(), completionRate: { status: "unavailable" as const, reason: "missing_data" as const } };
    expect(await finishMetricReport({ $queryRaw }, scope, data)).toBe(true);
    expect(JSON.parse($queryRaw.mock.calls[0][0].values.at(-1)).completionRate).toEqual(data.completionRate);
  });
});
