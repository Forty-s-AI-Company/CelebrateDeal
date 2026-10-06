import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ getDb: vi.fn() }));
vi.mock("@/lib/db", () => ({ getDb: mocks.getDb }));
const origin = "http://127.0.0.1:31041", sha = "a".repeat(40), secret = "synthetic-wp4-job-secret";
const routes = ["wp4-refund-recovery", "wp4-buyer-callback-retry", "wp4-buyer-existing-state", "wp4-buyer-existing-refund", "wp4-buyer-existing-reconcile",
 "wp4-subscription-payment-attempt", "wp4-subscription-state", "wp4-subscription-refund", "wp4-subscription-reconcile"];
beforeEach(() => {
 vi.clearAllMocks();
 vi.stubEnv("JOB_SECRET", secret); vi.stubEnv("VERCEL_ENV", "preview"); vi.stubEnv("PAYUNI_ENV", "sandbox");
 vi.stubEnv("WP4_SANDBOX_EXECUTOR_ENABLED", "true"); vi.stubEnv("WP4_DISPOSABLE_RUNNER_MARKER", "verified-loopback");
 vi.stubEnv("VERCEL_PROJECT_ID", ""); vi.stubEnv("NEXT_PUBLIC_APP_URL", origin);
 vi.stubEnv("DATABASE_URL", "postgresql://synthetic:synthetic@127.0.0.1:5544/celebratedeal_test");
 vi.stubEnv("DIRECT_URL", "postgresql://synthetic:synthetic@127.0.0.1:5544/celebratedeal_test");
 vi.stubEnv("VERCEL_GIT_COMMIT_SHA", sha); vi.stubEnv("WP4_EXPECTED_SOURCE_SHA", sha);
});
afterEach(() => vi.unstubAllEnvs());
describe.each(routes)("fixed recovery boundary %s", route => {
 async function dispatch(options: { auth?: boolean; source?: string; body?: string; suffix?: string; host?: string } = {}) {
  const handler = await import(`./${route}/route`);
  return handler.POST(new Request(`${options.host ?? origin}/api/admin/ops/payuni/${route}${options.suffix ?? ""}`, {
   method: "POST", headers: { ...(options.auth === false ? {} : { authorization: `Bearer ${secret}` }), "x-celebratedeal-source-sha": options.source ?? sha },
   ...(options.body === undefined ? {} : { body: options.body }),
  }));
 }
 it("rejects unauthenticated caller content before database/provider work", async () => {
  expect((await dispatch({ auth: false, body: "caller-content" })).status).toBe(401); expect(mocks.getDb).not.toHaveBeenCalled();
 });
 it.each([{ source: "b".repeat(40) }, { body: "{}" }, { suffix: "?transactionId=caller" }, { host: "http://127.0.0.1:31042" }])("rejects caller scope drift %#", async input => {
  expect((await dispatch(input)).status).toBe(404); expect(mocks.getDb).not.toHaveBeenCalled();
 });
 it("rejects production and arbitrary Preview database/project bindings", async () => {
  vi.stubEnv("VERCEL_ENV", "production"); expect((await dispatch()).status).toBe(404);
  vi.stubEnv("VERCEL_ENV", "preview"); vi.stubEnv("VERCEL_PROJECT_ID", "other-project"); expect((await dispatch()).status).toBe(404);
  expect(mocks.getDb).not.toHaveBeenCalled();
 });
});
