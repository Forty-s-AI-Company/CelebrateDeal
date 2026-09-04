import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ helper: vi.fn(), db: {} }));
vi.mock("@/lib/db", () => ({ getDb: () => mocks.db }));
vi.mock("@/lib/wp4-payuni-buyer-continuation", () => ({ continueWp4BuyerRefund: mocks.helper }));
import { POST } from "./route";
const secret = "buyer-continuation-test-secret"; const source = "a".repeat(40);
const request = (o: { auth?: boolean; sha?: string; body?: string } = {}) => new Request("https://preview.test/api", { method: "POST", headers: { ...(o.auth ? { authorization: `Bearer ${secret}` } : {}), "x-celebratedeal-source-sha": o.sha ?? source }, ...(o.body === undefined ? {} : { body: o.body }) });
beforeEach(() => { vi.clearAllMocks(); vi.stubEnv("JOB_SECRET", secret); vi.stubEnv("VERCEL_ENV", "preview"); vi.stubEnv("PAYUNI_ENV", "sandbox"); vi.stubEnv("WP4_SANDBOX_EXECUTOR_ENABLED", "true"); vi.stubEnv("VERCEL_GIT_COMMIT_SHA", source); mocks.helper.mockResolvedValue({ status: "REFUND_NOT_ELIGIBLE", providerWriteAttempted: false }); });
afterEach(() => vi.unstubAllEnvs());

it.each([
  ["VERCEL_ENV", "production"],
  ["PAYUNI_ENV", "production"],
  ["WP4_SANDBOX_EXECUTOR_ENABLED", "false"],
])("rejects disabled boundary %s without delegation", async (key, value) => {
  vi.stubEnv(key, value);
  expect((await POST(request({ auth: true }))).status).toBe(404);
  expect(mocks.helper).not.toHaveBeenCalled();
});

it("rejects absent runtime source without delegation", async () => {
  vi.stubEnv("VERCEL_GIT_COMMIT_SHA", "");
  vi.stubEnv("WP4_EXPECTED_SOURCE_SHA", "");
  expect((await POST(request({ auth: true }))).status).toBe(503);
  expect(mocks.helper).not.toHaveBeenCalled();
});

it("does not expose internal failure details", async () => {
  mocks.helper.mockRejectedValueOnce(new Error("synthetic internal detail"));
  const response = await POST(request({ auth: true }));
  expect(response.status).toBe(503);
  expect(await response.json()).toEqual({ error: "Service unavailable" });
  expect(response.headers.get("Cache-Control")).toBe("no-store");
});
describe("buyer existing refund route", () => { it("rejects auth, environment, source and body before delegate", async () => { expect((await POST(request())).status).toBe(401); expect((await POST(request({ auth: true, body: "{}" }))).status).toBe(404); vi.stubEnv("VERCEL_ENV", "production"); expect((await POST(request({ auth: true }))).status).toBe(404); vi.stubEnv("VERCEL_ENV", "preview"); expect((await POST(request({ auth: true, sha: "b".repeat(40) }))).status).toBe(404); expect(mocks.helper).not.toHaveBeenCalled(); }); it("returns valid 200 and maps throw to 503", async () => { expect((await POST(request({ auth: true }))).status).toBe(200); mocks.helper.mockRejectedValueOnce(new Error("synthetic")); expect((await POST(request({ auth: true }))).status).toBe(503); }); });
