import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  captureOperationalError: vi.fn(),
  runPendingPaymentReconciliation: vi.fn(),
}));

vi.mock("@/lib/payment-pending-reconciliation", () => ({
  runPendingPaymentReconciliation: mocks.runPendingPaymentReconciliation,
}));
vi.mock("@/lib/monitoring", () => ({
  captureOperationalError: mocks.captureOperationalError,
}));

import { GET, POST, maxDuration } from "./route";

const jobSecret = "test-fixture-job-secret";
const cronSecret = "test-fixture-cron-secret";
const SUMMARY = {
  candidates: 2, examined: 2, paid: 1, failed: 0, alreadySettled: 0, inProgress: 0, handedToRetry: 0, inventoryUnavailable: 0,
  pending: 0, notFound: 1, expired: 0, queryErrors: 0, manualReview: 0, closed: 0, claimedElsewhere: 0, errors: 0,
};

function request(method: "GET" | "POST", authorization?: string) {
  return new Request("https://app.example.test/api/jobs/payment-reconcile", {
    method,
    headers: authorization ? { authorization } : undefined,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("JOB_SECRET", jobSecret);
  vi.stubEnv("CRON_SECRET", cronSecret);
  mocks.runPendingPaymentReconciliation.mockResolvedValue(SUMMARY);
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("/api/jobs/payment-reconcile", () => {
  it("keeps the 300 s limit for the after() work a reconciled payment schedules", () => {
    expect(maxDuration).toBe(300);
  });

  it.each([
    { name: "POST without a secret", method: "POST" as const, authorization: undefined },
    { name: "POST with a wrong secret", method: "POST" as const, authorization: "Bearer test-fixture-wrong-job-secret" },
    { name: "POST with the cron secret", method: "POST" as const, authorization: `Bearer ${cronSecret}` },
    { name: "GET with the job secret", method: "GET" as const, authorization: `Bearer ${jobSecret}` },
    { name: "GET without a secret", method: "GET" as const, authorization: undefined },
  ])("returns 401 and never queries the provider for $name", async ({ method, authorization }) => {
    const response = await (method === "GET" ? GET : POST)(request(method, authorization));

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({ error: "Unauthorized" });
    expect(mocks.runPendingPaymentReconciliation).not.toHaveBeenCalled();
  });

  it.each([
    { method: "POST" as const, authorization: `Bearer ${jobSecret}` },
    { method: "GET" as const, authorization: `Bearer ${cronSecret}` },
  ])("runs one bounded pass and returns only its counts ($method)", async ({ method, authorization }) => {
    const response = await (method === "GET" ? GET : POST)(request(method, authorization));

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    await expect(response.json()).resolves.toEqual({ ok: true, ...SUMMARY });
    expect(mocks.runPendingPaymentReconciliation).toHaveBeenCalledOnce();
    // The route passes no caller input into the pass.
    expect(mocks.runPendingPaymentReconciliation).toHaveBeenCalledWith();
  });

  it("reports a skipped pass when PayUni is not configured", async () => {
    mocks.runPendingPaymentReconciliation.mockResolvedValue({ ...SUMMARY, candidates: 0, examined: 0, paid: 0, notFound: 0, skipped: "provider_unavailable" });

    const response = await POST(request("POST", `Bearer ${jobSecret}`));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ ok: true, skipped: "provider_unavailable", candidates: 0 });
  });

  it("fails closed with a fixed code and no error text when the pass throws", async () => {
    mocks.runPendingPaymentReconciliation.mockRejectedValue(new Error("scan failed for CD-SECRET-ORDER test-fixture-job-secret"));

    const response = await POST(request("POST", `Bearer ${jobSecret}`));

    expect(response.status).toBe(503);
    const body = await response.text();
    expect(JSON.parse(body)).toEqual({ ok: false, error: "payment_reconcile_failed" });
    expect(body).not.toContain("CD-SECRET-ORDER");
    expect(body).not.toContain(jobSecret);
    expect(mocks.captureOperationalError).toHaveBeenCalledWith(expect.any(Error), {
      source: "payment_reconcile_job", operation: "scan", status: "failed",
    });
  });

  it("keeps the 503 when monitoring itself throws", async () => {
    mocks.runPendingPaymentReconciliation.mockRejectedValue(new Error("scan failed"));
    mocks.captureOperationalError.mockImplementation(() => { throw new Error("monitoring down"); });

    const response = await POST(request("POST", `Bearer ${jobSecret}`));

    expect(response.status).toBe(503);
  });
});
