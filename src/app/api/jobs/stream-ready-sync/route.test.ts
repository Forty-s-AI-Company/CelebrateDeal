import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  runStreamReadySync: vi.fn(),
  captureOperationalError: vi.fn(),
}));

vi.mock("@/lib/cloudflare-stream-ready-sync", () => ({ runStreamReadySync: mocks.runStreamReadySync }));
vi.mock("@/lib/monitoring", () => ({ captureOperationalError: mocks.captureOperationalError }));

import { GET, maxDuration, POST } from "./route";

const jobSecret = "test-fixture-job-secret-0123456789";
const cronSecret = "test-fixture-cron-secret-0123456789";
const url = "https://app.example.test/api/jobs/stream-ready-sync";

const summary = {
  candidates: 3,
  queried: 2,
  throttled: 1,
  deferred: 0,
  updated: 1,
  unchanged: 0,
  notReady: 1,
  providerErrors: 0,
  mappingSkipped: 0,
  contention: 0,
  errors: 0,
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("JOB_SECRET", jobSecret);
  vi.stubEnv("CRON_SECRET", cronSecret);
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("/api/jobs/stream-ready-sync", () => {
  it("keeps a bounded maxDuration under the scheduler's 120 s wait", () => {
    expect(maxDuration).toBe(60);
  });

  it.each([
    ["POST without a secret", () => POST(new Request(url, { method: "POST" }))],
    ["POST with CRON_SECRET", () => POST(new Request(url, { method: "POST", headers: { authorization: `Bearer ${cronSecret}` } }))],
    ["GET with JOB_SECRET", () => GET(new Request(url, { headers: { authorization: `Bearer ${jobSecret}` } }))],
  ])("rejects %s without scanning", async (_label, call) => {
    const response = await call();

    expect(response.status).toBe(401);
    expect(mocks.runStreamReadySync).not.toHaveBeenCalled();
  });

  it.each([
    ["POST with JOB_SECRET", () => POST(new Request(url, { method: "POST", headers: { authorization: `Bearer ${jobSecret}` } }))],
    ["GET with CRON_SECRET", () => GET(new Request(url, { headers: { authorization: `Bearer ${cronSecret}` } }))],
  ])("returns only the run counters for %s", async (_label, call) => {
    mocks.runStreamReadySync.mockResolvedValue(summary);

    const response = await call();

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    await expect(response.json()).resolves.toEqual({ ok: true, ...summary });
    expect(mocks.runStreamReadySync).toHaveBeenCalledTimes(1);
  });

  it("answers a fixed 503 without leaking the scan error", async () => {
    mocks.runStreamReadySync.mockRejectedValue(new Error("postgres://user:secret@db.internal token=abc"));
    mocks.captureOperationalError.mockImplementation(() => {
      throw new Error("monitoring unavailable");
    });

    const response = await POST(new Request(url, { method: "POST", headers: { authorization: `Bearer ${jobSecret}` } }));
    const text = await response.text();

    expect(response.status).toBe(503);
    expect(JSON.parse(text)).toEqual({ ok: false, error: "stream_ready_sync_failed" });
    expect(text).not.toMatch(/secret|token|postgres/u);
    expect(mocks.captureOperationalError).toHaveBeenCalledWith(expect.any(Error), {
      source: "stream_ready_sync_job",
      operation: "scan",
      status: "failed",
    });
  });
});
