import { describe, expect, it } from "vitest";
import { metricSnapshotInput } from "./live-metric-snapshot-input";
import { calculateCoreMetrics } from "./live-core-metrics-read-model";
import type { MetricViewingSnapshot } from "./live-metric-report-snapshot";
const complete = { status: "complete" } as const;
const unknown = { status: "unavailable", reason: "unknown_history" } as const;
function snapshot(): MetricViewingSnapshot {
  return { scope: { vendorId: "v", liveId: "l", contentVersionId: "version", mode: "replay" },
    context: { windowStartAt: new Date(0), windowEndAt: new Date(10000), mode: "replay", durationMs: 1000, collectionEnabled: true, collectionStartedAt: new Date(0) },
    visitCoverage: complete, registrationCoverage: complete, viewingCoverage: complete, orderCoverage: complete,
    visits: [{ id: "visit", visitorId: "browser", visitedAt: new Date(100) }], visitLosses: [], orders: [],
    registrations: [{ id: "person", visitorId: "browser", verifiedAt: new Date(200), identityCurrent: true }],
    sessions: [{ registrationId: "person", session: { id: "session", anchorAt: new Date(300), expiresAt: new Date(2000), closedAt: new Date(1300), complete: true, lastSequence: 0 },
      intervals: [{ sequence: 0, wallStartAt: new Date(300), wallEndAt: new Date(1300), mediaStartMs: 0, mediaEndMs: 1000 }] }], deliveryComplete: true };
}
describe("audited snapshot calculator input", () => {
  it("calculates supported facts while leaving missing order and completion provenance unknown", () => {
    const input = metricSnapshotInput(snapshot()); const result = calculateCoreMetrics(input);
    expect(result.registrationRate).toMatchObject({ status: "available", value: 100 });
    expect(result.attendanceRate).toMatchObject({ status: "available", value: 100 });
    expect(result.completionRate).toMatchObject({ status: "available", value: 100 });
    expect(result.averageViewingSeconds).toMatchObject({ status: "available", value: 1 });
    expect(input.orders).toEqual([]); expect(input.completions).toBeNull();
    expect(result.postCompletionOrderRate.status).toBe("unavailable");
  });
  it("does not infer registrations from visits coverage", () => {
    const data = snapshot(); data.registrationCoverage = unknown;
    const result = calculateCoreMetrics(metricSnapshotInput(data));
    expect(result.registrationRate.status).toBe("unavailable"); expect(result.attendanceRate.status).toBe("unavailable");
  });
  it("requires both viewing coverage and delivery while preserving independent registration metrics", () => {
    for (const missing of ["coverage", "delivery"]) {
      const data = snapshot(); if (missing === "coverage") data.viewingCoverage = unknown; else data.deliveryComplete = false;
      const result = calculateCoreMetrics(metricSnapshotInput(data));
      expect(result.registrationRate.status).toBe("available"); expect(result.attendanceRate.status).toBe("unavailable");
    }
  });
  it("distinguishes audited empty histories from unknown and rejects identity contradictions", () => {
    const data = snapshot(); data.visits = []; data.registrations = []; data.sessions = [];
    expect(calculateCoreMetrics(metricSnapshotInput(data)).attendanceRate).toEqual({ status: "not_applicable", reason: "zero_denominator" });
    const invalid = snapshot(); invalid.sessions[0].registrationId = "foreign";
    expect(() => metricSnapshotInput(invalid)).toThrow("identity unavailable");
  });
});


it("uses stored first-crossing facts only with complete viewing provenance", () => {
  const data = snapshot();
  data.completionProjection = { cohortCount: 1, rows: [{ personId: "person", firstCompletedAtMs: 1200 }] };
  data.orders = [{ id: "order", registrationId: "person", establishedAt: new Date(1300), cancelled: false }];
  expect(calculateCoreMetrics(metricSnapshotInput(data)).postCompletionOrderRate).toMatchObject({ status: "available", value: 100 });
  data.viewingCoverage = unknown;
  expect(metricSnapshotInput(data).completions).toBeNull();
});
it("rejects a stored projection for a different cohort", () => {
  const data = snapshot(); data.completionProjection = { cohortCount: 2, rows: [] };
  expect(() => metricSnapshotInput(data)).toThrow("completion cohort");
});
