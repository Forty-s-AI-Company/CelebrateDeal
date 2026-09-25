import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ proof: vi.fn(), database: {} }));
vi.mock("@/lib/db", () => ({ getDb: () => mocks.database }));
vi.mock("@/lib/wp4-payuni-buyer-order-proof", () => ({ readWp4PayUniBuyerOrderProof: mocks.proof }));

import { POST } from "./route";

const jobSecret = "synthetic-job-secret";
const sourceSha = "a".repeat(40);

function request(options: { authorization?: string; sha?: string; body?: string } = {}) {
  return new Request("https://preview.example.test/api/admin/ops/payuni/wp4-buyer-order-proof", {
    method: "POST",
    headers: {
      ...(options.authorization ? { authorization: options.authorization } : {}),
      "x-celebratedeal-source-sha": options.sha ?? sourceSha,
    },
    ...(options.body === undefined ? {} : { body: options.body }),
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("JOB_SECRET", jobSecret);
  vi.stubEnv("VERCEL_ENV", "preview");
  vi.stubEnv("PAYUNI_ENV", "sandbox");
  vi.stubEnv("WP4_SANDBOX_EXECUTOR_ENABLED", "true");
  vi.stubEnv("VERCEL_GIT_COMMIT_SHA", sourceSha);
  mocks.proof.mockResolvedValue({ status: "VERIFIED", paymentStatus: "paid", orderStatus: "paid", orderCount: 1, paidEventCount: 1, orderEventCount: 1, reservationStatus: "committed", remainingInventory: 2 });
});
afterEach(() => vi.unstubAllEnvs());

describe("POST /api/admin/ops/payuni/wp4-buyer-order-proof", () => {
  it("rejects unauthenticated, non-Sandbox and wrong-source calls before DB access", async () => {
    expect((await POST(request())).status).toBe(401);
    vi.stubEnv("VERCEL_ENV", "production");
    expect((await POST(request({ authorization: `Bearer ${jobSecret}` }))).status).toBe(404);
    vi.stubEnv("VERCEL_ENV", "preview");
    expect((await POST(request({ authorization: `Bearer ${jobSecret}`, sha: "b".repeat(40) }))).status).toBe(404);
    expect((await POST(request({ authorization: `Bearer ${jobSecret}`, body: "{}" }))).status).toBe(404);
    expect(mocks.proof).not.toHaveBeenCalled();
  });

  it("returns only a no-store, closed persisted-state proof", async () => {
    const response = await POST(request({ authorization: `Bearer ${jobSecret}` }));
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    const proof = await response.json();
    expect(proof.status).toBe("VERIFIED");
    expect(JSON.stringify(proof)).not.toContain("synthetic-order");
    expect(mocks.proof).toHaveBeenCalledWith(mocks.database, sourceSha);
  });

  it.each([
    ["FIXTURE_UNAVAILABLE", 404], ["CANDIDATE_AMBIGUOUS", 409], ["STATE_MISMATCH", 409],
  ])("fails closed on %s", async (status, httpStatus) => {
    mocks.proof.mockResolvedValueOnce({ status });
    const response = await POST(request({ authorization: `Bearer ${jobSecret}` }));
    expect(response.status).toBe(httpStatus);
    await expect(response.json()).resolves.toEqual({ status });
  });
});
