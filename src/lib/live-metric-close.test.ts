import { describe, expect, it } from "vitest";
import { parseMetricClose, planMetricClose } from "./live-metric-close";
import { MetricIngestError, type LockedMetricSession } from "./live-metric-ingestion";
const state: LockedMetricSession = { versionId: "version", anchorAt: new Date(1000), expiresAt: new Date(10000), durationMs: 10000, lastSequence: 1, lastElapsedMs: 2000, finalSequence: null, closedAt: null, complete: false };
describe("metric delivery close", () => {
  it.each([{}, { sessionId: "s", finalSequence: -2 }, { sessionId: "s", finalSequence: 1.5 }, { sessionId: "s", finalSequence: 2147483648 }, { sessionId: "s", finalSequence: 1, complete: true }, { sessionId: "s", finalSequence: 1, closedAt: 1000 }])("rejects malformed or forged close metadata %j", (body) => {
    expect(() => parseMetricClose(body)).toThrow(new MetricIngestError("invalid_payload"));
  });
  it("accepts an explicitly empty delivered stream", () => {
    expect(parseMetricClose({ sessionId: "s", finalSequence: -1 }).finalSequence).toBe(-1);
    expect(planMetricClose({ ...state, lastSequence: -1, lastElapsedMs: 0 }, -1, new Date(5000)).complete).toBe(true);
  });
  it("seals the declared end without inventing missing events", () => {
    expect(planMetricClose(state, 3, new Date(5000))).toEqual({ complete: false, closedAt: null });
  });
  it("marks delivery complete only when all declared sequences are stored", () => {
    expect(planMetricClose(state, 1, new Date(5000))).toEqual({ complete: true, closedAt: new Date(5000) });
  });
  it("rejects a final sequence below already accepted events", () => {
    expect(() => planMetricClose(state, 0, new Date(5000))).toThrow(new MetricIngestError("sequence_conflict"));
  });
  it("does not permit changing the sealed final sequence", () => {
    expect(() => planMetricClose({ ...state, finalSequence: 3 }, 4, new Date(5000))).toThrow(new MetricIngestError("sequence_conflict"));
  });
  it("replays a completed close without changing its timestamp", () => {
    expect(planMetricClose({ ...state, finalSequence: 1, complete: true, closedAt: new Date(5000) }, 1, new Date(9000))).toEqual({ complete: true, closedAt: new Date(5000) });
  });
  it("cannot upgrade a terminal incomplete session to complete", () => {
    expect(planMetricClose({ ...state, finalSequence: 1, closedAt: new Date(5000) }, 1, new Date(9000))).toEqual({ complete: false, closedAt: new Date(5000) });
  });
  it("acknowledges historical evidence no later than session expiry", () => {
    expect(planMetricClose(state, 1, new Date(20000)).closedAt).toEqual(state.expiresAt);
  });
  it("terminates missing evidence without falsely marking it complete after expiry", () => {
    expect(planMetricClose(state, 3, new Date(20000))).toEqual({ complete: false, closedAt: state.expiresAt });
  });
  it("terminates missing evidence when current content cannot accept it", () => {
    expect(planMetricClose(state, 3, new Date(5000), new Date(0))).toEqual({ complete: false, closedAt: new Date(5000) });
  });
  it("does not invent a closing time while server clock is behind evidence", () => {
    expect(() => planMetricClose(state, 1, new Date(2000))).toThrow(new MetricIngestError("retryable_conflict"));
  });
});
