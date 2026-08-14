import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  processDueEmailDeliveries: vi.fn(),
  processLiveReminderReconciliationJobs: vi.fn(),
  captureOperationalError: vi.fn(),
}));

vi.mock("@/lib/email-delivery", () => ({ processDueEmailDeliveries: mocks.processDueEmailDeliveries }));
vi.mock("@/lib/live-reminder-reconciliation", () => ({
  processLiveReminderReconciliationJobs: mocks.processLiveReminderReconciliationJobs,
}));
vi.mock("@/lib/monitoring", () => ({ captureOperationalError: mocks.captureOperationalError }));

import { GET, POST } from "./route";

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("JOB_SECRET", "g7-07-job-secret");
  vi.stubEnv("CRON_SECRET", "g7-21-cron-secret");
  mocks.processLiveReminderReconciliationJobs.mockResolvedValue([]);
  mocks.processDueEmailDeliveries.mockResolvedValue([]);
});

afterEach(() => vi.unstubAllEnvs());

function request(secret?: string, method = "POST") {
  return new Request("https://app.example.test/api/jobs/email-deliveries", {
    method,
    headers: secret ? { authorization: `Bearer ${secret}` } : undefined,
  });
}

describe("POST /api/jobs/email-deliveries", () => {
  it("rejects missing or invalid job authentication", async () => {
    for (const secret of [undefined, "wrong-secret"]) {
      const response = await POST(request(secret));
      expect(response.status).toBe(401);
    }
    expect(mocks.processDueEmailDeliveries).not.toHaveBeenCalled();
    expect(mocks.processLiveReminderReconciliationJobs).not.toHaveBeenCalled();
  });

  it("returns only bounded status evidence without delivery identifiers", async () => {
    mocks.processDueEmailDeliveries.mockResolvedValue([
      { deliveryId: "private-delivery-1", status: "sent" },
      { deliveryId: "private-delivery-2", status: "unexpected" },
    ]);
    mocks.processLiveReminderReconciliationJobs.mockResolvedValue([
      { jobId: "private-job-1", status: "completed" },
      { jobId: "private-job-2", status: "unexpected" },
    ]);
    const response = await POST(request("g7-07-job-secret"));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({
      ok: true,
      reconciled: 2,
      reconciliationResults: [{ status: "completed" }, { status: "unknown" }],
      processed: 2,
      results: [{ status: "sent" }, { status: "unknown" }],
    });
    expect(JSON.stringify(body)).not.toContain("private-delivery");
    expect(JSON.stringify(body)).not.toContain("private-job");
    expect(mocks.processLiveReminderReconciliationJobs.mock.invocationCallOrder[0])
      .toBeLessThan(mocks.processDueEmailDeliveries.mock.invocationCallOrder[0]);
  });

  it("fails closed without leaking processing errors", async () => {
    const error = new Error("provider-secret-response");
    mocks.processDueEmailDeliveries.mockRejectedValue(error);
    const response = await POST(request("g7-07-job-secret"));
    const body = await response.json();

    expect(response.status).toBe(503);
    expect(body).toEqual({ ok: false, processed: 0, results: [] });
    expect(JSON.stringify(body)).not.toContain("provider-secret-response");
    expect(mocks.captureOperationalError).toHaveBeenCalledWith(error, {
      source: "email_delivery_job",
      operation: "process_due",
      status: "failed",
    });
  });
});

describe("GET /api/jobs/email-deliveries", () => {
  it("accepts only the dedicated Vercel cron bearer and processes the due queue", async () => {
    for (const secret of [undefined, "wrong-secret", "g7-07-job-secret"]) {
      const response = await GET(request(secret, "GET"));
      expect(response.status).toBe(401);
    }
    expect(mocks.processDueEmailDeliveries).not.toHaveBeenCalled();

    const response = await GET(request("g7-21-cron-secret", "GET"));
    expect(response.status).toBe(200);
    expect(mocks.processDueEmailDeliveries).toHaveBeenCalledExactlyOnceWith();
  });

  it("fails closed when CRON_SECRET is not configured", async () => {
    vi.stubEnv("CRON_SECRET", undefined);
    const response = await GET(request("g7-21-cron-secret", "GET"));

    expect(response.status).toBe(401);
    expect(mocks.processDueEmailDeliveries).not.toHaveBeenCalled();
  });
});
