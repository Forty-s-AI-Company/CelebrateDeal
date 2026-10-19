import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  captureOperationalError: vi.fn(),
  runBillingCycleJob: vi.fn(),
}));

vi.mock("@/lib/monitoring", () => ({ captureOperationalError: mocks.captureOperationalError }));
vi.mock("@/lib/billing-cycle-job", () => ({ runBillingCycleJob: mocks.runBillingCycleJob }));

import { GET, POST } from "./route";

const jobSecret = "test-fixture-job-secret";

function request(authorization?: string) {
  return new Request("https://app.example.test/api/jobs/billing-cycle", {
    method: "POST",
    headers: authorization ? { authorization } : undefined,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("JOB_SECRET", jobSecret);
  mocks.runBillingCycleJob.mockResolvedValue({
    monthKey: "2026-07",
    processed: 2,
    skippedNotDue: 1,
    locked: 0,
    conflicts: 0,
    terminalInvoiceConflicts: 0,
    streamReconciliationRequired: 0,
    missingSubscription: 0,
    failed: 0,
    overdueMarked: 1,
    automaticCharges: 0,
  });
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("POST /api/jobs/billing-cycle", () => {
  it.each([
    { name: "is missing", authorization: undefined },
    { name: "is incorrect", authorization: "Bearer test-fixture-wrong-job-secret" },
  ])("returns 401 and does not generate invoices when the job secret $name", async ({ authorization }) => {
    const response = await POST(request(authorization));

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({ error: "Unauthorized" });
    expect(mocks.runBillingCycleJob).not.toHaveBeenCalled();
  });

  it("returns sanitized cycle counts with a correct job secret", async () => {
    const response = await POST(request(`Bearer ${jobSecret}`));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      ok: true,
      monthKey: "2026-07",
      processed: 2,
      skippedNotDue: 1,
      locked: 0,
      conflicts: 0,
      terminalInvoiceConflicts: 0,
      streamReconciliationRequired: 0,
      missingSubscription: 0,
      failed: 0,
      overdueMarked: 1,
      automaticCharges: 0,
    });
    expect(mocks.runBillingCycleJob).toHaveBeenCalledOnce();
  });

  it("fails closed without leaking a job error", async () => {
    const rawError = new Error("provider secret and database details must not leak");
    mocks.runBillingCycleJob.mockRejectedValueOnce(rawError);

    const response = await POST(request(`Bearer ${jobSecret}`));
    const body = await response.json();

    expect(response.status).toBe(503);
    expect(body).toEqual({ ok: false, error: "billing_cycle_failed" });
    expect(mocks.captureOperationalError).toHaveBeenCalledWith(rawError, {
      source: "billing_cycle_job",
      operation: "run",
      status: "failed",
    });
    expect(JSON.stringify(body)).not.toContain("provider secret");
  });
});

describe("GET /api/jobs/billing-cycle (Vercel Cron entry)", () => {
  const cronSecret = "test-fixture-billing-cron-secret";

  function cronRequest(authorization?: string) {
    return new Request("https://app.example.test/api/jobs/billing-cycle", {
      headers: authorization ? { authorization } : undefined,
    });
  }

  beforeEach(() => vi.stubEnv("CRON_SECRET", cronSecret));

  it("accepts only CRON_SECRET and never the job runner secret", async () => {
    for (const authorization of [undefined, `Bearer ${jobSecret}`, "Bearer test-fixture-wrong-cron-secret"]) {
      expect((await GET(cronRequest(authorization))).status).toBe(401);
    }
    expect(mocks.runBillingCycleJob).not.toHaveBeenCalled();
  });

  it("rejects CRON_SECRET on the POST job runner entry", async () => {
    expect((await POST(request(`Bearer ${cronSecret}`))).status).toBe(401);
    expect(mocks.runBillingCycleJob).not.toHaveBeenCalled();
  });

  it("runs the same billing cycle handler and contract as POST", async () => {
    const response = await GET(cronRequest(`Bearer ${cronSecret}`));
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ ok: true, monthKey: "2026-07", automaticCharges: 0 });
    expect(mocks.runBillingCycleJob).toHaveBeenCalledOnce();
  });

  it("fails closed when CRON_SECRET is not configured", async () => {
    vi.stubEnv("CRON_SECRET", undefined);
    expect((await GET(cronRequest(`Bearer ${cronSecret}`))).status).toBe(401);
    expect(mocks.runBillingCycleJob).not.toHaveBeenCalled();
  });
});
