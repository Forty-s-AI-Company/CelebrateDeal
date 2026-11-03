import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  captureProductEvent: vi.fn(),
}));

vi.mock("@/lib/product-analytics", () => ({
  captureProductEvent: mocks.captureProductEvent,
}));

import { POST } from "./route";

const smokeSecret = "test-fixture-ops-smoke-secret-0123456789abcdef";
const jobSecret = "test-fixture-job-secret-0123456789";

function requestWithAuthorization(authorization?: string) {
  return new Request("https://app.example.test/api/admin/ops/test-analytics", {
    method: "POST",
    headers: authorization ? { authorization } : undefined,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("OPS_SMOKE_SECRET", smokeSecret);
  vi.stubEnv("JOB_SECRET", jobSecret);
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("POST /api/admin/ops/test-analytics", () => {
  it.each([
    { name: "is not provided", authorization: undefined },
    { name: "is incorrect", authorization: "Bearer test-fixture-wrong-ops-smoke-secret" },
  ])("returns 401 without capturing an event when the authorization $name", async ({ authorization }) => {
    const response = await POST(requestWithAuthorization(authorization));

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({ error: "Unauthorized" });
    expect(mocks.captureProductEvent).not.toHaveBeenCalled();
  });

  it("returns 401 without capturing an event when OPS_SMOKE_SECRET is not configured", async () => {
    vi.stubEnv("OPS_SMOKE_SECRET", undefined);

    const response = await POST(requestWithAuthorization(`Bearer ${smokeSecret}`));

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({ error: "Unauthorized" });
    expect(mocks.captureProductEvent).not.toHaveBeenCalled();
  });

  it.each([
    { name: "the shared JOB_SECRET", configured: smokeSecret },
    { name: "JOB_SECRET while OPS_SMOKE_SECRET is unset", configured: undefined },
  ])("rejects $name without capturing an event", async ({ configured }) => {
    vi.stubEnv("OPS_SMOKE_SECRET", configured);

    const response = await POST(requestWithAuthorization(`Bearer ${jobSecret}`));

    expect(response.status).toBe(401);
    expect(mocks.captureProductEvent).not.toHaveBeenCalled();
  });

  it("returns ok and captures the admin analytics smoke-test event when authorized", async () => {
    const result = { skipped: false };
    mocks.captureProductEvent.mockResolvedValue(result);

    const response = await POST(requestWithAuthorization(`Bearer ${smokeSecret}`));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ ok: true, result });
    expect(mocks.captureProductEvent).toHaveBeenCalledOnce();
    expect(mocks.captureProductEvent).toHaveBeenCalledWith({
      distinctId: "ops-smoke-test",
      event: "production_smoke_test",
      properties: {
        source: "admin_ops",
        checkedAt: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/),
      },
    });
  });
});
