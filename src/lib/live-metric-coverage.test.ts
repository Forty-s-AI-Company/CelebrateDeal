import { describe, expect, it } from "vitest";
import { assessMetricCoverage, type MetricCoverageRange } from "./live-metric-coverage";
const scope = { vendorId: "v", liveId: "l", contentVersionId: "version", mode: "live" as const };
const range = (startMs: number, endMs: number): MetricCoverageRange => ({ scope, kind: "visits", startMs, endMs });
const assess = (covered: MetricCoverageRange[] | null, gaps: MetricCoverageRange[] | null = []) => assessMetricCoverage({ ...range(100, 200), covered, gaps });
describe("verified collection coverage", () => {
  it("does not infer complete history from missing records or a missing loss audit", () => {
    expect(assess(null)).toMatchObject({ reason: "unknown_history" });
    expect(assess([range(0, 300)], null)).toMatchObject({ reason: "unknown_history" });
    expect(assess([])).toMatchObject({ reason: "uncovered_window" });
  });
  it("merges adjacent and overlapping evidence without modifying input", () => {
    const rows = [range(150, 220), range(90, 150), range(120, 160)];
    expect(assess(rows)).toEqual({ status: "complete" });
    expect(rows[0].startMs).toBe(150);
  });
  it("does not fill a one millisecond coverage hole", () => {
    expect(assess([range(0, 150), range(151, 300)])).toMatchObject({ reason: "uncovered_window" });
  });
  it("a recorded loss overrides otherwise complete coverage", () => {
    expect(assess([range(0, 300)], [range(199, 200)])).toMatchObject({ reason: "evidence_gap" });
    expect(assess([range(0, 300)], [range(0, 100), range(200, 300)])).toEqual({ status: "complete" });
  });
  it.each(["vendorId", "liveId", "contentVersionId", "mode"] as const)("rejects mixed %s evidence", key => {
    expect(assess([{ ...range(0, 300), scope: { ...scope, [key]: key === "mode" ? "replay" : "foreign" } }])).toMatchObject({ reason: "invalid_evidence" });
  });
  it("does not reuse another metric's coverage", () => {
    expect(assess([{ ...range(0, 300), kind: "viewing" }])).toMatchObject({ reason: "invalid_evidence" });
  });
  it("rejects invalid ranges and excessive work", () => {
    expect(assess([range(200, 100)])).toMatchObject({ reason: "invalid_evidence" });
    expect(assess(Array.from({ length: 10001 }, () => range(0, 300)))).toMatchObject({ reason: "limit_exceeded" });
  });
});
