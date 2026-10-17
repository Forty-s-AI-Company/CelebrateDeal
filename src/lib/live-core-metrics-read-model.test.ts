import { describe, expect, it } from "vitest";
import { calculateCoreMetrics, type CoreMetricsInput, type MetricScope, type MetricValue } from "./live-core-metrics-read-model";
import { POST_COMPLETION_ORDER_WINDOW_MS } from "./live-metric-contract";

const scope: MetricScope = { vendorId: "synthetic-vendor", liveId: "synthetic-live", contentVersionId: "v1", mode: "replay" };
function fixture(): CoreMetricsInput {
  return {
    scope, startMs: 0, endMs: 1_000_000_000, durationMs: 100_000,
    visits: Array.from({ length: 10 }, (_, i) => ({ scope, browserId: `browser-${i}`, visitedAtMs: 1000 })),
    registrations: Array.from({ length: 5 }, (_, i) => ({ scope, personId: `person-${i}`, browserId: i < 4 ? `browser-${i}` : null, verifiedAtMs: 2000 })),
    viewing: [
      { scope, personId: "person-0", wallStartMs: 3000, wallEndMs: 93000, mediaStartMs: 0, mediaEndMs: 90000 },
      { scope, personId: "person-0", wallStartMs: 93000, wallEndMs: 123000, mediaStartMs: 0, mediaEndMs: 30000 },
      { scope, personId: "person-1", wallStartMs: 3000, wallEndMs: 103000, mediaStartMs: 0, mediaEndMs: 100000 },
      { scope, personId: "person-2", wallStartMs: 3000, wallEndMs: 33000, mediaStartMs: 0, mediaEndMs: 30000 },
    ],
    completions: [
      { scope, personId: "person-0", firstCompletedAtMs: 93000 },
      { scope, personId: "person-1", firstCompletedAtMs: 93000 },
    ],
    orders: [
      { scope, personId: "person-0", establishedAtMs: 94000, cancelled: false },
      { scope, personId: "person-1", establishedAtMs: 92000, cancelled: false },
    ],
  };
}
function value(metric: MetricValue): number {
  expect(metric.status).toBe("available");
  if (metric.status !== "available") throw new Error("Metric unavailable");
  return metric.value;
}

describe("approved five-metric reporting contract", () => {
  it("matches the proposal example without intermediate rounding or paid-order substitution", () => {
    const result = calculateCoreMetrics(fixture());
    expect(value(result.registrationRate)).toBe(40);
    expect(value(result.attendanceRate)).toBe(60);
    expect(value(result.completionRate)).toBeCloseTo(200 / 3, 10);
    expect(value(result.averageViewingSeconds)).toBeCloseTo(250 / 3, 10);
    expect(value(result.postCompletionOrderRate)).toBe(50);
    expect(result.unattributedRegistrations).toBe(1);
    expect(result.provisionalConversions).toBe(false);
  });
  it("deduplicates retransmissions, browsers and overlapping devices", () => {
    const input = fixture();
    const result = calculateCoreMetrics({ ...input, visits: [...input.visits!, ...input.visits!], registrations: [...input.registrations!, ...input.registrations!], viewing: [...input.viewing!, ...input.viewing!], completions: [...input.completions!, ...input.completions!], orders: [...input.orders!, ...input.orders!] });
    expect(result).toEqual(calculateCoreMetrics(input));
  });
  it("does not mutate caller arrays", () => {
    const input = fixture();
    const before = structuredClone(input);
    Object.freeze(input.viewing);
    Object.freeze(input.registrations);
    calculateCoreMetrics(input);
    expect(input).toEqual(before);
  });
  it("reports zero denominator distinctly from known zero conversion", () => {
    const empty = { ...fixture(), visits: [], registrations: [], viewing: [], completions: [], orders: [] };
    const result = calculateCoreMetrics(empty);
    for (const key of ["registrationRate", "attendanceRate", "completionRate", "averageViewingSeconds", "postCompletionOrderRate"] as const) expect(result[key]).toEqual({ status: "not_applicable", reason: "zero_denominator" });
    expect(value(calculateCoreMetrics({ ...fixture(), registrations: [], viewing: [], completions: [], orders: [] }).registrationRate)).toBe(0);
    expect(value(calculateCoreMetrics({ ...fixture(), viewing: [], completions: [], orders: [] }).attendanceRate)).toBe(0);
  });
  it.each(["visits", "registrations", "viewing", "completions", "orders"] as const)("never turns missing %s into zero", (key) => {
    const result = calculateCoreMetrics({ ...fixture(), [key]: null });
    const dependent = { visits: "registrationRate", registrations: "attendanceRate", viewing: "completionRate", completions: "postCompletionOrderRate", orders: "postCompletionOrderRate" } as const;
    expect(result[dependent[key]]).toEqual({ status: "unavailable", reason: "missing_data" });
  });
  it("keeps available attendance when a live recording has no known duration", () => {
    const result = calculateCoreMetrics({ ...fixture(), durationMs: null });
    expect(value(result.attendanceRate)).toBe(60);
    expect(result.completionRate.status).toBe("unavailable");
    expect(result.postCompletionOrderRate.status).toBe("unavailable");
  });
  it("preserves independent metrics when completion history exceeds the work limit", () => {
    const input = fixture();
    const result = calculateCoreMetrics({ ...input, viewing: Array.from({ length: 10001 }, (_, i) => ({ ...input.viewing![0], wallStartMs: 3000 + i * 1000, wallEndMs: 4000 + i * 1000, mediaStartMs: 0, mediaEndMs: 1000 })) });
    expect(value(result.attendanceRate)).toBe(20);
    expect(value(result.averageViewingSeconds)).toBe(10001);
    expect(result.completionRate).toEqual({ status: "unavailable", reason: "limit_exceeded" });
    expect(result.postCompletionOrderRate).toEqual({ status: "unavailable", reason: "limit_exceeded" });
  });
  it("does not spend the completion budget on retransmitted duplicates", () => {
    const input = fixture();
    const result = calculateCoreMetrics({ ...input, viewing: [...Array(6000).fill(input.viewing![0]), ...Array(6000).fill(input.viewing![2])] });
    expect(value(result.attendanceRate)).toBe(40);
    expect(value(result.averageViewingSeconds)).toBe(95);
    expect(value(result.completionRate)).toBe(100);
    expect(value(result.postCompletionOrderRate)).toBe(50);
  });
  it("supports 100 viewers with one hour of five-second samples", () => {
    const registrations = Array.from({ length: 100 }, (_, i) => ({ scope, personId: `viewer-${i}`, browserId: null, verifiedAtMs: 2000 }));
    const viewing = registrations.flatMap(({ personId }) => Array.from({ length: 720 }, (_, i) => ({ scope, personId, wallStartMs: 3000 + i * 5000, wallEndMs: 8000 + i * 5000, mediaStartMs: i * 5000, mediaEndMs: (i + 1) * 5000 })));
    const completions = registrations.map(({ personId }) => ({ scope, personId, firstCompletedAtMs: 3243000 }));
    const result = calculateCoreMetrics({ ...fixture(), durationMs: 3600000, registrations, viewing, completions, orders: [] });
    expect(value(result.attendanceRate)).toBe(100);
    expect(value(result.completionRate)).toBe(100);
    expect(value(result.averageViewingSeconds)).toBe(3600);
    expect(value(result.postCompletionOrderRate)).toBe(0);
  });
  it("does not attribute a registration to a later browser visit", () => {
    const input = fixture();
    const result = calculateCoreMetrics({ ...input, visits: input.visits!.map((row) => ({ ...row, visitedAtMs: 2500 })) });
    expect(value(result.registrationRate)).toBe(0);
    expect(result.unattributedRegistrations).toBe(5);
  });
  it("counts one browser once even when several people verify through it", () => {
    const input = fixture();
    expect(value(calculateCoreMetrics({ ...input, registrations: input.registrations!.map((row) => ({ ...row, browserId: "browser-0" })) }).registrationRate)).toBe(10);
  });
  it("excludes pre-window registrations and the exclusive right boundary", () => {
    const input = fixture();
    const result = calculateCoreMetrics({ ...input, startMs: 2000, endMs: 103000, registrations: [
      ...input.registrations!.slice(0, 3),
      { scope, personId: "older", browserId: null, verifiedAtMs: 1999 },
      { scope, personId: "later", browserId: null, verifiedAtMs: 103000 },
    ] });
    expect(value(result.attendanceRate)).toBe(100);
    expect(result.provisionalConversions).toBe(true);
    expect(result.unattributedRegistrations).toBe(3);
  });
  it("clips exposure at verification and report boundaries", () => {
    const input: CoreMetricsInput = { ...fixture(), endMs: 6000, durationMs: 10000,
      registrations: [{ scope, personId: "p", browserId: null, verifiedAtMs: 2000 }],
      viewing: [{ scope, personId: "p", wallStartMs: 1000, wallEndMs: 11000, mediaStartMs: 0, mediaEndMs: 10000 }], completions: [], orders: [] };
    const result = calculateCoreMetrics(input);
    expect(value(result.averageViewingSeconds)).toBe(4);
    expect(value(result.completionRate)).toBe(0);
  });
  it("counts replay time but not replayed media as extra completion coverage", () => {
    const input = fixture();
    const repeated = Array.from({ length: 5 }, (_, i) => ({ scope, personId: "p", wallStartMs: 10000 + i * 20000, wallEndMs: 30000 + i * 20000, mediaStartMs: 0, mediaEndMs: 20000 }));
    const result = calculateCoreMetrics({ ...input, registrations: [{ scope, personId: "p", browserId: null, verifiedAtMs: 2000 }], viewing: repeated, completions: [], orders: [] });
    expect(value(result.averageViewingSeconds)).toBe(100);
    expect(value(result.completionRate)).toBe(0);
  });
  it("preserves seek gaps and counts double speed by wall time", () => {
    const input = fixture();
    const result = calculateCoreMetrics({ ...input, registrations: [{ scope, personId: "p", browserId: null, verifiedAtMs: 2000 }], viewing: [
      { scope, personId: "p", wallStartMs: 3000, wallEndMs: 23000, mediaStartMs: 0, mediaEndMs: 40000 },
      { scope, personId: "p", wallStartMs: 33000, wallEndMs: 53000, mediaStartMs: 60000, mediaEndMs: 100000 },
    ], completions: [], orders: [] });
    expect(value(result.averageViewingSeconds)).toBe(40);
    expect(value(result.completionRate)).toBe(0);
  });
  it.each([[-1, 0], [0, 50], [POST_COMPLETION_ORDER_WINDOW_MS, 50], [POST_COMPLETION_ORDER_WINDOW_MS + 1, 0]])("order offset %i yields %i percent", (offset, expected) => {
    const result = calculateCoreMetrics({ ...fixture(), orders: [{ scope, personId: "person-0", establishedAtMs: 93000 + offset, cancelled: false }] });
    expect(value(result.postCompletionOrderRate)).toBe(expected);
  });
  it("excludes cancelled orders and orders at report cutoff", () => {
    const input = fixture();
    expect(value(calculateCoreMetrics({ ...input, orders: input.orders!.map((row) => ({ ...row, cancelled: true })) }).postCompletionOrderRate)).toBe(0);
    expect(value(calculateCoreMetrics({ ...input, endMs: 200000, orders: [{ scope, personId: "person-0", establishedAtMs: 200000, cancelled: false }] }).postCompletionOrderRate)).toBe(0);
  });
  it("marks the inclusive seventh-day boundary as immature until observed", () => {
    expect(calculateCoreMetrics({ ...fixture(), endMs: 93000 + POST_COMPLETION_ORDER_WINDOW_MS }).provisionalConversions).toBe(true);
    expect(calculateCoreMetrics({ ...fixture(), endMs: 93001 + POST_COMPLETION_ORDER_WINDOW_MS }).provisionalConversions).toBe(false);
  });
  it("rejects known-empty first completion facts that contradict coverage", () => {
    expect(calculateCoreMetrics({ ...fixture(), completions: [] }).postCompletionOrderRate).toEqual({ status: "unavailable", reason: "invalid_data" });
  });
  it("rejects an impossible durable completion time or completion without coverage", () => {
    const input = fixture();
    expect(calculateCoreMetrics({ ...input, completions: [{ ...input.completions![0], firstCompletedAtMs: 4000 }, input.completions![1]] }).postCompletionOrderRate).toEqual({ status: "unavailable", reason: "invalid_data" });
    expect(calculateCoreMetrics({ ...input, completions: [...input.completions!, { scope, personId: "person-2", firstCompletedAtMs: 30000 }] }).postCompletionOrderRate).toEqual({ status: "unavailable", reason: "invalid_data" });
  });
  it("reconciles a fractional slope without re-sloping it at verification or T", () => {
    const input: CoreMetricsInput = { ...fixture(), durationMs: 29970, endMs: 27018,
      registrations: [{ scope, personId: "p", browserId: null, verifiedAtMs: 17 }],
      viewing: [{ scope, personId: "p", wallStartMs: 0, wallEndMs: 30000, mediaStartMs: 0, mediaEndMs: 29970 }],
      completions: [{ scope, personId: "p", firstCompletedAtMs: 27017 }], orders: [] };
    expect(value(calculateCoreMetrics(input).completionRate)).toBe(100);
    expect(value(calculateCoreMetrics(input).postCompletionOrderRate)).toBe(0);
    expect(calculateCoreMetrics({ ...input, endMs: 27017 }).postCompletionOrderRate.status).toBe("not_applicable");
    for (const at of [27000, 16]) expect(calculateCoreMetrics({ ...input, completions: [{ scope, personId: "p", firstCompletedAtMs: at }] }).postCompletionOrderRate.status).toBe("unavailable");
  });
  it("unions partially overlapping devices without summing exposure twice", () => {
    const input = fixture();
    const result = calculateCoreMetrics({ ...input, registrations: [input.registrations![0]], durationMs: 200000, completions: [], orders: [], viewing: [
      { scope, personId: "person-0", wallStartMs: 3000, wallEndMs: 63000, mediaStartMs: 0, mediaEndMs: 60000 },
      { scope, personId: "person-0", wallStartMs: 33000, wallEndMs: 93000, mediaStartMs: 0, mediaEndMs: 60000 },
    ] });
    expect(value(result.averageViewingSeconds)).toBe(90);
  });
  it("pins visit S/T and simultaneous verification and counts orders at T-1", () => {
    const input = fixture();
    const result = calculateCoreMetrics({ ...input, endMs: 200000, visits: [
      { scope, browserId: "browser-0", visitedAtMs: 0 },
      { scope, browserId: "browser-1", visitedAtMs: 2000 },
      { scope, browserId: "browser-2", visitedAtMs: 200000 },
    ], orders: [{ scope, personId: "person-0", establishedAtMs: 199999, cancelled: false }] });
    expect(value(result.registrationRate)).toBe(100);
    expect(value(result.postCompletionOrderRate)).toBe(50);
  });
  it("excludes a threshold reached exactly at T but includes it one millisecond later", () => {
    const input: CoreMetricsInput = { ...fixture(), endMs: 93000,
      registrations: [fixture().registrations![0]], viewing: [fixture().viewing![0]],
      completions: [fixture().completions![0]], orders: [] };
    expect(value(calculateCoreMetrics(input).completionRate)).toBe(0);
    expect(value(calculateCoreMetrics({ ...input, endMs: 93001 }).completionRate)).toBe(100);
  });
  it.each([undefined, {}, [null], new Array(2)])("rejects malformed rows without throwing: %j", (viewing) => {
    const result = calculateCoreMetrics({ ...fixture(), viewing } as CoreMetricsInput);
    expect(result.attendanceRate).toEqual({ status: "unavailable", reason: "invalid_data" });
  });
  it.each(["vendorId", "liveId", "contentVersionId", "mode"] as const)("rejects mixed %s instead of silently changing the denominator", (key) => {
    const input = fixture();
    const viewing = input.viewing!.map((row, i) => i ? row : { ...row, scope: { ...scope, [key]: key === "mode" ? "live" : "another" } as MetricScope });
    expect(calculateCoreMetrics({ ...input, viewing }).attendanceRate).toEqual({ status: "unavailable", reason: "invalid_data" });
  });
  it("rejects conflicting registration and completion facts", () => {
    const input = fixture();
    expect(calculateCoreMetrics({ ...input, registrations: [...input.registrations!, { ...input.registrations![0], verifiedAtMs: 5000 }] }).attendanceRate.status).toBe("unavailable");
    expect(calculateCoreMetrics({ ...input, completions: [...input.completions!, { ...input.completions![0], firstCompletedAtMs: 95000 }] }).postCompletionOrderRate.status).toBe("unavailable");
  });
  it.each([0, -1, NaN, Infinity, 1.5])("rejects invalid video duration %s", (durationMs) => {
    expect(calculateCoreMetrics({ ...fixture(), durationMs }).completionRate).toEqual({ status: "unavailable", reason: "invalid_data" });
  });
  it("rejects reversed intervals and coverage beyond the video", () => {
    const input = fixture();
    for (const patch of [{ wallEndMs: 1 }, { mediaEndMs: 100001 }, { mediaStartMs: -1 }]) {
      expect(calculateCoreMetrics({ ...input, viewing: [{ ...input.viewing![0], ...patch }] }).completionRate.status).toBe("unavailable");
    }
  });
});
