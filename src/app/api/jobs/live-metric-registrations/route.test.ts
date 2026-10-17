import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ db: {}, getDb: vi.fn(), reconcile: vi.fn() }));
vi.mock("@/lib/db", () => ({ getDb: mocks.getDb }));
vi.mock("@/lib/live-metric-registration-reconcile", async importOriginal => ({
  ...await importOriginal<typeof import("@/lib/live-metric-registration-reconcile")>(),
  reconcileMetricRegistrations: mocks.reconcile,
}));
import { POST } from "./route";
const scope = { vendorId: "vendor", liveId: "live", versionId: "version", afterSubmissionId: null, take: 2 };
const syntheticKey = "synthetic-metric-job-test-key";
function request(value: unknown, authorization: string | null = `Bearer ${syntheticKey}`) {
  return new Request("https://app.example.test/api/jobs/live-metric-registrations", { method: "POST",
    headers: { "content-type": "application/json", ...(authorization ? { authorization } : {}) }, body: JSON.stringify(value) });
}
beforeEach(() => {
  vi.clearAllMocks(); vi.stubEnv("JOB_SECRET", syntheticKey); mocks.getDb.mockReturnValue(mocks.db);
  mocks.reconcile.mockResolvedValue({ status: "batch_complete", processed: 2, retryable: 1, terminalGaps: 1,
    outcomes: { pending_verification: 1, outside_retention: 1 }, nextSubmissionId: "next", hasMore: true, coverage: "unknown" });
});
afterEach(() => vi.unstubAllEnvs());
describe("metric registration job", () => {
  it.each([null, "Bearer wrong", `Basic ${syntheticKey}`])("rejects unauthenticated calls before DB access: %s", async authorization => {
    const response = await POST(request(scope, authorization));
    expect(response.status).toBe(401); expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(mocks.getDb).not.toHaveBeenCalled(); expect(mocks.reconcile).not.toHaveBeenCalled();
  });
  it("fails closed when job authentication is not configured", async () => {
    vi.stubEnv("JOB_SECRET", ""); expect((await POST(request(scope))).status).toBe(401); expect(mocks.getDb).not.toHaveBeenCalled();
  });
  it.each([{}, { ...scope, take: 21 }, { ...scope, take: 0 }, { ...scope, afterSubmissionId: "bad cursor" }, { ...scope, extra: true }])("rejects malformed scope before DB access %#", async value => {
    expect((await POST(request(value))).status).toBe(400); expect(mocks.getDb).not.toHaveBeenCalled();
  });
  it("rejects oversized and malformed bodies", async () => {
    expect((await POST(request({ value: "a".repeat(1500) }))).status).toBe(400);
    const malformed = new Request("https://app.example.test/api/jobs/live-metric-registrations", { method: "POST", headers: { authorization: `Bearer ${syntheticKey}`, "content-type": "application/json" }, body: "{" });
    expect((await POST(malformed)).status).toBe(400); expect(mocks.getDb).not.toHaveBeenCalled();
  });
  it("passes exact scope and preserves pending/terminal/cursor semantics", async () => {
    const response = await POST(request(scope)); expect(response.status).toBe(200);
    expect(mocks.reconcile).toHaveBeenCalledWith(mocks.db, scope);
    expect(await response.json()).toMatchObject({ retryable: 1, terminalGaps: 1, hasMore: true, nextSubmissionId: "next", coverage: "unknown" });
    expect(response.headers.get("cache-control")).toBe("private, no-store");
  });
  it("does not return exception details or cache failures", async () => {
    mocks.reconcile.mockRejectedValueOnce(new Error("synthetic private diagnostic"));
    const response = await POST(request(scope)); expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ error: "Reconciliation unavailable" });
    expect(response.headers.get("cache-control")).toBe("private, no-store");
  });
});
