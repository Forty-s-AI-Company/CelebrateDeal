import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  processDueEmailDeliveries: vi.fn(),
  processDuePostLiveFollowups: vi.fn(),
  processLiveReminderReconciliationJobs: vi.fn(),
  processDueLiveNotifications: vi.fn(),
  processLegacyReminderCutovers: vi.fn(),
  materializeLineNotifications: vi.fn(),
  processDueLineDeliveries: vi.fn(),
  captureOperationalError: vi.fn(),
}));

vi.mock("@/lib/email-delivery", () => ({
  processDueEmailDeliveries: mocks.processDueEmailDeliveries,
  processDuePostLiveFollowups: mocks.processDuePostLiveFollowups,
}));
vi.mock("@/lib/live-reminder-reconciliation", () => ({
  processLiveReminderReconciliationJobs: mocks.processLiveReminderReconciliationJobs,
}));
vi.mock("@/lib/live-notification-delivery", () => ({
  processDueLiveNotifications: mocks.processDueLiveNotifications,
  processLegacyReminderCutovers: mocks.processLegacyReminderCutovers,
}));
vi.mock("@/lib/monitoring", () => ({ captureOperationalError: mocks.captureOperationalError }));
vi.mock("@/lib/line-notification-materializer", () => ({ materializeLineNotifications: mocks.materializeLineNotifications }));
vi.mock("@/lib/line-notification", () => ({ processDueLineDeliveries: mocks.processDueLineDeliveries }));

import { GET, POST } from "./route";

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("JOB_SECRET", "g7-07-job-secret");
  vi.stubEnv("CRON_SECRET", "g7-21-cron-secret");
  mocks.processLiveReminderReconciliationJobs.mockResolvedValue([]);
  mocks.processDuePostLiveFollowups.mockResolvedValue([]);
  mocks.processDueEmailDeliveries.mockResolvedValue([]);
  mocks.processDueLiveNotifications.mockResolvedValue([]);
  mocks.processLegacyReminderCutovers.mockResolvedValue([]);
  mocks.materializeLineNotifications.mockResolvedValue([]);
  mocks.processDueLineDeliveries.mockResolvedValue([]);
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
    expect(mocks.processDuePostLiveFollowups).not.toHaveBeenCalled();
    expect(mocks.processLiveReminderReconciliationJobs).not.toHaveBeenCalled();
    expect(mocks.processDueLiveNotifications).not.toHaveBeenCalled();
    expect(mocks.processLegacyReminderCutovers).not.toHaveBeenCalled();
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
    mocks.processDuePostLiveFollowups.mockResolvedValue([
      { deliveryId: "private-followup-1", status: "queued" },
      { deliveryId: "private-followup-2", status: "unexpected" },
    ]);
    mocks.processLegacyReminderCutovers.mockResolvedValue([
      { liveId: "private-live-1", status: "cutover" },
      { liveId: "private-live-2", status: "unexpected" },
    ]);
    mocks.processDueLiveNotifications
      .mockResolvedValueOnce([
        { deliveryId: "private-live-notification-1", status: "queued" },
        { deliveryId: "private-live-notification-2", status: "unexpected" },
      ])
      .mockResolvedValueOnce([{ deliveryId: "private-future-repair", status: "duplicate" }]);
    const response = await POST(request("g7-07-job-secret"));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({
      ok: true,
      cutovers: 2,
      cutoverResults: [{ status: "cutover" }, { status: "unknown" }],
      liveNotifications: 3,
      liveNotificationResults: [{ status: "queued" }, { status: "unknown" }, { status: "duplicate" }],
      followups: 2,
      followupResults: [{ status: "queued" }, { status: "unknown" }],
      reconciled: 2,
      reconciliationResults: [{ status: "completed" }, { status: "unknown" }],
      processed: 2,
      results: [{ status: "sent" }, { status: "unknown" }],
      lineMaterialized: 0,
      lineProcessed: 0,
      lineResults: [],
    });
    expect(JSON.stringify(body)).not.toContain("private-delivery");
    expect(JSON.stringify(body)).not.toContain("private-job");
    expect(JSON.stringify(body)).not.toContain("private-followup");
    expect(JSON.stringify(body)).not.toContain("private-live");
    expect(mocks.processLegacyReminderCutovers.mock.invocationCallOrder[0])
      .toBeLessThan(mocks.processDueLiveNotifications.mock.invocationCallOrder[0]);
    expect(mocks.processDueLiveNotifications.mock.invocationCallOrder[0])
      .toBeLessThan(mocks.processDuePostLiveFollowups.mock.invocationCallOrder[0]);
    expect(mocks.processDuePostLiveFollowups.mock.invocationCallOrder[0])
      .toBeLessThan(mocks.processLiveReminderReconciliationJobs.mock.invocationCallOrder[0]);
    expect(mocks.processLiveReminderReconciliationJobs.mock.invocationCallOrder[0])
      .toBeLessThan(mocks.processDueEmailDeliveries.mock.invocationCallOrder[0]);
    expect(mocks.processDueEmailDeliveries.mock.invocationCallOrder[0])
      .toBeLessThan(mocks.processDueLiveNotifications.mock.invocationCallOrder[1]);
    expect(mocks.processDueLiveNotifications).toHaveBeenNthCalledWith(1, { includeFuture: false, writeBudget: 100 });
    expect(mocks.processDueLiveNotifications).toHaveBeenNthCalledWith(2, { includeFuture: true, writeBudget: 100 });
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

  it("does not let bounded future repair failure block already due dispatch", async () => {
    mocks.processDueLiveNotifications
      .mockResolvedValueOnce([])
      .mockRejectedValueOnce(new Error("future-private-detail"));
    mocks.processDueEmailDeliveries.mockResolvedValue([{ deliveryId: "private-due", status: "sent" }]);
    const response = await POST(request("g7-07-job-secret"));
    expect(response.status).toBe(200);
    expect(mocks.processDueEmailDeliveries).toHaveBeenCalledOnce();
    expect(mocks.captureOperationalError).toHaveBeenCalledWith(expect.any(Error), {
      source: "email_delivery_job",
      operation: "future_repair",
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
