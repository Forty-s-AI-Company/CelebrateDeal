import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ retry: vi.fn() }));
vi.mock("@/lib/db", () => ({ getDb: () => ({}) }));
vi.mock("@/lib/wp4-payuni-buyer-callback-retry", () => ({ retryWp4PayUniBuyerCallback: mocks.retry }));
import { POST } from "./route";
const secret = "retry-job-secret"; const source = "a".repeat(40);
function request(options: { authorization?: string; sha?: string; body?: BodyInit } = {}) { return new Request("https://preview.example.test/api/admin/ops/payuni/wp4-buyer-callback-retry", { method: "POST", headers: { ...(options.authorization ? { authorization: options.authorization } : {}), "x-celebratedeal-source-sha": options.sha ?? source }, ...(options.body === undefined ? {} : { body: options.body, duplex: "half" }) } as RequestInit); }
beforeEach(() => { vi.clearAllMocks(); vi.stubEnv("JOB_SECRET", secret); vi.stubEnv("VERCEL_ENV", "preview"); vi.stubEnv("PAYUNI_ENV", "sandbox"); vi.stubEnv("WP4_SANDBOX_EXECUTOR_ENABLED", "true"); vi.stubEnv("VERCEL_GIT_COMMIT_SHA", source); mocks.retry.mockResolvedValue({ status: "RETRY_FAILED", retryAttempts: 1, failureCode: "processing_failed" }); });
afterEach(() => vi.unstubAllEnvs());
describe("WP4 buyer callback retry route", () => { it("enforces existing guards before helper", async () => { expect((await POST(request())).status).toBe(401); vi.stubEnv("VERCEL_ENV", "production"); expect((await POST(request({ authorization: `Bearer ${secret}` }))).status).toBe(404); expect(mocks.retry).not.toHaveBeenCalled(); }); it("returns the fixed result", async () => { const response = await POST(request({ authorization: `Bearer ${secret}` })); expect(response.status).toBe(200); await expect(response.json()).resolves.toEqual({ status: "RETRY_FAILED", retryAttempts: 1, failureCode: "processing_failed" }); }); });
