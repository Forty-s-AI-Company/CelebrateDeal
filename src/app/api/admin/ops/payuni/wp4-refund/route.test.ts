import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ execute: vi.fn(), database: {} }));
vi.mock("@/lib/db", () => ({ getDb: () => mocks.database }));
vi.mock("@/lib/wp4-payuni-sandbox-refund-execution", () => ({ executeNextWp4PayUniSandboxRefund: mocks.execute }));

import { POST } from "./route";

const jobSecret = "test-wp4-refund-job-secret";
const sourceSha = "a".repeat(40);

function request(options: { authorization?: string; sha?: string; body?: BodyInit } = {}) {
  return new Request("https://app.example.test/api/admin/ops/payuni/wp4-refund", {
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
  mocks.execute.mockResolvedValue({ status: "COMPLETED", purpose: "buyer_order", phase: "partial", providerWriteAttempted: true });
});

afterEach(() => vi.unstubAllEnvs());

describe("POST /api/admin/ops/payuni/wp4-refund", () => {
  it("rejects unauthenticated or caller-owned input before selecting a refund", async () => {
    const unauthenticated = await POST(request({ body: "caller-owned" }));
    const body = await POST(request({ authorization: `Bearer ${jobSecret}`, body: "{}" }));
    expect(unauthenticated.status).toBe(401);
    expect(body.status).toBe(404);
    expect(mocks.execute).not.toHaveBeenCalled();
  });

  it("only runs for the exact Preview Sandbox source and returns a closed projection", async () => {
    const response = await POST(request({ authorization: `Bearer ${jobSecret}` }));
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ status: "COMPLETED", purpose: "buyer_order", phase: "partial", providerWriteAttempted: true });
    expect(mocks.execute).toHaveBeenCalledExactlyOnceWith(mocks.database, sourceSha);
  });

  it.each([
    ["FIXTURE_UNAVAILABLE", 404],
    ["CANDIDATE_AMBIGUOUS", 409],
    ["REFUND_NOT_ELIGIBLE", 409],
    ["PROVIDER_UNAVAILABLE", 503],
    ["PROVIDER_REJECTED", 503],
    ["RECONCILIATION_REQUIRED", 503],
  ])("maps %s to the fixed safe response class", async (status, expectedStatus) => {
    mocks.execute.mockResolvedValueOnce({ status, purpose: null, phase: null, providerWriteAttempted: false });
    const response = await POST(request({ authorization: `Bearer ${jobSecret}` }));
    expect(response.status).toBe(expectedStatus);
  });
});
