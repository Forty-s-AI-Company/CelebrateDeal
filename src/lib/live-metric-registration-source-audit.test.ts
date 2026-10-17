import { beforeEach, describe, expect, it, vi } from "vitest";
const ports = vi.hoisted(() => ({ page: vi.fn(), reverse: vi.fn() }));
vi.mock("./live-metric-registration-audit", () => ({ readRegistrationAuditPage: ports.page, readRegistrationProjectionAuditPage: ports.reverse }));
import { auditMetricRegistrationSources } from "./live-metric-registration-source-audit";
const scope = { vendorId: "v", liveId: "l", versionId: "version", startAt: new Date(0), endAt: new Date(100) };
const page = (id: string, hasMore: boolean) => ({ status: "available", sourceRevision: BigInt(1), registrationRevision: BigInt(1), rows: [{ submissionId: id, outcome: "missing_capture" }], hasMore, nextSubmissionId: id });
const makeDb = () => {
  const tx = { $executeRaw: vi.fn(), $queryRaw: vi.fn() };
  const transaction = vi.fn(async (run: (value: typeof tx) => Promise<unknown>) => run(tx));
  return { db: { $transaction: transaction } as unknown as Parameters<typeof auditMetricRegistrationSources>[0], tx, transaction };
};
describe("registration source enumeration", () => {
  beforeEach(() => ports.reverse.mockReset().mockResolvedValue({ status: "available", sourceRevision: BigInt(1), registrationRevision: BigInt(1), rows: [], hasMore: false, nextRegistrationId: null }));
  it("shares the row budget with reverse enumeration and discards the forward digest on overflow", async () => {
    ports.page.mockReset().mockResolvedValue(page("a", false));
    ports.reverse.mockResolvedValue({ status: "available", sourceRevision: BigInt(1), registrationRevision: BigInt(1), rows: [{ registrationId: "r", outcome: "invalid_source" }], hasMore: false, nextRegistrationId: "r" });
    expect(await auditMetricRegistrationSources(makeDb().db, scope, { rows: 1, pages: 2 })).toEqual({ status: "unavailable", reason: "limit_exceeded" });
    expect(await auditMetricRegistrationSources(makeDb().db, scope)).toMatchObject({ status: "enumerated", projectionCount: 1, projectionOutcomes: { invalid_source: 1 } });
  });
  it("aggregates every page in one snapshot without leaking identities or certifying coverage", async () => {
    ports.page.mockReset().mockResolvedValueOnce(page("a", true)).mockResolvedValueOnce(page("b", false));
    const { db, transaction } = makeDb();
    const result = await auditMetricRegistrationSources(db, scope);
    expect(result).toMatchObject({ status: "enumerated", count: 2, coverage: "unknown", outcomes: { missing_capture: 2 } });
    expect(result).not.toHaveProperty("rows");
    expect(transaction).toHaveBeenCalledTimes(1);
    expect(ports.page.mock.calls[1][1].afterSubmissionId).toBe("a");
  });
  it("discards a partial result when row or page budgets run out", async () => {
    for (const limits of [{ rows: 1, pages: 2 }, { rows: 2, pages: 1 }]) {
      ports.page.mockReset().mockResolvedValueOnce(page("a", true)).mockResolvedValueOnce(page("b", false));
      expect(await auditMetricRegistrationSources(makeDb().db, scope, limits)).toEqual({ status: "unavailable", reason: "limit_exceeded" });
    }
  });
  it("uses the same digest regardless of caller property order", async () => {
    ports.page.mockReset().mockResolvedValue(page("a", false));
    const first = await auditMetricRegistrationSources(makeDb().db, scope);
    const second = await auditMetricRegistrationSources(makeDb().db, { endAt: scope.endAt, startAt: scope.startAt,
      versionId: scope.versionId, liveId: scope.liveId, vendorId: scope.vendorId });
    expect(first.status).toBe("enumerated");
    expect(second).toEqual(first);
  });
  it("rejects a repeated cursor instead of looping or emitting a digest", async () => {
    ports.page.mockReset().mockResolvedValue(page("a", true));
    await expect(auditMetricRegistrationSources(makeDb().db, scope)).rejects.toThrow("cursor");
  });
});
