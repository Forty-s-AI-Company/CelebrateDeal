import { describe, expect, it, vi } from "vitest";
import { readMetricOrderPage, readMetricVisitPage, MetricReadBudget, readMetricReportContext, readMetricIntervalPage, readMetricSessionIntervals, readMetricRegistrationPage, readMetricSessionPage } from "./live-metric-report-reader";
const input = { vendorId: "v", liveId: "l", versionId: "version", reportId: "r", workerId: "w", sessionId: "s", afterSequence: -1, take: 2 };
const session = { isolation: "repeatable read", registrationId: "registration", lastSequence: 2, complete: false, closedAt: null };
const row = (sequence: number) => ({ sequence, wallStartAt: new Date(sequence * 1000), wallEndAt: new Date((sequence + 1) * 1000), mediaStartMs: sequence * 1000, mediaEndMs: (sequence + 1) * 1000 });
describe("bounded metric interval reader", () => {
  it("pages established order attribution without returning payment metadata", async () => {
    const row = { id: "order-a", registrationId: "person", establishedAt: new Date(1000), cancelled: true };
    const $queryRaw = vi.fn().mockResolvedValueOnce([{ isolation: "repeatable read", windowStartAt: new Date(0), windowEndAt: new Date(2000) }])
      .mockResolvedValueOnce([row, { ...row, id: "order-b" }]);
    const { vendorId, liveId, versionId, reportId, workerId } = input;
    expect(await readMetricOrderPage({ $queryRaw }, { vendorId, liveId, versionId, reportId, workerId, afterId: null, take: 1 }))
      .toEqual({ status: "available", rows: [row], hasMore: true, nextId: "order-a" });
  });
  it("does not read orders without a valid report lease", async () => {
    const $queryRaw = vi.fn().mockResolvedValue([]);
    const { vendorId, liveId, versionId, reportId, workerId } = input;
    expect(await readMetricOrderPage({ $queryRaw }, { vendorId, liveId, versionId, reportId, workerId, afterId: null, take: 1 }))
      .toEqual({ status: "unavailable", reason: "lease_or_scope_unavailable" });
    expect($queryRaw).toHaveBeenCalledOnce();
  });
  it("pages visits using time and id so simultaneous visits are not dropped", async () => {
    const visit = { id: "10000000-0000-4000-8000-000000000001", visitorId: "browser", visitedAt: new Date(1000) };
    const $queryRaw = vi.fn().mockResolvedValueOnce([{ isolation: "repeatable read", windowStartAt: new Date(0), windowEndAt: new Date(2000) }])
      .mockResolvedValueOnce([visit, { ...visit, id: "10000000-0000-4000-8000-000000000002" }]);
    const { vendorId, liveId, versionId, reportId, workerId } = input;
    expect(await readMetricVisitPage({ $queryRaw }, { vendorId, liveId, versionId, reportId, workerId, after: null, take: 1 }))
      .toEqual({ status: "available", rows: [visit], hasMore: true, next: { id: visit.id, visitedAt: visit.visitedAt } });
    expect($queryRaw.mock.calls[1][0].values.at(-1)).toBe(2);
  });
  it("does not expose visits when the report lease is unavailable", async () => {
    const $queryRaw = vi.fn().mockResolvedValue([]);
    const { vendorId, liveId, versionId, reportId, workerId } = input;
    expect(await readMetricVisitPage({ $queryRaw }, { vendorId, liveId, versionId, reportId, workerId, after: null, take: 500 })).toMatchObject({ status: "unavailable" });
    expect($queryRaw).toHaveBeenCalledOnce();
  });
  it("reads report context without inventing collection coverage or duration", async () => {
    const context = { windowStartAt: new Date(0), windowEndAt: new Date(10000), mode: "replay", durationMs: null, collectionEnabled: false, collectionStartedAt: null };
    const $queryRaw = vi.fn().mockResolvedValue([{ isolation: "repeatable read", ...context }]);
    const { vendorId, liveId, versionId, reportId, workerId } = input;
    expect(await readMetricReportContext({ $queryRaw }, { vendorId, liveId, versionId, reportId, workerId })).toEqual({ status: "available", context });
    expect($queryRaw).toHaveBeenCalledOnce();
  });
  it("retains incomplete sessions in the paginated result", async () => {
    const $queryRaw = vi.fn().mockResolvedValueOnce([{ isolation: "repeatable read", windowStartAt: new Date(0), windowEndAt: new Date(10000) }])
      .mockResolvedValueOnce([{ id: "registration" }]).mockResolvedValueOnce([{ id: "s1", complete: false, closedAt: null }, { id: "s2", complete: true, closedAt: new Date(9000) }]);
    const { vendorId, liveId, versionId, reportId, workerId } = input;
    expect(await readMetricSessionPage({ $queryRaw }, { vendorId, liveId, versionId, reportId, workerId, registrationId: "registration", afterId: null, take: 1 }))
      .toMatchObject({ status: "available", hasMore: true, nextId: "s1", rows: [{ complete: false, closedAt: null }] });
  });
  it("does not treat a foreign registration as an empty viewing history", async () => {
    const $queryRaw = vi.fn().mockResolvedValueOnce([{ isolation: "repeatable read", windowStartAt: new Date(0), windowEndAt: new Date(10000) }]).mockResolvedValueOnce([]);
    const { vendorId, liveId, versionId, reportId, workerId } = input;
    expect(await readMetricSessionPage({ $queryRaw }, { vendorId, liveId, versionId, reportId, workerId, registrationId: "foreign", afterId: null, take: 500 }))
      .toEqual({ status: "unavailable", reason: "registration_outside_cohort" });
    expect($queryRaw).toHaveBeenCalledTimes(2);
  });
  it("pages the cohort without hiding contradicted identities", async () => {
    const $queryRaw = vi.fn().mockResolvedValueOnce([{ isolation: "repeatable read", windowStartAt: new Date(0), windowEndAt: new Date(10000) }])
      .mockResolvedValueOnce([{ id: "a", visitorId: null, verifiedAt: new Date(1000), identityCurrent: false }, { id: "b", visitorId: "browser", verifiedAt: new Date(2000), identityCurrent: true }]);
    const { vendorId, liveId, versionId, reportId, workerId } = input;
    const page = await readMetricRegistrationPage({ $queryRaw }, { vendorId, liveId, versionId, reportId, workerId, afterId: null, take: 1 });
    expect(page).toMatchObject({ status: "available", nextId: "a", hasMore: true, rows: [{ identityCurrent: false }] });
    expect($queryRaw.mock.calls[1][0].values.at(-1)).toBe(2);
  });
  it("does not query cohort facts without the report lease", async () => {
    const $queryRaw = vi.fn().mockResolvedValue([]);
    const { vendorId, liveId, versionId, reportId, workerId } = input;
    expect(await readMetricRegistrationPage({ $queryRaw }, { vendorId, liveId, versionId, reportId, workerId, afterId: null, take: 500 })).toMatchObject({ status: "unavailable" });
    expect($queryRaw).toHaveBeenCalledOnce();
  });
  it("shares row limits across sessions and does not return truncated facts", async () => {
    const $queryRaw = vi.fn().mockImplementation(async (query) => query.strings.join("").includes("current_setting")
      ? [{ ...session, lastSequence: 1 }] : [row(0), row(1)]);
    const budget = new MetricReadBudget({ rows: 3, pages: 10, milliseconds: 1000 });
    const scope = { vendorId: input.vendorId, liveId: input.liveId, versionId: input.versionId, reportId: input.reportId, workerId: input.workerId, sessionId: input.sessionId };
    expect((await readMetricSessionIntervals({ $queryRaw }, scope, budget)).status).toBe("available");
    expect(await readMetricSessionIntervals({ $queryRaw }, scope, budget)).toEqual({ status: "unavailable", reason: "limit_exceeded" });
  });
  it("does not query after the time budget expires", async () => {
    let time = 0; const budget = new MetricReadBudget({ rows: 10, pages: 10, milliseconds: 1000 }, () => time);
    time = 1000; const $queryRaw = vi.fn();
    const scope = { vendorId: input.vendorId, liveId: input.liveId, versionId: input.versionId, reportId: input.reportId, workerId: input.workerId, sessionId: input.sessionId };
    expect(await readMetricSessionIntervals({ $queryRaw }, scope, budget)).toEqual({ status: "unavailable", reason: "limit_exceeded" });
    expect($queryRaw).not.toHaveBeenCalled();
  });
  it("uses one lookahead row and a sequence cursor without claiming complete delivery", async () => {
    const $queryRaw = vi.fn().mockResolvedValueOnce([session]).mockResolvedValueOnce([row(0), row(1), row(2)]);
    const result = await readMetricIntervalPage({ $queryRaw }, input);
    expect(result).toMatchObject({ status: "available", nextSequence: 1, hasMore: true, deliveryComplete: false });
    if (result.status === "available") expect(result.rows).toHaveLength(2);
    expect($queryRaw.mock.calls[1][0].values.at(-1)).toBe(3);
  });
  it("returns the final page without silently truncating", async () => {
    const $queryRaw = vi.fn().mockResolvedValueOnce([{ ...session, complete: true, closedAt: new Date(4000) }]).mockResolvedValueOnce([row(2)]);
    expect(await readMetricIntervalPage({ $queryRaw }, { ...input, afterSequence: 1 })).toMatchObject({ nextSequence: 2, hasMore: false, deliveryComplete: true });
  });
  it("does not turn unavailable scope into an empty dataset", async () => {
    const $queryRaw = vi.fn().mockResolvedValue([]);
    expect(await readMetricIntervalPage({ $queryRaw }, input)).toEqual({ status: "unavailable", reason: "lease_or_scope_unavailable" });
    expect($queryRaw).toHaveBeenCalledOnce();
  });
  it("requires a stable transaction snapshot", async () => {
    const $queryRaw = vi.fn().mockResolvedValue([{ ...session, isolation: "read committed" }]);
    await expect(readMetricIntervalPage({ $queryRaw }, input)).rejects.toThrow("repeatable-read");
    expect($queryRaw).toHaveBeenCalledOnce();
  });
  it.each([{ rows: [row(0)] }, { rows: [row(1), row(2)] }])("rejects missing or discontinuous rows", async ({ rows }) => {
    const $queryRaw = vi.fn().mockResolvedValueOnce([session]).mockResolvedValueOnce(rows);
    await expect(readMetricIntervalPage({ $queryRaw }, input)).rejects.toThrow("snapshot");
  });
  it("rejects oversized pages before querying", async () => {
    const $queryRaw = vi.fn();
    await expect(readMetricIntervalPage({ $queryRaw }, { ...input, take: 501 })).rejects.toThrow();
    expect($queryRaw).not.toHaveBeenCalled();
  });
});
