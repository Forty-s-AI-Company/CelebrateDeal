import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ check: vi.fn(), db: {} }));
vi.mock("@/lib/db", () => ({ getDb: () => mocks.db }));
vi.mock("@/lib/wp4-payuni-buyer-payment-check", () => ({ checkWp4PayUniBuyerPayment: mocks.check }));
import { POST } from "./route";

const secret = "buyer-check-test-job-secret";
const source = "a".repeat(40);
function request(options: { authorization?: string; sha?: string; body?: BodyInit } = {}) {
  return new Request("https://celebrate-deal-staging.carry-digital-nomad.in.net/api/admin/ops/payuni/wp4-buyer-payment-check", {
    method: "POST", headers: {
      ...(options.authorization ? { authorization: options.authorization } : {}),
      "x-celebratedeal-source-sha": options.sha ?? source,
    }, ...(options.body === undefined ? {} : { body: options.body, duplex: "half" }),
  } as RequestInit);
}
beforeEach(() => {
    vi.stubEnv("VERCEL_PROJECT_ID", "prj_3d4ib8cXrF3f3HsqdSwfabpBWvZn");
  vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://celebrate-deal-staging.carry-digital-nomad.in.net");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://ocbugvgojrunvenozsbx.supabase.co");
  vi.stubEnv("DATABASE_URL", "postgresql://db.ocbugvgojrunvenozsbx.supabase.co:5432/postgres");
  vi.stubEnv("DIRECT_URL", "postgresql://db.ocbugvgojrunvenozsbx.supabase.co:5432/postgres");
  vi.stubEnv("STAGING_DATABASE_URL", "postgresql://db.ocbugvgojrunvenozsbx.supabase.co:5432/postgres");

  vi.clearAllMocks(); vi.stubEnv("JOB_SECRET", secret); vi.stubEnv("VERCEL_ENV", "preview"); vi.stubEnv("PAYUNI_ENV", "sandbox");
  vi.stubEnv("WP4_SANDBOX_EXECUTOR_ENABLED", "true"); vi.stubEnv("VERCEL_GIT_COMMIT_SHA", source);
  mocks.check.mockResolvedValue({ status: "REFERENCE_UNAVAILABLE", localStatus: "PENDING", providerStatus: "UNKNOWN", referenceState: "PROVIDER_MISSING", queryAttempts: 0, callbackStatus: "NOT_OBSERVED", callbackFailure: "NONE" });
});
afterEach(() => vi.unstubAllEnvs());

describe("WP4 current buyer payment check route", () => {
  it("fails closed before helper access for auth, environment, source, and body violations", async () => {
    expect((await POST(request())).status).toBe(401);
    vi.stubEnv("VERCEL_ENV", "production");
    expect((await POST(request({ authorization: `Bearer ${secret}` }))).status).toBe(404);
      vi.stubEnv("VERCEL_ENV", "preview");
    vi.stubEnv("PAYUNI_ENV", "production");
    expect((await POST(request({ authorization: `Bearer ${secret}` }))).status).toBe(404);
    vi.stubEnv("PAYUNI_ENV", "sandbox");
    vi.stubEnv("WP4_SANDBOX_EXECUTOR_ENABLED", "false");
    expect((await POST(request({ authorization: `Bearer ${secret}` }))).status).toBe(404);
    vi.stubEnv("WP4_SANDBOX_EXECUTOR_ENABLED", "true");
    expect((await POST(request({ authorization: `Bearer ${secret}`, sha: "b".repeat(40) }))).status).toBe(404);
    expect((await POST(request({ authorization: `Bearer ${secret}`, body: "{}" }))).status).toBe(404);
    expect(mocks.check).not.toHaveBeenCalled();
  });
  it("returns only the fixed helper result", async () => {
    const response = await POST(request({ authorization: `Bearer ${secret}` }));
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    await expect(response.json()).resolves.toEqual({ status: "REFERENCE_UNAVAILABLE", localStatus: "PENDING", providerStatus: "UNKNOWN", referenceState: "PROVIDER_MISSING", queryAttempts: 0, callbackStatus: "NOT_OBSERVED", callbackFailure: "NONE" });
    expect(mocks.check).toHaveBeenCalledExactlyOnceWith(mocks.db);
  });
});
