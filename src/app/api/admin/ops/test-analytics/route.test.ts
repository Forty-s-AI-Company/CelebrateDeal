import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  captureProductEvent: vi.fn(),
}));

vi.mock("@/lib/product-analytics", () => ({
  captureProductEvent: mocks.captureProductEvent,
}));

import { POST } from "./route";

const jobSecret = "test-fixture-job-secret";

function requestWithAuthorization(authorization?: string) {
  return new Request("https://app.example.test/api/admin/ops/test-analytics", {
    method: "POST",
    headers: authorization ? { authorization } : undefined,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("JOB_SECRET", jobSecret);
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("POST /api/admin/ops/test-analytics", () => {
  it.each([
    { name: "is not provided", authorization: undefined },
    { name: "is incorrect", authorization: "Bearer test-fixture-wrong-job-secret" },
  ])("returns 401 without capturing an event when the authorization $name", async ({ authorization }) => {
    const response = await POST(requestWithAuthorization(authorization));

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({ error: "Unauthorized" });
    expect(mocks.captureProductEvent).not.toHaveBeenCalled();
  });

  it("returns 401 without capturing an event when JOB_SECRET is not configured", async () => {
    vi.stubEnv("JOB_SECRET", undefined);

    const response = await POST(requestWithAuthorization(`Bearer ${jobSecret}`));

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({ error: "Unauthorized" });
    expect(mocks.captureProductEvent).not.toHaveBeenCalled();
  });

  it("returns ok and captures the admin analytics smoke-test event when authorized", async () => {
    const result = { skipped: false };
    mocks.captureProductEvent.mockResolvedValue(result);

    const response = await POST(requestWithAuthorization(`Bearer ${jobSecret}`));

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
