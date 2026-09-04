import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ reconcile: vi.fn(), database: {} }));

vi.mock("@/lib/db", () => ({ getDb: () => mocks.database }));
vi.mock("@/lib/wp4-payuni-sandbox-reconciliation", () => ({
  reconcileWp4PayUniSandboxHistoricalRefund: mocks.reconcile,
}));

import { POST } from "./route";

const jobSecret = "test-wp4-recovery-job-secret";
const sourceSha = "a".repeat(40);

function request(options: { authorization?: string; sha?: string; body?: BodyInit } = {}) {
  return new Request("https://app.example.test/api/admin/ops/payuni/wp4-refund-recovery", {
    method: "POST",
    headers: {
      ...(options.authorization ? { authorization: options.authorization } : {}),
      "x-celebratedeal-source-sha": options.sha ?? sourceSha,
    },
    ...(options.body === undefined ? {} : { body: options.body, duplex: "half" }),
  } as RequestInit);
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("JOB_SECRET", jobSecret);
  vi.stubEnv("VERCEL_ENV", "preview");
  vi.stubEnv("PAYUNI_ENV", "sandbox");
  vi.stubEnv("WP4_SANDBOX_EXECUTOR_ENABLED", "true");
  vi.stubEnv("VERCEL_GIT_COMMIT_SHA", sourceSha);
  mocks.reconcile.mockResolvedValue({ reconciled: true, status: "RECONCILED" });
});

afterEach(() => vi.unstubAllEnvs());

describe("POST /api/admin/ops/payuni/wp4-refund-recovery", () => {
  it("enforces the job secret and gates before reconciliation", async () => {
    const response = await POST(request({ body: "caller-content" }));
    expect(response.status).toBe(401);
    expect(mocks.reconcile).not.toHaveBeenCalled();
  });

  it.each([
    ["production", "sandbox", "true"],
    ["preview", "production", "true"],
    ["preview", "sandbox", "false"],
  ])("is unavailable outside Preview Sandbox executor mode: %s/%s/%s", async (vercelEnv, payuniEnv, enabled) => {
    vi.stubEnv("VERCEL_ENV", vercelEnv);
    vi.stubEnv("PAYUNI_ENV", payuniEnv);
    vi.stubEnv("WP4_SANDBOX_EXECUTOR_ENABLED", enabled);
    const response = await POST(request({ authorization: `Bearer ${jobSecret}` }));
    expect(response.status).toBe(404);
    expect(mocks.reconcile).not.toHaveBeenCalled();
  });

  it("requires current Preview source lineage and an empty body", async () => {
    const drift = await POST(request({ authorization: `Bearer ${jobSecret}`, sha: "b".repeat(40) }));
    const body = await POST(request({ authorization: `Bearer ${jobSecret}`, body: "{}" }));
    expect(drift.status).toBe(404);
    expect(body.status).toBe(404);
    expect(mocks.reconcile).not.toHaveBeenCalled();
  });

  it("calls only the fixed historical buyer recovery and never accepts source input", async () => {
    const response = await POST(request({ authorization: `Bearer ${jobSecret}`, sha: "b".repeat(40) }));
    expect(response.status).toBe(404);
    expect(mocks.reconcile).not.toHaveBeenCalled();

    const valid = await POST(request({ authorization: `Bearer ${jobSecret}` }));
    expect(valid.status).toBe(200);
    expect(mocks.reconcile).toHaveBeenCalledExactlyOnceWith(mocks.database);
  });

  it.each([
    ["QUERY_AUTHENTICATION_FAILED", 503],
    ["QUERY_REQUEST_REJECTED", 503],
    ["QUERY_RESPONSE_REJECTED", 503],
    ["QUERY_NETWORK_FAILED", 503],
    ["QUERY_UNKNOWN_FAILED", 503],
    ["REFUND_NOT_CONFIRMED", 409],
  ])("returns fixed status %s without projecting on query failure", async (status, expectedStatus) => {
    mocks.reconcile.mockResolvedValueOnce({ reconciled: false, status });
    const response = await POST(request({ authorization: `Bearer ${jobSecret}` }));
    expect(response.status).toBe(expectedStatus);
    await expect(response.json()).resolves.toEqual({ reconciled: false, status });
  });

  it("maps unexpected errors to a generic response", async () => {
    mocks.reconcile.mockRejectedValueOnce(new Error("provider payload must not escape"));
    const response = await POST(request({ authorization: `Bearer ${jobSecret}` }));
    expect(response.status).toBe(503);
    expect(await response.text()).toBe('{"error":"Service unavailable"}');
  });
});
