vi.mock("./live-metric-completion-store", () => ({ readMetricCompletion: readers.completion }));
import type * as reader from "./live-metric-report-reader";
vi.mock("./live-metric-coverage-reader", () => ({ readMetricCoverage: readers.coverage }));
import { beforeEach, describe, expect, it, vi } from "vitest";
const readers = vi.hoisted(() => ({ completion: vi.fn(), orders: vi.fn(), coverage: vi.fn(), losses: vi.fn(), visits: vi.fn(), context: vi.fn(), registrations: vi.fn(), sessions: vi.fn(), intervals: vi.fn() }));
vi.mock("./live-metric-report-reader", async original => ({ ...await original<typeof import("./live-metric-report-reader")>(),
  withMetricOrderRevision: async (tx: Parameters<typeof reader.withMetricOrderRevision>[0], _lease: Parameters<typeof reader.withMetricOrderRevision>[1], read: Parameters<typeof reader.withMetricOrderRevision>[2]) => read(tx),
  readMetricOrderPage: readers.orders, readMetricVisitLossPage: readers.losses, readMetricVisitPage: readers.visits, readMetricReportContext: readers.context, readMetricRegistrationPage: readers.registrations, readMetricSessionPage: readers.sessions, readMetricSessionIntervals: readers.intervals }));
import { loadMetricViewingSnapshot } from "./live-metric-report-snapshot";
import { MetricReadBudget } from "./live-metric-report-reader";
const lease = { vendorId: "v", liveId: "l", versionId: "version", reportId: "r", workerId: "worker" };
const tx = { $queryRaw: vi.fn().mockResolvedValue([]) };
const db = { $transaction: vi.fn(async callback => callback(tx)) };
beforeEach(() => {
  vi.clearAllMocks();
  readers.completion.mockResolvedValue({ status: "available", rows: null, cohortCount: null });
  readers.orders.mockResolvedValue({ status: "available", rows: [], hasMore: false, nextId: null });
  readers.coverage.mockResolvedValue({ status: "available", rowCount: 0, coverage: { status: "unavailable", reason: "unknown_history" } });
  readers.losses.mockResolvedValue({ status: "available", rows: [], hasMore: false, next: null });
  readers.visits.mockResolvedValue({ status: "available", rows: [], hasMore: false, next: null });
  readers.context.mockResolvedValue({ status: "available", context: { windowStartAt: new Date(0), windowEndAt: new Date(10000), mode: "replay", durationMs: null, collectionEnabled: false, collectionStartedAt: null } });
  readers.registrations.mockResolvedValue({ status: "available", rows: [{ id: "person", identityCurrent: true }], hasMore: false, nextId: "person" });
  readers.sessions.mockResolvedValue({ status: "available", rows: [{ id: "s", complete: false }], hasMore: false, nextId: "s" });
  readers.intervals.mockResolvedValue({ status: "available", registrationId: "person", rows: [{ sequence: 0 }], deliveryComplete: false });
});
describe("bounded viewing snapshot orchestration", () => {
  it("keeps other intake histories unknown when visits alone are certified", async () => {
    readers.coverage.mockImplementation(async (_tx, _lease, kind) => ({ status: "available", rowCount: kind === "visits" ? 1 : 0,
      coverage: kind === "visits" ? { status: "complete" } : { status: "unavailable", reason: "unknown_history" } }));
    expect(await loadMetricViewingSnapshot(db, lease)).toMatchObject({ status: "available", data: {
      visitCoverage: { status: "complete" }, registrationCoverage: { status: "unavailable", reason: "unknown_history" },
      viewingCoverage: { status: "unavailable", reason: "unknown_history" }, orderCoverage: { status: "unavailable", reason: "unknown_history" },
    } });
    expect(readers.coverage.mock.calls.map(call => call[2])).toEqual(["visits", "registrations", "viewing", "orders"]);
    expect(readers.coverage.mock.calls.every(call => call[0] === tx)).toBe(true);
  });
  it("charges every kind against one shared budget", async () => {
    readers.coverage.mockResolvedValue({ status: "available", rowCount: 1, coverage: { status: "complete" } });
    expect(await loadMetricViewingSnapshot(db, lease, new MetricReadBudget({ rows: 3, pages: 20, milliseconds: 1000 })))
      .toEqual({ status: "unavailable", reason: "limit_exceeded" });
    expect(readers.visits).not.toHaveBeenCalled();
  });
  it("preserves known loss even if the visit facts are empty", async () => {
    readers.losses.mockResolvedValue({ status: "available", rows: [{ visitedAt: new Date(1000) }], hasMore: false });
    expect(await loadMetricViewingSnapshot(db, lease)).toMatchObject({ status: "available", data: {
      visits: [], visitLosses: [{ visitedAt: new Date(1000) }], visitCoverage: { status: "unavailable", reason: "evidence_gap" } } });
    expect(readers.losses.mock.calls[0][0]).toBe(tx);
  });
  it("discards all facts when the loss audit fails", async () => {
    readers.losses.mockResolvedValue({ status: "unavailable", reason: "lease_or_scope_unavailable" });
    expect(await loadMetricViewingSnapshot(db, lease)).toEqual({ status: "unavailable", reason: "lease_or_scope_unavailable" });
    expect(readers.visits).not.toHaveBeenCalled();
  });
  it("charges loss rows against the shared report budget", async () => {
    readers.losses.mockResolvedValue({ status: "available", rows: [{ visitedAt: new Date(1) }, { visitedAt: new Date(2) }], hasMore: false });
    expect(await loadMetricViewingSnapshot(db, lease, new MetricReadBudget({ rows: 1, pages: 10, milliseconds: 1000 })))
      .toEqual({ status: "unavailable", reason: "limit_exceeded" });
    expect(readers.visits).not.toHaveBeenCalled();
  });
  it("discards visit prefixes when a later page fails", async () => {
    readers.visits.mockResolvedValueOnce({ status: "available", rows: [{ id: "v1" }], hasMore: true, next: { id: "v1", visitedAt: new Date(0) } })
      .mockResolvedValueOnce({ status: "unavailable", reason: "lease_or_scope_unavailable" });
    expect(await loadMetricViewingSnapshot(db, lease)).toEqual({ status: "unavailable", reason: "lease_or_scope_unavailable" });
    expect(readers.registrations).not.toHaveBeenCalled();
  });
  it("charges visit rows against the same report budget", async () => {
    readers.visits.mockResolvedValue({ status: "available", rows: [{ id: "v1" }, { id: "v2" }], hasMore: false });
    expect(await loadMetricViewingSnapshot(db, lease, new MetricReadBudget({ rows: 1, pages: 10, milliseconds: 1000 })))
      .toEqual({ status: "unavailable", reason: "limit_exceeded" });
    expect(readers.registrations).not.toHaveBeenCalled();
  });
  it("keeps unknown duration and disabled collection explicit even for an empty cohort", async () => {
    readers.registrations.mockResolvedValue({ status: "available", rows: [], hasMore: false });
    expect(await loadMetricViewingSnapshot(db, lease)).toMatchObject({ status: "available", data: {
      context: { mode: "replay", durationMs: null, collectionEnabled: false, collectionStartedAt: null },
      visitCoverage: { status: "unavailable", reason: "unknown_history" }, registrations: [], sessions: [] } });
    expect(readers.context.mock.calls[0][0]).toBe(tx);
  });
  it("does not enumerate facts after context lease validation fails", async () => {
    readers.context.mockResolvedValue({ status: "unavailable", reason: "lease_or_scope_unavailable" });
    expect(await loadMetricViewingSnapshot(db, lease)).toEqual({ status: "unavailable", reason: "lease_or_scope_unavailable" });
    expect(readers.registrations).not.toHaveBeenCalled();
  });
  it("uses one bounded read snapshot and retains incomplete delivery", async () => {
    const value = await loadMetricViewingSnapshot(db, lease);
    expect(value).toMatchObject({ status: "available", data: { deliveryComplete: false, registrations: [{ id: "person" }], sessions: [{ registrationId: "person", intervals: [{ sequence: 0 }] }] } });
    expect(db.$transaction).toHaveBeenCalledWith(expect.any(Function), { isolationLevel: "RepeatableRead", timeout: 30000, maxWait: 5000 });
    expect(readers.intervals.mock.calls[0][0]).toBe(tx);
  });
  it("does not return a partial result after a later page fails", async () => {
    readers.registrations.mockResolvedValueOnce({ status: "available", rows: [{ id: "person", identityCurrent: true }], hasMore: true, nextId: "person" })
      .mockResolvedValueOnce({ status: "unavailable", reason: "lease_or_scope_unavailable" });
    expect(await loadMetricViewingSnapshot(db, lease)).toEqual({ status: "unavailable", reason: "lease_or_scope_unavailable" });
  });
  it("rejects changed identities without changing the denominator", async () => {
    readers.registrations.mockResolvedValue({ status: "available", rows: [{ id: "person", identityCurrent: false }], hasMore: false });
    expect(await loadMetricViewingSnapshot(db, lease)).toEqual({ status: "unavailable", reason: "identity_changed" });
    expect(readers.sessions).not.toHaveBeenCalled();
  });
  it("shares the budget across cohort and session enumeration", async () => {
    expect(await loadMetricViewingSnapshot(db, lease, new MetricReadBudget({ rows: 1, pages: 10, milliseconds: 1000 })))
      .toEqual({ status: "unavailable", reason: "limit_exceeded" });
    expect(readers.intervals).not.toHaveBeenCalled();
  });
  it("propagates infrastructure failure rather than returning zero data", async () => {
    readers.sessions.mockRejectedValueOnce(new Error("database-unavailable"));
    await expect(loadMetricViewingSnapshot(db, lease)).rejects.toThrow("database-unavailable");
  });
});
