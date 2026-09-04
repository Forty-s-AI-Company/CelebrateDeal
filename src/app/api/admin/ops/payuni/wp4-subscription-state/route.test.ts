import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ verify: vi.fn(), database: {} }));
vi.mock("@/lib/db", () => ({ getDb: () => mocks.database }));
vi.mock("@/lib/wp4-payuni-subscription-state", () => ({ verifyWp4PayUniSubscriptionState: mocks.verify }));

import { POST } from "./route";

const secret = "test-subscription-state-secret";
const sourceSha = "a".repeat(40);
function request(options: { authorization?: string; sha?: string; body?: BodyInit } = {}) {
  return new Request("https://preview.example.test/api/admin/ops/payuni/wp4-subscription-state", {
    method: "POST",
    headers: { ...(options.authorization ? { authorization: options.authorization } : {}), "x-celebratedeal-source-sha": options.sha ?? sourceSha },
    ...(options.body === undefined ? {} : { body: options.body, duplex: "half" }),
  } as RequestInit);
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("JOB_SECRET", secret);
  vi.stubEnv("VERCEL_ENV", "preview");
  vi.stubEnv("PAYUNI_ENV", "sandbox");
  vi.stubEnv("WP4_SANDBOX_EXECUTOR_ENABLED", "true");
  vi.stubEnv("VERCEL_GIT_COMMIT_SHA", sourceSha);
  vi.stubEnv("WP4_EXPECTED_SOURCE_SHA", undefined);
  mocks.verify.mockResolvedValue("ACTIVE_VERIFIED");
});
afterEach(() => vi.unstubAllEnvs());

describe("POST /api/admin/ops/payuni/wp4-subscription-state", () => {
  it("enforces fixed execution guards before state reads", async () => {
    const unauthorized = await POST(request());
    const body = await POST(request({ authorization: `Bearer ${secret}`, body: "{}" }));
    expect(unauthorized.status).toBe(401);
    expect(body.status).toBe(404);
    expect(mocks.verify).not.toHaveBeenCalled();
  });

  it.each([
    ["production", "sandbox", "true"],
    ["preview", "production", "true"],
    ["preview", "sandbox", "false"],
  ])("is unavailable outside Preview Sandbox executor mode: %s/%s/%s", async (vercelEnv, payuniEnv, enabled) => {
    vi.stubEnv("VERCEL_ENV", vercelEnv);
    vi.stubEnv("PAYUNI_ENV", payuniEnv);
    vi.stubEnv("WP4_SANDBOX_EXECUTOR_ENABLED", enabled);
    const response = await POST(request({ authorization: `Bearer ${secret}` }));
    expect(response.status).toBe(404);
    expect(mocks.verify).not.toHaveBeenCalled();
  });

  it("rejects source drift, missing or conflicting source configuration", async () => {
    const drift = await POST(request({ authorization: `Bearer ${secret}`, sha: "b".repeat(40) }));
    vi.stubEnv("VERCEL_GIT_COMMIT_SHA", undefined);
    const missing = await POST(request({ authorization: `Bearer ${secret}` }));
    vi.stubEnv("VERCEL_GIT_COMMIT_SHA", sourceSha);
    vi.stubEnv("WP4_EXPECTED_SOURCE_SHA", "b".repeat(40));
    const conflict = await POST(request({ authorization: `Bearer ${secret}` }));
    expect(drift.status).toBe(404);
    expect(missing.status).toBe(503);
    expect(conflict.status).toBe(503);
    expect(mocks.verify).not.toHaveBeenCalled();
  });

  it("maps verifier failures to generic unavailable without leaking details", async () => {
    mocks.verify.mockRejectedValueOnce(new Error("subscription id or quota must not escape"));
    const response = await POST(request({ authorization: `Bearer ${secret}` }));
    expect(response.status).toBe(503);
    expect(await response.text()).toBe('{"error":"Service unavailable"}');
  });

  it.each([["ACTIVE_VERIFIED", 200], ["REFUNDED_VERIFIED", 200], ["STATE_UNVERIFIED", 409]])("returns fixed state %s", async (state, expected) => {
    mocks.verify.mockResolvedValueOnce(state);
    const response = await POST(request({ authorization: `Bearer ${secret}` }));
    expect(response.status).toBe(expected);
    await expect(response.json()).resolves.toEqual({ status: state });
    expect(mocks.verify).toHaveBeenCalledExactlyOnceWith(mocks.database, sourceSha);
  });
});
