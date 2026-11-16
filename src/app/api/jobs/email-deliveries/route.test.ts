import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  processDueLearnerNotifications: vi.fn(),
  processDueEmailDeliveries: vi.fn(),
  processDuePostLiveFollowups: vi.fn(),
  processLiveReminderReconciliationJobs: vi.fn(),
  processDueLiveNotifications: vi.fn(),
  processLegacyReminderCutovers: vi.fn(),
  materializeLineNotifications: vi.fn(),
  processDueLineDeliveries: vi.fn(),
  captureOperationalError: vi.fn(),
  sweepExpiredRegistrationRetryDrafts: vi.fn(),
  releaseExpiredFixedSessionSeats: vi.fn(),
  queueFixedSessionCancellationNotices: vi.fn(),
  backfillEmailSequenceEnrollments: vi.fn(),
  processDueDelayedStepRuns: vi.fn(),
  processDueSequenceEmailDeliveries: vi.fn(),
  onConfigurationError: vi.fn(),
}));
vi.mock("@/lib/delayed-step-runs", () => ({
  backfillEmailSequenceEnrollments: mocks.backfillEmailSequenceEnrollments,
  processDueDelayedStepRuns: mocks.processDueDelayedStepRuns,
  EMAIL_SEQUENCE_START_CUTOFF_MS: 60_000,
  EMAIL_SEQUENCE_DEADLINE_MS: 100_000,
  onceConfigurationReporter: () => mocks.onConfigurationError,
}));
// F-4: the route runs the worker with the automation processor; the same mock
// stands for the worker round.
vi.mock("@/lib/automation-delayed-steps", () => ({ runDelayedStepWorker: mocks.processDueDelayedStepRuns }));
vi.mock("@/lib/live-fixed-sessions-store", () => ({ releaseExpiredFixedSessionSeats: mocks.releaseExpiredFixedSessionSeats }));
vi.mock("@/lib/live-fixed-session-notices", () => ({ queueFixedSessionCancellationNotices: mocks.queueFixedSessionCancellationNotices }));
vi.mock("@/lib/db", () => ({ getDb: () => ({}) }));
vi.mock("@/lib/registration-form-retry", () => ({ sweepExpiredRegistrationRetryDrafts: mocks.sweepExpiredRegistrationRetryDrafts }));

vi.mock("@/lib/learner-notification-job", () => ({ processDueLearnerNotifications: mocks.processDueLearnerNotifications }));
vi.mock("@/lib/email-delivery", () => ({
  processDueEmailDeliveries: mocks.processDueEmailDeliveries,
  processDuePostLiveFollowups: mocks.processDuePostLiveFollowups,
  processDueSequenceEmailDeliveries: mocks.processDueSequenceEmailDeliveries,
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
  mocks.processDueLearnerNotifications.mockResolvedValue({ results: [], backlog: null });
  vi.stubEnv("JOB_SECRET", "g7-07-job-secret");
  vi.stubEnv("CRON_SECRET", "g7-21-cron-secret");
  mocks.processLiveReminderReconciliationJobs.mockResolvedValue([]);
  mocks.processDuePostLiveFollowups.mockResolvedValue([]);
  mocks.processDueEmailDeliveries.mockResolvedValue([]);
  mocks.processDueLiveNotifications.mockResolvedValue([]);
  mocks.processLegacyReminderCutovers.mockResolvedValue([]);
  mocks.materializeLineNotifications.mockResolvedValue([]);
  mocks.processDueLineDeliveries.mockResolvedValue([]);
  mocks.sweepExpiredRegistrationRetryDrafts.mockResolvedValue(3);
  mocks.releaseExpiredFixedSessionSeats.mockResolvedValue(2);
  mocks.queueFixedSessionCancellationNotices.mockResolvedValue(["private-notice-1"]);
  mocks.backfillEmailSequenceEnrollments.mockResolvedValue([]);
  mocks.processDueDelayedStepRuns.mockResolvedValue([]);
  mocks.processDueSequenceEmailDeliveries.mockResolvedValue([]);
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
    expect(mocks.processDueLearnerNotifications).not.toHaveBeenCalled();
    expect(mocks.processDueEmailDeliveries).not.toHaveBeenCalled();
    expect(mocks.processDuePostLiveFollowups).not.toHaveBeenCalled();
    expect(mocks.processLiveReminderReconciliationJobs).not.toHaveBeenCalled();
    expect(mocks.processDueLiveNotifications).not.toHaveBeenCalled();
    expect(mocks.processLegacyReminderCutovers).not.toHaveBeenCalled();
  });

  it("reports reactivated, not_scheduled and not_configured follow-up and notification outcomes instead of unknown", async () => {
    mocks.processDuePostLiveFollowups.mockResolvedValue([
      { status: "reactivated" },
      { status: "not_scheduled" },
      { status: "not_configured" },
      { status: "already_sent" },
      { status: "unexpected" },
    ]);
    mocks.processDueLiveNotifications
      .mockResolvedValueOnce([{ status: "reactivated" }, { status: "unexpected" }])
      .mockResolvedValueOnce([]);
    const body = await (await POST(request("g7-07-job-secret"))).json();

    expect(body.followups).toBe(5);
    expect(body.followupResults).toEqual([
      { status: "reactivated" },
      { status: "not_scheduled" },
      { status: "not_configured" },
      { status: "already_sent" },
      { status: "unknown" },
    ]);
    expect(body.liveNotificationResults).toEqual([{ status: "reactivated" }, { status: "unknown" }]);
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
      sequenceSkipped: false,
      sequenceEnrollments: 0,
      sequenceSteps: 0,
      sequenceStepResults: [],
      sequenceDispatched: 0,
      sequenceDispatchResults: [],
      reconciled: 2,
      reconciliationResults: [{ status: "completed" }, { status: "unknown" }],
      processed: 2,
      results: [{ status: "sent" }, { status: "unknown" }],
      learnerNotificationsProcessed: 0,
      learnerNotificationResults: [],
      learnerNotificationBacklog: null,
      lineMaterialized: 0,
      lineProcessed: 0,
      lineResults: [],
      registrationRetryDraftsPurged: 3,
      fixedSessionSeatsReleased: 2,
      fixedSessionCancellationNotices: 1,
    });
    expect(JSON.stringify(body)).not.toContain("private-notice");
    // Seats and notices are handled before this round's dispatch sends anything.
    expect(mocks.releaseExpiredFixedSessionSeats.mock.invocationCallOrder[0])
      .toBeLessThan(mocks.processDueEmailDeliveries.mock.invocationCallOrder[0]!);
    expect(mocks.queueFixedSessionCancellationNotices.mock.invocationCallOrder[0])
      .toBeLessThan(mocks.processDueEmailDeliveries.mock.invocationCallOrder[0]!);
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

  it("does not let a failing first due-notification pass abort the rest of the round", async () => {
    mocks.processDueLiveNotifications
      .mockRejectedValueOnce(new Error("serialization-private-detail"))
      .mockResolvedValueOnce([]);
    mocks.processDueEmailDeliveries.mockResolvedValue([{ deliveryId: "private-due", status: "sent" }]);
    const response = await POST(request("g7-07-job-secret"));
    expect(response.status).toBe(200);
    expect(mocks.processDueEmailDeliveries).toHaveBeenCalledOnce();
    expect(mocks.captureOperationalError).toHaveBeenCalledWith(expect.any(Error), {
      source: "email_delivery_job",
      operation: "due_live_notifications",
      status: "failed",
    });
    expect(JSON.stringify(await response.json())).not.toContain("serialization-private-detail");
  });

  it("does not let a failing post-live follow-up pass abort the rest of the round", async () => {
    mocks.processDuePostLiveFollowups.mockRejectedValueOnce(new Error("followup-private-detail"));
    mocks.processDueEmailDeliveries.mockResolvedValue([{ deliveryId: "private-due", status: "sent" }]);
    const response = await POST(request("g7-07-job-secret"));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toMatchObject({ ok: true, followups: 0, followupResults: [], processed: 1, results: [{ status: "sent" }] });
    expect(mocks.processDueEmailDeliveries).toHaveBeenCalledOnce();
    expect(mocks.processDueLineDeliveries).toHaveBeenCalledOnce();
    expect(mocks.processDueLearnerNotifications).toHaveBeenCalledOnce();
    expect(mocks.captureOperationalError).toHaveBeenCalledWith(expect.any(Error), {
      source: "email_delivery_job",
      operation: "post_live_followups",
      status: "failed",
    });
    expect(JSON.stringify(body)).not.toContain("followup-private-detail");
  });
});

describe("F-3 email sequence work in the job", () => {
  afterEach(() => vi.useRealTimers());

  it("runs backfill, worker and sequence dispatch last, after every other pass, with one deadline, and reports bounded statuses", async () => {
    mocks.backfillEmailSequenceEnrollments.mockResolvedValue([{ status: "enrolled" }, { status: "duplicate" }, { status: "enrolled" }]);
    mocks.processDueDelayedStepRuns.mockResolvedValue([
      { runId: "private-run-1", status: "queued" },
      { runId: "private-run-2", status: "waiting_previous" },
      { runId: "private-run-3", status: "unexpected" },
    ]);
    mocks.processDueSequenceEmailDeliveries.mockResolvedValue([{ deliveryId: "private-seq-1", status: "sent" }, { deliveryId: "private-seq-2", status: "weird" }]);
    const before = Date.now();
    const response = await POST(request("g7-07-job-secret"));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      sequenceSkipped: false,
      sequenceEnrollments: 2,
      sequenceSteps: 3,
      sequenceStepResults: [{ status: "queued" }, { status: "waiting_previous" }, { status: "unknown" }],
      sequenceDispatched: 2,
      sequenceDispatchResults: [{ status: "sent" }, { status: "unknown" }],
    });
    expect(JSON.stringify(body)).not.toContain("private-");
    const order = (mock: { mock: { invocationCallOrder: number[] } }) => mock.mock.invocationCallOrder[0]!;
    // Every other pass of the round comes first.
    const lastOther = Math.max(...[
      mocks.processDueEmailDeliveries, mocks.processDueLineDeliveries, mocks.processDueLearnerNotifications,
      mocks.sweepExpiredRegistrationRetryDrafts, mocks.processLiveReminderReconciliationJobs,
    ].map(order), mocks.processDueLiveNotifications.mock.invocationCallOrder[1]!);
    expect(order(mocks.backfillEmailSequenceEnrollments)).toBeGreaterThan(lastOther);
    expect(order(mocks.processDueDelayedStepRuns)).toBeGreaterThan(order(mocks.backfillEmailSequenceEnrollments));
    expect(order(mocks.processDueSequenceEmailDeliveries)).toBeGreaterThan(order(mocks.processDueDelayedStepRuns));
    // One deadline, 100 s after the round started (inside the runner's 120 s), and one configuration reporter.
    const deadline = (mocks.processDueDelayedStepRuns.mock.calls[0]![0] as { deadline: number }).deadline;
    expect(deadline).toBeGreaterThanOrEqual(before + 100_000);
    expect(deadline).toBeLessThanOrEqual(Date.now() + 100_000);
    expect(mocks.processDueDelayedStepRuns).toHaveBeenCalledWith({ deadline, onConfigurationError: mocks.onConfigurationError });
    expect(mocks.backfillEmailSequenceEnrollments).toHaveBeenCalledWith({ deadline, onConfigurationError: mocks.onConfigurationError });
    expect(mocks.processDueSequenceEmailDeliveries).toHaveBeenCalledWith({ deadline });
  });

  it("skips the sequence work, and says so to monitoring, when the round already ran past 60 seconds", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    const start = new Date("2026-11-13T00:00:00.000Z").getTime();
    vi.setSystemTime(start);
    mocks.sweepExpiredRegistrationRetryDrafts.mockImplementationOnce(async () => {
      vi.setSystemTime(start + 61_000);
      return 0;
    });
    const body = await (await POST(request("g7-07-job-secret"))).json();
    expect(body).toMatchObject({ ok: true, sequenceSkipped: true, sequenceSteps: 0, sequenceDispatched: 0 });
    expect(mocks.backfillEmailSequenceEnrollments).not.toHaveBeenCalled();
    expect(mocks.processDueDelayedStepRuns).not.toHaveBeenCalled();
    expect(mocks.processDueSequenceEmailDeliveries).not.toHaveBeenCalled();
    expect(mocks.processDueEmailDeliveries).toHaveBeenCalledOnce();
    expect(mocks.captureOperationalError).toHaveBeenCalledWith(expect.any(Error), {
      source: "email_delivery_job",
      operation: "email_sequences_skipped",
      status: "skipped",
    });
  });

  it("still runs the sequence work at exactly the 60-second cutoff", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    const start = new Date("2026-11-13T00:00:00.000Z").getTime();
    vi.setSystemTime(start);
    mocks.sweepExpiredRegistrationRetryDrafts.mockImplementationOnce(async () => {
      vi.setSystemTime(start + 60_000);
      return 0;
    });
    const body = await (await POST(request("g7-07-job-secret"))).json();
    expect(body.sequenceSkipped).toBe(false);
    expect(mocks.processDueDelayedStepRuns).toHaveBeenCalledWith(expect.objectContaining({ deadline: start + 100_000 }));
  });

  it("keeps the response and the other passes when any sequence part fails", async () => {
    mocks.backfillEmailSequenceEnrollments.mockRejectedValueOnce(new Error("backfill-private-detail"));
    mocks.processDueDelayedStepRuns.mockRejectedValueOnce(new Error("sequence-private-detail"));
    mocks.processDueSequenceEmailDeliveries.mockRejectedValueOnce(new Error("dispatch-private-detail"));
    mocks.processDueEmailDeliveries.mockResolvedValue([{ deliveryId: "private-due", status: "sent" }]);
    const response = await POST(request("g7-07-job-secret"));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toMatchObject({ ok: true, sequenceEnrollments: 0, sequenceSteps: 0, sequenceDispatched: 0, processed: 1, results: [{ status: "sent" }] });
    expect(mocks.processDueLineDeliveries).toHaveBeenCalledOnce();
    expect(mocks.processDueLearnerNotifications).toHaveBeenCalledOnce();
    for (const operation of ["email_sequence_backfill", "delayed_step_runs", "sequence_email_dispatch"]) {
      expect(mocks.captureOperationalError).toHaveBeenCalledWith(expect.any(Error), { source: "email_delivery_job", operation, status: "failed" });
    }
    expect(JSON.stringify(body)).not.toContain("private-detail");
  });

  it("runs the worker and dispatch after a failed backfill in the same round", async () => {
    mocks.backfillEmailSequenceEnrollments.mockRejectedValueOnce(new Error("backfill outage"));
    mocks.processDueDelayedStepRuns.mockResolvedValue([{ runId: "run", status: "queued" }]);
    const body = await (await POST(request("g7-07-job-secret"))).json();
    expect(body.sequenceStepResults).toEqual([{ status: "queued" }]);
    expect(mocks.processDueSequenceEmailDeliveries).toHaveBeenCalledOnce();
  });
});

describe("GET /api/jobs/email-deliveries", () => {
  it("accepts only the dedicated Vercel cron bearer and processes the due queue", async () => {
    for (const secret of [undefined, "wrong-secret", "g7-07-job-secret"]) {
      const response = await GET(request(secret, "GET"));
      expect(response.status).toBe(401);
    }
    expect(mocks.processDueLearnerNotifications).not.toHaveBeenCalled();
    expect(mocks.processDueEmailDeliveries).not.toHaveBeenCalled();

    const response = await GET(request("g7-21-cron-secret", "GET"));
    expect(response.status).toBe(200);
    expect(mocks.processDueEmailDeliveries).toHaveBeenCalledExactlyOnceWith();
  });

  it("fails closed when CRON_SECRET is not configured", async () => {
    vi.stubEnv("CRON_SECRET", undefined);
    const response = await GET(request("g7-21-cron-secret", "GET"));

    expect(response.status).toBe(401);
    expect(mocks.processDueLearnerNotifications).not.toHaveBeenCalled();
    expect(mocks.processDueEmailDeliveries).not.toHaveBeenCalled();
  });
});

it("notification result projection strips identifiers and bounds the output", async () => {
 mocks.processDueLearnerNotifications.mockResolvedValue({results:Array.from({length:25},()=>({status:"indeterminate",recipient:"synthetic-private-recipient",claimToken:"synthetic-private-token"})),backlog:{sources:3,proofs:-1,deliveries:"private" as unknown as number}});
 const response=await POST(request("g7-07-job-secret"));const body=await response.json();
 expect(body.learnerNotificationsProcessed).toBe(25);expect(body.learnerNotificationResults).toHaveLength(20);
 expect(body.learnerNotificationResults.every((result:unknown)=>JSON.stringify(result)==='{"status":"indeterminate"}')).toBe(true);
 expect(JSON.stringify(body)).not.toContain("synthetic-private");
 expect(body.learnerNotificationBacklog).toEqual({sources:3,proofs:null,deliveries:null});
});

it("keeps the job successful and reports no count when the retry-draft purge fails", async () => {
  mocks.sweepExpiredRegistrationRetryDrafts.mockRejectedValueOnce(new Error("synthetic purge outage"));
  const response = await POST(request("g7-07-job-secret"));
  const body = await response.json();
  expect(response.status).toBe(200);
  expect(body.registrationRetryDraftsPurged).toBeNull();
  expect(mocks.captureOperationalError).toHaveBeenCalledWith(expect.any(Error), { source: "email_delivery_job", operation: "registration_retry_purge", status: "failed" });
});
