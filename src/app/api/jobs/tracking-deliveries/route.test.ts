import { afterEach, beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ run: vi.fn() }));
vi.mock("@/lib/tracking-purchase-worker", () => ({ runPurchaseTrackingBatch: mocks.run }));
import { POST } from "./route";
beforeEach(() => {
  mocks.run.mockReset().mockResolvedValue({ claimed: 0, accepted: 0, retried: 0, rejected: 0, cancelled: 0 });
  vi.stubEnv("JOB_SECRET", "synthetic-tracking-job-secret"); vi.stubEnv("VERCEL_ENV", "preview");
  vi.stubEnv("META_TRACKING_TEST_DELIVERY_ENABLED", "true"); vi.stubEnv("META_GRAPH_API_VERSION", "v22.0");
});
afterEach(() => vi.unstubAllEnvs());
const request = (body: unknown, authorized = true) => new Request("http://127.0.0.1/api/jobs/tracking-deliveries", {
  method: "POST", headers: { "content-type": "application/json", ...(authorized ? { authorization: "Bearer synthetic-tracking-job-secret" } : {}) }, body: JSON.stringify(body),
});
it("requires bearer authentication before checking settings or invoking the worker", async () => {
  expect((await POST(request({ vendorId: "vendor-one" }, false))).status).toBe(401); expect(mocks.run).not.toHaveBeenCalled();
});
it("refuses production and disabled execution even for an authenticated job", async () => {
  vi.stubEnv("VERCEL_ENV", "production"); expect((await POST(request({ vendorId: "vendor-one" }))).status).toBe(403);
  vi.stubEnv("VERCEL_ENV", "preview"); vi.stubEnv("META_TRACKING_TEST_DELIVERY_ENABLED", "false");
  expect((await POST(request({ vendorId: "vendor-one" }))).status).toBe(403); expect(mocks.run).not.toHaveBeenCalled();
});
it.each([{ vendorId: "../foreign" }, { vendorId: "vendor-one", limit: 21 }, { vendorId: "vendor-one", limit: 0 }, { vendorId: "vendor-one", url: "https://example.test" }])("rejects invalid or ambiguous batch input", async body => {
  expect((await POST(request(body))).status).toBe(400); expect(mocks.run).not.toHaveBeenCalled();
});
it("preserves queued work when an explicit provider version is absent", async () => {
  vi.stubEnv("META_GRAPH_API_VERSION", ""); expect((await POST(request({ vendorId: "vendor-one" }))).status).toBe(202); expect(mocks.run).not.toHaveBeenCalled();
});
it("passes the bounded authenticated tenant scope and exposes only summary counts", async () => {
  const response = await POST(request({ vendorId: "vendor-one", limit: 2 })); expect(response.status).toBe(200);
  expect(mocks.run).toHaveBeenCalledWith({ vendorId: "vendor-one", limit: 2, apiVersion: "v22.0" });
  expect(await response.json()).toEqual({ ok: true, claimed: 0, accepted: 0, retried: 0, rejected: 0, cancelled: 0 });
});
it("does not expose provider credentials or raw failures in the response", async () => {
  mocks.run.mockRejectedValue(new Error("synthetic-private-provider-error")); const response = await POST(request({ vendorId: "vendor-one" }));
  expect(response.status).toBe(503); expect(await response.json()).toEqual({ ok: false, error: "tracking_job_failed" });
});
