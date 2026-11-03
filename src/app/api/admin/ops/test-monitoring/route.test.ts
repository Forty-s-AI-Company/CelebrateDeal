import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  captureSyntheticMonitoringError: vi.fn(),
}));

vi.mock("@/lib/monitoring", () => ({
  captureSyntheticMonitoringError: mocks.captureSyntheticMonitoringError,
}));

import { POST } from "./route";

const smokeSecret = "test-fixture-ops-smoke-secret-0123456789abcdef";
const jobSecret = "test-fixture-job-secret-0123456789";

function requestWithAuthorization(authorization?: string) {
  return new Request("https://app.example.test/api/admin/ops/test-monitoring", {
    method: "POST",
    headers: authorization ? { authorization } : undefined,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("OPS_SMOKE_SECRET", smokeSecret);
  vi.stubEnv("JOB_SECRET", jobSecret);
  mocks.captureSyntheticMonitoringError.mockResolvedValue({ captured: true, flushed: true });
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("POST /api/admin/ops/test-monitoring", () => {
  it.each([
    { name: "is missing", authorization: undefined },
    { name: "is incorrect", authorization: "Bearer test-fixture-wrong-ops-smoke-secret" },
  ])("returns 401 without capturing an operational error when OPS_SMOKE_SECRET $name", async ({ authorization }) => {
    const response = await POST(requestWithAuthorization(authorization));

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({ error: "Unauthorized" });
    expect(mocks.captureSyntheticMonitoringError).not.toHaveBeenCalled();
  });

  it.each([
    { name: "the shared JOB_SECRET", configured: smokeSecret },
    { name: "JOB_SECRET while OPS_SMOKE_SECRET is unset", configured: undefined },
  ])("rejects $name without capturing an operational error", async ({ configured }) => {
    vi.stubEnv("OPS_SMOKE_SECRET", configured);

    const response = await POST(requestWithAuthorization(`Bearer ${jobSecret}`));

    expect(response.status).toBe(401);
    expect(mocks.captureSyntheticMonitoringError).not.toHaveBeenCalled();
  });

  it("returns 401 without capturing an operational error when OPS_SMOKE_SECRET is not configured", async () => {
    vi.stubEnv("OPS_SMOKE_SECRET", undefined);

    const response = await POST(requestWithAuthorization(`Bearer ${smokeSecret}`));

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({ error: "Unauthorized" });
    expect(mocks.captureSyntheticMonitoringError).not.toHaveBeenCalled();
  });

  it("returns ok and records an operational error with admin_ops source and an ISO checkedAt timestamp", async () => {
    const response = await POST(requestWithAuthorization(`Bearer ${smokeSecret}`));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ ok: true });
    expect(mocks.captureSyntheticMonitoringError).toHaveBeenCalledExactlyOnceWith({
      source: "admin_ops",
      checkedAt: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/),
    });
  });

  it("fails closed when monitoring is not configured", async () => {
    mocks.captureSyntheticMonitoringError.mockResolvedValue({ captured: false, flushed: false });

    const response = await POST(requestWithAuthorization(`Bearer ${smokeSecret}`));

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({
      ok: false,
      error: "Monitoring provider is not configured",
    });
  });

  it("fails closed when Sentry does not flush before the request ends", async () => {
    mocks.captureSyntheticMonitoringError.mockResolvedValue({ captured: true, flushed: false });

    const response = await POST(requestWithAuthorization(`Bearer ${smokeSecret}`));

    expect(response.status).toBe(502);
    await expect(response.json()).resolves.toEqual({
      ok: false,
      error: "Monitoring provider flush failed",
    });
  });
});
