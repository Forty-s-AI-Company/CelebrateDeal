import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  processDueWebhookRetries: vi.fn(),
}));

vi.mock("@/lib/webhook-retry", () => ({
  processDueWebhookRetries: mocks.processDueWebhookRetries,
}));

import { POST } from "./route";

const jobSecret = "test-fixture-job-secret";

function request(authorization?: string) {
  return new Request("https://app.example.test/api/jobs/webhook-retry", {
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

describe("POST /api/jobs/webhook-retry", () => {
  it.each([
    { name: "is missing", authorization: undefined },
    { name: "is incorrect", authorization: "Bearer test-fixture-wrong-job-secret" },
  ])("returns 401 and does not process retries when the job secret $name", async ({ authorization }) => {
    const response = await POST(request(authorization));

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({ error: "Unauthorized" });
    expect(mocks.processDueWebhookRetries).not.toHaveBeenCalled();
  });

  it("processes due retries and returns their count and results with a correct job secret", async () => {
    const results = [
      { eventId: "event-1", status: "processed" },
      { eventId: "event-2", status: "exhausted" },
    ];
    mocks.processDueWebhookRetries.mockResolvedValue(results);

    const response = await POST(request(`Bearer ${jobSecret}`));

    expect(mocks.processDueWebhookRetries).toHaveBeenCalledOnce();
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      ok: true,
      processed: 2,
      results,
    });
  });
});
