import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  captureOperationalError: vi.fn(),
  processDueWebhookRetries: vi.fn(),
  releaseExpiredInventoryReservations: vi.fn(),
}));

vi.mock("@/lib/webhook-retry", () => ({
  processDueWebhookRetries: mocks.processDueWebhookRetries,
}));
vi.mock("@/lib/inventory-reservations", () => ({
  releaseExpiredInventoryReservations: mocks.releaseExpiredInventoryReservations,
}));
vi.mock("@/lib/monitoring", () => ({
  captureOperationalError: mocks.captureOperationalError,
}));

import { GET, POST } from "./route";

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
  mocks.releaseExpiredInventoryReservations.mockResolvedValue({ examined: 0, released: 0, committed: 0 });
  mocks.processDueWebhookRetries.mockResolvedValue([]);
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
    expect(mocks.releaseExpiredInventoryReservations).not.toHaveBeenCalled();
    expect(mocks.captureOperationalError).not.toHaveBeenCalled();
  });

  it("processes due retries and returns their count and results with a correct job secret", async () => {
    const results = [
      { eventId: "event-1", status: "processed" },
      { eventId: "event-2", status: "exhausted" },
    ];
    mocks.processDueWebhookRetries.mockResolvedValue(results);

    const response = await POST(request(`Bearer ${jobSecret}`));

    expect(mocks.processDueWebhookRetries).toHaveBeenCalledOnce();
    expect(mocks.releaseExpiredInventoryReservations).toHaveBeenCalledOnce();
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      ok: true,
      inventory: { examined: 0, released: 0, committed: 0 },
      processed: 2,
      exhausted: 1,
      inventoryUnavailable: 0,
      results,
    });
  });

  it("attempts webhook recovery and fails closed when inventory cleanup fails", async () => {
    const rawError = new Error("inventory test-fixture-secret must not leak");
    const results = [{ eventId: "webhook-event-private-id", status: "processed" }];
    mocks.releaseExpiredInventoryReservations.mockRejectedValueOnce(rawError);
    mocks.processDueWebhookRetries.mockResolvedValueOnce(results);

    const response = await POST(request(`Bearer ${jobSecret}`));
    const body = await response.json();

    expect(mocks.releaseExpiredInventoryReservations).toHaveBeenCalledOnce();
    expect(mocks.processDueWebhookRetries).toHaveBeenCalledOnce();
    expect(mocks.captureOperationalError).toHaveBeenCalledWith(rawError, {
      source: "webhook_retry_job",
      operation: "inventory_cleanup",
      status: "failed",
    });
    expect(response.status).toBe(503);
    expect(body).toEqual({
      ok: false,
      inventory: null,
      processed: 1,
      exhausted: 0,
      inventoryUnavailable: 0,
      results: [{ status: "processed" }],
      failures: ["inventory_cleanup"],
    });
    expect(JSON.stringify(body)).not.toContain("test-fixture-secret");
    expect(JSON.stringify(body)).not.toContain("webhook-event-private-id");
  });

  it("keeps inventory evidence but returns a safe 503 when webhook recovery fails", async () => {
    const inventory = { examined: 3, released: 2, committed: 1 };
    const rawError = new Error("webhook test-fixture-secret must not leak");
    mocks.releaseExpiredInventoryReservations.mockResolvedValueOnce(inventory);
    mocks.processDueWebhookRetries.mockRejectedValueOnce(rawError);

    const response = await POST(request(`Bearer ${jobSecret}`));
    const body = await response.json();

    expect(mocks.releaseExpiredInventoryReservations).toHaveBeenCalledOnce();
    expect(mocks.processDueWebhookRetries).toHaveBeenCalledOnce();
    expect(mocks.captureOperationalError).toHaveBeenCalledWith(rawError, {
      source: "webhook_retry_job",
      operation: "webhook_retry",
      status: "failed",
    });
    expect(response.status).toBe(503);
    expect(body).toEqual({
      ok: false,
      inventory,
      processed: 0,
      exhausted: 0,
      inventoryUnavailable: 0,
      results: [],
      failures: ["webhook_retry"],
    });
    expect(JSON.stringify(body)).not.toContain("test-fixture-secret");
  });

  it("attempts both jobs and reports fixed identifiers when both fail", async () => {
    const inventoryError = new Error("inventory test-fixture-secret must not leak");
    const webhookError = new Error("webhook test-fixture-secret must not leak");
    mocks.releaseExpiredInventoryReservations.mockRejectedValueOnce(inventoryError);
    mocks.processDueWebhookRetries.mockRejectedValueOnce(webhookError);

    const response = await POST(request(`Bearer ${jobSecret}`));

    expect(mocks.releaseExpiredInventoryReservations).toHaveBeenCalledBefore(mocks.processDueWebhookRetries);
    expect(mocks.processDueWebhookRetries).toHaveBeenCalledOnce();
    expect(mocks.captureOperationalError).toHaveBeenNthCalledWith(1, inventoryError, {
      source: "webhook_retry_job",
      operation: "inventory_cleanup",
      status: "failed",
    });
    expect(mocks.captureOperationalError).toHaveBeenNthCalledWith(2, webhookError, {
      source: "webhook_retry_job",
      operation: "webhook_retry",
      status: "failed",
    });
    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({
      ok: false,
      inventory: null,
      processed: 0,
      exhausted: 0,
      inventoryUnavailable: 0,
      results: [],
      failures: ["inventory_cleanup", "webhook_retry"],
    });
  });

  it("continues with webhook recovery when monitoring an inventory failure also fails", async () => {
    mocks.releaseExpiredInventoryReservations.mockRejectedValueOnce(new Error("inventory failure"));
    mocks.captureOperationalError.mockImplementationOnce(() => {
      throw new Error("monitoring failure");
    });
    mocks.processDueWebhookRetries.mockResolvedValueOnce([{ eventId: "event-1", status: "unexpected-status" }]);

    const response = await POST(request(`Bearer ${jobSecret}`));

    expect(mocks.processDueWebhookRetries).toHaveBeenCalledOnce();
    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({
      ok: false,
      inventory: null,
      processed: 1,
      exhausted: 0,
      inventoryUnavailable: 0,
      results: [{ status: "unknown" }],
      failures: ["inventory_cleanup"],
    });
  });
});

describe("GET /api/jobs/webhook-retry (Vercel Cron entry)", () => {
  const cronSecret = "test-fixture-webhook-retry-cron-secret";

  function cronRequest(authorization?: string) {
    return new Request("https://app.example.test/api/jobs/webhook-retry", {
      headers: authorization ? { authorization } : undefined,
    });
  }

  beforeEach(() => vi.stubEnv("CRON_SECRET", cronSecret));

  it("accepts only CRON_SECRET and never the job runner secret", async () => {
    for (const authorization of [undefined, `Bearer ${jobSecret}`, "Bearer test-fixture-wrong-cron-secret"]) {
      expect((await GET(cronRequest(authorization))).status).toBe(401);
    }
    expect((await POST(request(`Bearer ${cronSecret}`))).status).toBe(401);
    expect(mocks.processDueWebhookRetries).not.toHaveBeenCalled();
    expect(mocks.releaseExpiredInventoryReservations).not.toHaveBeenCalled();
  });

  it("runs inventory release before webhook retries, exactly like POST", async () => {
    const response = await GET(cronRequest(`Bearer ${cronSecret}`));
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ ok: true, processed: 0 });
    expect(mocks.releaseExpiredInventoryReservations).toHaveBeenCalledBefore(mocks.processDueWebhookRetries);
  });

  it("reports exhausted and sold-out inventory counts for the scheduler", async () => {
    mocks.processDueWebhookRetries.mockResolvedValueOnce([
      { eventId: "event-a", status: "exhausted", inventoryUnavailable: true },
      { eventId: "event-b", status: "failed", inventoryUnavailable: true },
      { eventId: "event-c", status: "processed", inventoryUnavailable: false },
    ]);
    const response = await GET(cronRequest(`Bearer ${cronSecret}`));
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ ok: true, processed: 3, exhausted: 1, inventoryUnavailable: 2 });
  });

  it("keeps the sanitized partial-failure contract", async () => {
    mocks.releaseExpiredInventoryReservations.mockRejectedValueOnce(new Error("private inventory detail"));
    const response = await GET(cronRequest(`Bearer ${cronSecret}`));
    const body = await response.json();
    expect(response.status).toBe(503);
    expect(body).toMatchObject({ ok: false, failures: ["inventory_cleanup"] });
    expect(JSON.stringify(body)).not.toContain("private inventory detail");
    expect(mocks.processDueWebhookRetries).toHaveBeenCalledOnce();
  });
});
