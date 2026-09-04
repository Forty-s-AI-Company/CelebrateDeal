import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ reserve: vi.fn(), database: {} }));
vi.mock("@/lib/db", () => ({ getDb: () => mocks.database }));
vi.mock("@/lib/wp4-payuni-sandbox-payment-attempt", () => ({ reserveWp4PayUniPaymentAttempt: mocks.reserve }));

import { POST } from "./route";

const jobSecret = "test-job-secret";
const sourceSha = "a".repeat(40);

function request(options: { authorization?: string; sha?: string; body?: BodyInit } = {}) {
  return new Request("https://preview.example.test/api/admin/ops/payuni/wp4-payment-attempt", {
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
  mocks.reserve.mockResolvedValue({ status: "SUBMIT_ALLOWED", reservationCreated: true });
});

afterEach(() => vi.unstubAllEnvs());

describe("POST /api/admin/ops/payuni/wp4-payment-attempt", () => {
  it("authenticates before DB access", async () => {
    const response = await POST(request());
    expect(response.status).toBe(401);
    expect(mocks.reserve).not.toHaveBeenCalled();
  });

  it("is unavailable outside Preview Sandbox executor mode", async () => {
    vi.stubEnv("VERCEL_ENV", "production");
    const response = await POST(request({ authorization: `Bearer ${jobSecret}` }));
    expect(response.status).toBe(404);
    expect(mocks.reserve).not.toHaveBeenCalled();
  });

  it("rejects source drift and caller content", async () => {
    const drift = await POST(request({ authorization: `Bearer ${jobSecret}`, sha: "b".repeat(40) }));
    const body = await POST(request({ authorization: `Bearer ${jobSecret}`, body: "{}" }));
    expect(drift.status).toBe(404);
    expect(body.status).toBe(404);
    expect(mocks.reserve).not.toHaveBeenCalled();
  });

  it.each([
    [{ status: "SUBMIT_ALLOWED", reservationCreated: true }, 200],
    [{ status: "ALREADY_PAID", reservationCreated: false }, 200],
    [{ status: "ALREADY_RESERVED", reservationCreated: false }, 409],
    [{ status: "CANDIDATE_AMBIGUOUS", reservationCreated: false }, 409],
    [{ status: "FIXTURE_UNAVAILABLE", reservationCreated: false }, 404],
  ])("returns only a closed reservation result %#", async (result, status) => {
    mocks.reserve.mockResolvedValueOnce(result);
    const response = await POST(request({ authorization: `Bearer ${jobSecret}` }));
    expect(response.status).toBe(status);
    expect(response.headers.get("cache-control")).toBe("no-store");
    await expect(response.json()).resolves.toEqual(result);
  });
});

