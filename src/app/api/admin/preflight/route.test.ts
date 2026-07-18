import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getDb: vi.fn(),
  getEnvCheckReport: vi.fn(),
  getRateLimitProviderStatus: vi.fn(),
  getCloudflareStreamDiagnostics: vi.fn(),
  queryRaw: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  getDb: mocks.getDb,
}));

vi.mock("@/lib/env", () => ({
  getEnvCheckReport: mocks.getEnvCheckReport,
}));

vi.mock("@/lib/rate-limit", () => ({
  getRateLimitProviderStatus: mocks.getRateLimitProviderStatus,
}));

vi.mock("@/lib/cloudflare-diagnostics", () => ({
  getCloudflareStreamDiagnostics: mocks.getCloudflareStreamDiagnostics,
}));

import { GET } from "./route";

const jobSecret = "test-fixture-job-secret";
const environment = {
  ok: true,
  checks: [{ key: "DATABASE_URL", status: "pass" as const, message: "Configured" }],
};
const rateLimit = {
  provider: "upstash_redis",
  durable: true,
  externalRequired: true,
  configured: true,
};
const cloudflare = {
  ok: true,
  accountId: { configured: true, length: 24 },
};

function requestWithAuthorization(authorization?: string) {
  return new Request("https://app.example.test/api/admin/preflight", {
    headers: authorization ? { authorization } : undefined,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("JOB_SECRET", jobSecret);
  mocks.getDb.mockReturnValue({ $queryRaw: mocks.queryRaw });
  mocks.queryRaw.mockResolvedValue([{ "?column?": 1 }]);
  mocks.getEnvCheckReport.mockReturnValue(environment);
  mocks.getRateLimitProviderStatus.mockReturnValue(rateLimit);
  mocks.getCloudflareStreamDiagnostics.mockReturnValue(cloudflare);
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("GET /api/admin/preflight", () => {
  it.each([
    { name: "is missing", authorization: undefined },
    { name: "is incorrect", authorization: "Bearer test-fixture-wrong-job-secret" },
  ])("returns 401 without running diagnostics when JOB_SECRET $name", async ({ authorization }) => {
    const response = await GET(requestWithAuthorization(authorization));

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({ error: "Unauthorized" });
    expect(mocks.getEnvCheckReport).not.toHaveBeenCalled();
    expect(mocks.getDb).not.toHaveBeenCalled();
    expect(mocks.queryRaw).not.toHaveBeenCalled();
    expect(mocks.getRateLimitProviderStatus).not.toHaveBeenCalled();
    expect(mocks.getCloudflareStreamDiagnostics).not.toHaveBeenCalled();
  });

  it("returns 401 without running diagnostics when JOB_SECRET is not configured", async () => {
    vi.stubEnv("JOB_SECRET", undefined);

    const response = await GET(requestWithAuthorization(`Bearer ${jobSecret}`));

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({ error: "Unauthorized" });
    expect(mocks.getEnvCheckReport).not.toHaveBeenCalled();
    expect(mocks.getDb).not.toHaveBeenCalled();
    expect(mocks.queryRaw).not.toHaveBeenCalled();
    expect(mocks.getRateLimitProviderStatus).not.toHaveBeenCalled();
    expect(mocks.getCloudflareStreamDiagnostics).not.toHaveBeenCalled();
  });

  it("returns the integrated diagnostics when JOB_SECRET is correct", async () => {
    const response = await GET(requestWithAuthorization(`Bearer ${jobSecret}`));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      ok: true,
      environment,
      database: { status: "pass", message: "Database reachable" },
      rateLimit,
      cloudflare,
    });
    expect(mocks.getEnvCheckReport).toHaveBeenCalledOnce();
    expect(mocks.getDb).toHaveBeenCalledOnce();
    expect(mocks.queryRaw).toHaveBeenCalledOnce();
    expect(mocks.getRateLimitProviderStatus).toHaveBeenCalledOnce();
    expect(mocks.getCloudflareStreamDiagnostics).toHaveBeenCalledOnce();
  });

  it("hides database errors and reports an unsuccessful preflight", async () => {
    mocks.queryRaw.mockRejectedValue(new Error("test-fixture-sensitive database failure"));

    const response = await GET(requestWithAuthorization(`Bearer ${jobSecret}`));

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toEqual({
      ok: false,
      environment,
      database: { status: "fail", message: "Database unreachable" },
      rateLimit,
      cloudflare,
    });
    expect(JSON.stringify(body)).not.toContain("test-fixture-sensitive database failure");
    expect(mocks.getRateLimitProviderStatus).toHaveBeenCalledOnce();
    expect(mocks.getCloudflareStreamDiagnostics).toHaveBeenCalledOnce();
  });
});
