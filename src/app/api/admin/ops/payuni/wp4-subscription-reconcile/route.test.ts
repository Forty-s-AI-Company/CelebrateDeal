import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  reconcile: vi.fn(),
  database: {},
}));

vi.mock("@/lib/db", () => ({ getDb: () => mocks.database }));
vi.mock("@/lib/wp4-payuni-sandbox-reconciliation", () => ({
  reconcileWp4PayUniSandboxSubscriptionRefund: mocks.reconcile,
}));

import { POST } from "./route";

const jobSecret = "test-wp4-subscription-reconcile-job-secret";
const sourceSha = "a".repeat(40);

function request(options: { authorization?: string; sha?: string; body?: BodyInit } = {}) {
  return new Request("https://app.example.test/api/admin/ops/payuni/wp4-subscription-reconcile", {
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

describe("POST /api/admin/ops/payuni/wp4-subscription-reconcile", () => {
  it("authenticates before reading a body or accessing the projection", async () => {
    const response = await POST(request({ body: "caller-owned-content" }));

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({ error: "Unauthorized" });
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
    await expect(response.json()).resolves.toEqual({ error: "Not found" });
    expect(mocks.reconcile).not.toHaveBeenCalled();
  });

  it("rejects source drift, missing source configuration, and caller content", async () => {
    const drift = await POST(request({ authorization: `Bearer ${jobSecret}`, sha: "b".repeat(40) }));
    vi.stubEnv("VERCEL_GIT_COMMIT_SHA", undefined);
    const missingSource = await POST(request({ authorization: `Bearer ${jobSecret}` }));
    vi.stubEnv("VERCEL_GIT_COMMIT_SHA", sourceSha);
    const body = await POST(request({ authorization: `Bearer ${jobSecret}`, body: "{}" }));

    expect(drift.status).toBe(404);
    expect(missingSource.status).toBe(503);
    expect(body.status).toBe(404);
    expect(mocks.reconcile).not.toHaveBeenCalled();
  });

  it("returns only the fixed reconciliation boolean and enum", async () => {
    const response = await POST(request({ authorization: `Bearer ${jobSecret}` }));

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    await expect(response.json()).resolves.toEqual({ reconciled: true, status: "RECONCILED" });
    expect(mocks.reconcile).toHaveBeenCalledExactlyOnceWith(mocks.database, sourceSha);
  });

  it.each([
    [{ reconciled: false, status: "FIXTURE_UNAVAILABLE" }, 404],
    [{ reconciled: false, status: "CANDIDATE_AMBIGUOUS" }, 409],
    [{ reconciled: false, status: "PENDING_RESERVATION_UNAVAILABLE" }, 409],
    [{ reconciled: false, status: "REFUND_NOT_CONFIRMED" }, 409],
    [{ reconciled: false, status: "PROJECTION_UNAVAILABLE" }, 503],
  ])("maps closed projection status %# to the fixed HTTP status", async (result, expectedStatus) => {
    mocks.reconcile.mockResolvedValueOnce(result);

    const response = await POST(request({ authorization: `Bearer ${jobSecret}` }));

    expect(response.status).toBe(expectedStatus);
    await expect(response.json()).resolves.toEqual(result);
  });

  it("maps unexpected internal errors to a generic unavailable response", async () => {
    mocks.reconcile.mockRejectedValueOnce(new Error("provider URL and payload must not escape"));

    const response = await POST(request({ authorization: `Bearer ${jobSecret}` }));
    const body = await response.text();

    expect(response.status).toBe(503);
    expect(body).toBe('{"error":"Service unavailable"}');
    expect(body).not.toContain("provider URL");
    expect(body).not.toContain("payload");
  });
});
