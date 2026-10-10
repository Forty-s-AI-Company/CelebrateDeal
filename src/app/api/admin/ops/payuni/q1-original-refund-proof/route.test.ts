import { beforeEach, afterEach, expect, it, vi } from "vitest";
const fixture = vi.hoisted(() => ({ db: {}, read: vi.fn() }));
vi.mock("@/lib/db", () => ({ getDb: () => fixture.db }));
vi.mock("@/lib/payuni-pending-refund-proof", () => ({ readQ1OriginalPendingRefundProof: fixture.read }));
import { GET } from "./route";

const source = "a".repeat(40), origin = "https://celebrate-deal-staging.carry-digital-nomad.in.net", secret = "synthetic-q1-proof-job-secret";
beforeEach(() => {
  fixture.read.mockReset().mockResolvedValue({ sourceCommit: source, historicalOriginalBound: true });
  for (const [key, value] of Object.entries({ JOB_SECRET: secret, VERCEL_ENV: "preview", PAYUNI_ENV: "sandbox",
    WP4_SANDBOX_EXECUTOR_ENABLED: "true", VERCEL_PROJECT_ID: "prj_3d4ib8cXrF3f3HsqdSwfabpBWvZn", WP4_DISPOSABLE_RUNNER_MARKER: "",
    NEXT_PUBLIC_APP_URL: origin, NEXT_PUBLIC_SUPABASE_URL: "https://ocbugvgojrunvenozsbx.supabase.co",
    DATABASE_URL: "postgresql://db.ocbugvgojrunvenozsbx.supabase.co/postgres",
    DIRECT_URL: "postgresql://db.ocbugvgojrunvenozsbx.supabase.co/postgres",
    STAGING_DATABASE_URL: "postgresql://db.ocbugvgojrunvenozsbx.supabase.co/postgres", VERCEL_GIT_COMMIT_SHA: source,
    WP4_EXPECTED_SOURCE_SHA: source })) vi.stubEnv(key, value);
});
afterEach(() => vi.unstubAllEnvs());
const request = (url = origin + "/api/admin/ops/payuni/q1-original-refund-proof", authorization = `Bearer ${secret}`, sha = source) =>
  new Request(url, { headers: { authorization, "x-celebratedeal-source-sha": sha } });
it("returns fixed original evidence with current deployment binding and no-store", async () => {
  const response = await GET(request());
  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({ sourceCommit: source, historicalOriginalBound: true, databaseBound: true, nonProductionScope: "fixed-staging-project" });
  expect(response.headers.get("cache-control")).toBe("private, no-store");
  expect(fixture.read).toHaveBeenCalledExactlyOnceWith(fixture.db, source);
});
it.each([["VERCEL_ENV", "production"], ["PAYUNI_ENV", "production"], ["WP4_SANDBOX_EXECUTOR_ENABLED", "false"],
  ["VERCEL_PROJECT_ID", "foreign-project"], ["DATABASE_URL", "postgresql://foreign.invalid:54329/celebratedeal_test"],
  ["NEXT_PUBLIC_SUPABASE_URL", "https://foreign.invalid"], ["VERCEL_GIT_COMMIT_SHA", "b".repeat(40)]])("rejects %s before proof/database", async (key, value) => {
  vi.stubEnv(key, value);
  expect((await GET(request())).status).not.toBe(200);
  expect(fixture.read).not.toHaveBeenCalled();
});
it("rejects an otherwise valid disposable loopback instead of labeling it staging", async () => {
  for (const [key, value] of Object.entries({ VERCEL_PROJECT_ID: "", WP4_DISPOSABLE_RUNNER_MARKER: "verified-loopback",
    NEXT_PUBLIC_APP_URL: "http://127.0.0.1:31041", DATABASE_URL: "postgresql://postgres:postgres@127.0.0.1:54329/celebratedeal_test",
    DIRECT_URL: "postgresql://postgres:postgres@127.0.0.1:54329/celebratedeal_test" })) vi.stubEnv(key, value);
  const response = await GET(request("http://127.0.0.1:31041/api/admin/ops/payuni/q1-original-refund-proof"));
  expect(response.status).toBe(404); expect(await response.text()).not.toContain("fixed-staging-project");
  expect(fixture.read).not.toHaveBeenCalled();
});
it("rejects a staging project ID backed by a loopback database", async () => {
  vi.stubEnv("DATABASE_URL", "postgresql://postgres:postgres@127.0.0.1:54329/celebratedeal_test");
  expect((await GET(request())).status).toBe(404); expect(fixture.read).not.toHaveBeenCalled();
});
it.each([request(origin + "/api/admin/ops/payuni/q1-original-refund-proof?transactionId=other"),
  request("http://foreign.invalid/api/admin/ops/payuni/q1-original-refund-proof"), request(undefined, "Bearer wrong"),
  request(undefined, undefined, "b".repeat(40))])("rejects caller selector/origin/authorization/source", async incoming => {
  expect((await GET(incoming)).status).not.toBe(200); expect(fixture.read).not.toHaveBeenCalled();
});
it("rejects any non-empty body before proof lookup", async () => {
  const incoming = new Request(origin + "/api/admin/ops/payuni/q1-original-refund-proof", { method: "POST", body: "{}",
    headers: { authorization: `Bearer ${secret}`, "x-celebratedeal-source-sha": source } });
  expect((await GET(incoming)).status).toBe(404); expect(fixture.read).not.toHaveBeenCalled();
});
it("fails closed for absent or failed proof without raw errors", async () => {
  fixture.read.mockResolvedValueOnce(null);
  expect((await GET(request())).status).toBe(404);
  fixture.read.mockRejectedValueOnce(new Error("synthetic-private-diagnostic"));
  const response = await GET(request()); expect(response.status).toBe(503);
  expect(await response.text()).not.toContain("synthetic-private-diagnostic");
});
