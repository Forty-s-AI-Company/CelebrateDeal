import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  captureOperationalError: vi.fn(),
  processDueWebhookRetries: vi.fn(),
  releaseExpiredInventoryReservations: vi.fn(),
  runPaymentPaidAutomationCatchup: vi.fn(),
}));

vi.mock("@/lib/webhook-retry", () => ({
  processDueWebhookRetries: mocks.processDueWebhookRetries,
}));
vi.mock("@/lib/inventory-reservations", () => ({
  releaseExpiredInventoryReservations: mocks.releaseExpiredInventoryReservations,
}));
vi.mock("@/lib/payment-paid-automation-catchup", async (original) => ({
  // The time-budget arithmetic is the real one.
  paymentPaidCatchupDeadline: (await original<typeof import("@/lib/payment-paid-automation-catchup")>()).paymentPaidCatchupDeadline,
  runPaymentPaidAutomationCatchup: mocks.runPaymentPaidAutomationCatchup,
}));
vi.mock("@/lib/monitoring", () => ({
  captureOperationalError: mocks.captureOperationalError,
}));

import { GET, POST } from "./route";

const jobSecret = "test-fixture-job-secret";
const CATCHUP = { candidates: 0, examined: 0, completed: 0, skipped: 0, failed: 0, duplicate: 0, notApplicable: 0, errors: 0 };

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
  mocks.runPaymentPaidAutomationCatchup.mockResolvedValue(CATCHUP);
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
    expect(mocks.runPaymentPaidAutomationCatchup).not.toHaveBeenCalled();
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
      paymentPaidCatchup: CATCHUP,
    });
    expect(mocks.runPaymentPaidAutomationCatchup).toHaveBeenCalledOnce();
    expect(mocks.processDueWebhookRetries).toHaveBeenCalledBefore(mocks.runPaymentPaidAutomationCatchup);
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
      paymentPaidCatchup: CATCHUP,
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
      paymentPaidCatchup: CATCHUP,
      failures: ["webhook_retry"],
    });
    // The catch-up still runs when webhook recovery failed.
    expect(mocks.runPaymentPaidAutomationCatchup).toHaveBeenCalledOnce();
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
      paymentPaidCatchup: CATCHUP,
      failures: ["inventory_cleanup", "webhook_retry"],
    });
  });

  it("runs the payment_paid catch-up last; when it throws, monitoring gets it and the job still answers 200 with { failed: true }", async () => {
    const rawError = new Error("catch-up test-fixture-secret order-private-id must not leak");
    const results = [{ eventId: "event-1", status: "processed" }];
    mocks.processDueWebhookRetries.mockResolvedValueOnce(results);
    mocks.runPaymentPaidAutomationCatchup.mockRejectedValueOnce(rawError);

    const response = await POST(request(`Bearer ${jobSecret}`));
    const body = await response.json();

    expect(mocks.releaseExpiredInventoryReservations).toHaveBeenCalledBefore(mocks.processDueWebhookRetries);
    expect(mocks.processDueWebhookRetries).toHaveBeenCalledBefore(mocks.runPaymentPaidAutomationCatchup);
    expect(mocks.captureOperationalError).toHaveBeenCalledWith(rawError, {
      source: "webhook_retry_job",
      operation: "payment_paid_catchup",
      status: "failed",
    });
    expect(response.status).toBe(200);
    expect(body).toEqual({
      ok: true,
      inventory: { examined: 0, released: 0, committed: 0 },
      processed: 1,
      exhausted: 0,
      inventoryUnavailable: 0,
      results,
      paymentPaidCatchup: { failed: true },
    });
    expect(JSON.stringify(body)).not.toContain("test-fixture-secret");
    expect(JSON.stringify(body)).not.toContain("order-private-id");
  });

  it("a catch-up failure next to a webhook failure: still 503 for the webhook step only", async () => {
    mocks.processDueWebhookRetries.mockRejectedValueOnce(new Error("webhook outage"));
    mocks.runPaymentPaidAutomationCatchup.mockRejectedValueOnce(new Error("catch-up outage"));
    const response = await POST(request(`Bearer ${jobSecret}`));
    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({ ok: false, failures: ["webhook_retry"], paymentPaidCatchup: { failed: true } });
  });

  describe("time budget (scheduler waits 120 s)", () => {
    afterEach(() => vi.restoreAllMocks());

    /** The route reads Date.now() at its start and before the catch-up; the steps above "take" `elapsedMs`. */
    function elapse(elapsedMs: number) {
      let now = 1_000_000;
      vi.spyOn(Date, "now").mockImplementation(() => now);
      mocks.processDueWebhookRetries.mockImplementationOnce(async () => {
        now += elapsedMs;
        return [];
      });
    }

    it("gives the catch-up its full 60 s when the route is quick", async () => {
      elapse(5_000);
      await POST(request(`Bearer ${jobSecret}`));
      expect(mocks.runPaymentPaidAutomationCatchup).toHaveBeenCalledWith({ deadlineMs: 60_000 });
    });

    it("only what is left of 100 s once the route has run more than 40 s", async () => {
      elapse(55_000);
      await POST(request(`Bearer ${jobSecret}`));
      expect(mocks.runPaymentPaidAutomationCatchup).toHaveBeenCalledWith({ deadlineMs: 45_000 });
    });

    it("skips the catch-up once the route has run 60 s", async () => {
      elapse(60_000);
      const response = await POST(request(`Bearer ${jobSecret}`));
      expect(mocks.runPaymentPaidAutomationCatchup).not.toHaveBeenCalled();
      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toMatchObject({ ok: true, paymentPaidCatchup: { skipped: true } });
    });
  });

  it("returns the catch-up counts (no ids) next to the webhook results", async () => {
    const summary = { candidates: 3, examined: 2, completed: 2, skipped: 1, failed: 0, duplicate: 1, notApplicable: 0, errors: 0 };
    mocks.runPaymentPaidAutomationCatchup.mockResolvedValueOnce(summary);
    const response = await POST(request(`Bearer ${jobSecret}`));
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ ok: true, paymentPaidCatchup: summary });
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
      paymentPaidCatchup: CATCHUP,
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
    expect(mocks.runPaymentPaidAutomationCatchup).not.toHaveBeenCalled();
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
