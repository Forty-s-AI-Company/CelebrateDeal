import { describe, expect, it } from "vitest";
import { MetricIngestError, parseMetricIngestBatch, planMetricIntervalWrites, prepareMetricIntervals, type MetricIngestState } from "./live-metric-ingestion";

const state: MetricIngestState = { anchorAt: new Date(10000), durationMs: 100000, lastSequence: -1, lastElapsedMs: 0, closedAt: null, complete: false };
const sample = { sequence: 0, startElapsedMs: 0, endElapsedMs: 1000, mediaStartMs: 0, mediaEndMs: 1000, rate: 1 };
const batch = (segments = [sample]) => parseMetricIngestBatch({ sessionId: "session-1", segments });
const prepare = (segments = [sample]) => prepareMetricIntervals(batch(segments), state, new Date(20000));

describe("metric ingestion boundary", () => {
  it.each([
    { sessionId: "session-1", personId: "forged", segments: [sample] },
    { sessionId: "session-1", segments: [{ ...sample, wallEndAt: 11000 }] },
    { sessionId: "session-1", segments: [] },
    { sessionId: "session-1", segments: Array.from({ length: 21 }, () => sample) },
    { sessionId: "session-1", segments: [{ ...sample, sequence: 0.5 }] },
    { sessionId: "session-1", segments: [{ ...sample, endElapsedMs: 2147483648 }] },
    { sessionId: "session-1", segments: [{ ...sample, rate: Number.NaN }] },
  ])("rejects untrusted identity, wall clocks and unbounded input: %j", (value) => {
    expect(() => parseMetricIngestBatch(value)).toThrowError(new MetricIngestError("invalid_payload"));
  });
  it("anchors valid exposure to server time and hashes a canonical tuple", () => {
    const [row] = prepare();
    expect(+row.wallStartAt).toBe(10000); expect(+row.wallEndAt).toBe(11000);
    expect(row.payloadHash).toMatch(/^[a-f0-9]{64}$/);
    const reordered = parseMetricIngestBatch({ segments: [{ rate: 1, mediaEndMs: 1000, sequence: 0, endElapsedMs: 1000, mediaStartMs: 0, startElapsedMs: 0 }], sessionId: "session-1" });
    expect(prepareMetricIntervals(reordered, state, new Date(20000))[0].payloadHash).toBe(row.payloadHash);
  });
  it.each([
    { ...sample, endElapsedMs: 5001, mediaEndMs: 5001 },
    { ...sample, mediaEndMs: 50000 },
    { ...sample, mediaStartMs: 100, mediaEndMs: 100 },
    { ...sample, mediaStartMs: 99900, mediaEndMs: 100900 },
  ])("rejects gaps, seeks, zero exposure and content overshoot: %j", (segment) => {
    expect(() => prepare([segment])).toThrowError(new MetricIngestError("invalid_segment"));
  });
  it("rejects future exposure", () => {
    expect(() => prepareMetricIntervals(batch(), state, new Date(10999))).toThrowError(new MetricIngestError("invalid_segment"));
  });
  it("accepts quantized quarter-speed exposure", () => {
    expect(prepare([{ ...sample, rate: 0.25, mediaEndMs: 250 }])).toHaveLength(1);
  });
  it("rejects a gap or overlap within one batch", () => {
    for (const next of [{ ...sample, sequence: 2, startElapsedMs: 1000, endElapsedMs: 2000 }, { ...sample, sequence: 1 }]) {
      expect(() => prepare([sample, next])).toThrowError(new MetricIngestError("invalid_segment"));
    }
  });
});

describe("idempotent append planning", () => {
  it("appends the first interval once", () => {
    expect(planMetricIntervalWrites(prepare(), state, []).receipt).toEqual({ accepted: 1, replayed: 0, lastSequence: 0 });
  });
  it("acknowledges an exact replay without another write, even after close", () => {
    const rows = prepare();
    const plan = planMetricIntervalWrites(rows, { ...state, lastSequence: 0, lastElapsedMs: 1000, closedAt: new Date(12000), complete: true }, rows);
    expect(plan.append).toEqual([]); expect(plan.receipt).toEqual({ accepted: 0, replayed: 1, lastSequence: 0 });
  });
  it("rejects a changed payload at an existing sequence", () => {
    const original = prepare();
    expect(() => planMetricIntervalWrites(prepare([{ ...sample, mediaEndMs: 1001 }]), { ...state, lastSequence: 0 }, original)).toThrowError(new MetricIngestError("sequence_conflict"));
  });
  it("accepts replay prefix followed by new contiguous evidence", () => {
    const next = { ...sample, sequence: 1, startElapsedMs: 1000, endElapsedMs: 2000, mediaStartMs: 1000, mediaEndMs: 2000 };
    const plan = planMetricIntervalWrites(prepare([sample, next]), { ...state, lastSequence: 0, lastElapsedMs: 1000 }, prepare());
    expect(plan.receipt).toEqual({ accepted: 1, replayed: 1, lastSequence: 1 }); expect(plan.append[0].sequence).toBe(1);
  });
  it("rejects sequence holes and overlap against previously stored progress", () => {
    expect(() => planMetricIntervalWrites(prepare([{ ...sample, sequence: 2 }]), state, [])).toThrowError(new MetricIngestError("sequence_conflict"));
    expect(() => planMetricIntervalWrites(prepare([{ ...sample, sequence: 1 }]), { ...state, lastSequence: 0, lastElapsedMs: 1000 }, [])).toThrowError(new MetricIngestError("sequence_conflict"));
  });
  it("rejects new evidence after close", () => {
    expect(() => planMetricIntervalWrites(prepare(), { ...state, closedAt: new Date(12000) }, [])).toThrowError(new MetricIngestError("session_closed"));
  });
});
