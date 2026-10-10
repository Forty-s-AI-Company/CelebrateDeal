import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ read: vi.fn(), database: {} }));
vi.mock("@/lib/db", () => ({ getDb: () => mocks.database }));
vi.mock("@/lib/payuni-pending-refund-proof", () => ({
  PAYUNI_REFUND_STAGING_HOST: "celebrate-deal-staging.carry-digital-nomad.in.net", readPendingRefundProof: mocks.read,
}));
import { GET } from "./route";

const source = "a".repeat(40);
function request({ auth = true, sha = source, host = "celebrate-deal-staging.carry-digital-nomad.in.net", query = "transactionId=synthetic-transaction" } = {}) {
  return new Request(`https://${host}/api/admin/ops/payuni/pending-refund-proof?${query}`, {
    headers: { ...(auth ? { authorization: "Bearer synthetic-job-secret" } : {}), "x-celebratedeal-source-sha": sha },
  });
}
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("JOB_SECRET", "synthetic-job-secret");
  vi.stubEnv("VERCEL_ENV", "preview");
  vi.stubEnv("PAYUNI_ENV", "sandbox");
  vi.stubEnv("WP4_SANDBOX_EXECUTOR_ENABLED", "true");
  vi.stubEnv("VERCEL_GIT_COMMIT_SHA", source);
  vi.stubEnv("VERCEL_PROJECT_ID", "prj_3d4ib8cXrF3f3HsqdSwfabpBWvZn");
  vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://celebrate-deal-staging.carry-digital-nomad.in.net");
  vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://ocbugvgojrunvenozsbx.supabase.co");
  for (const key of ["DATABASE_URL", "DIRECT_URL", "STAGING_DATABASE_URL"]) {
    vi.stubEnv(key, "postgresql:" + "//postgres:synthetic@db.ocbugvgojrunvenozsbx.supabase.co/postgres");
  }
  mocks.read.mockResolvedValue({ transactionRef: "abc123abc123", refundPersistencePassed: false });
});
afterEach(() => vi.unstubAllEnvs());

describe("exact pending refund read-only proof", () => {
  it("returns private evidence for only the exact requested transaction", async () => {
    const response = await GET(request());
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(mocks.read).toHaveBeenCalledExactlyOnceWith(mocks.database, "synthetic-transaction", source);
  });
  it.each([
    { auth: false }, { sha: "b".repeat(40) }, { host: "production.example.test" },
    { query: "" }, { query: "transactionId=one&transactionId=two" }, { query: "transactionId=../other" },
  ])("rejects unsafe requests before querying any data: %j", async (options) => {
    const response = await GET(request(options));
    expect(response.status).toBe(options.auth === false ? 401 : 404);
    expect(mocks.read).not.toHaveBeenCalled();
  });
  it.each([["VERCEL_ENV", "production"], ["PAYUNI_ENV", "live"], ["WP4_SANDBOX_EXECUTOR_ENABLED", "false"]])(
    "rejects an unsafe runtime %s", async (name, value) => {
      vi.stubEnv(name, value);
      expect((await GET(request())).status).toBe(404);
      expect(mocks.read).not.toHaveBeenCalled();
    },
  );
  it.each(["VERCEL_PROJECT_ID", "DATABASE_URL", "DIRECT_URL", "STAGING_DATABASE_URL", "NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_APP_URL"])(
    "rejects missing fixed staging resource binding %s before accessing data", async (name) => {
      vi.stubEnv(name, "");
      expect((await GET(request())).status).toBe(404);
      expect(mocks.read).not.toHaveBeenCalled();
    },
  );
  it("conceals missing fixtures and raw database failures", async () => {
    mocks.read.mockResolvedValueOnce(null);
    expect((await GET(request())).status).toBe(404);
    mocks.read.mockRejectedValueOnce(new Error("raw database detail"));
    const response = await GET(request());
    expect(response.status).toBe(503);
    expect(await response.text()).not.toContain("raw database detail");
  });
});
