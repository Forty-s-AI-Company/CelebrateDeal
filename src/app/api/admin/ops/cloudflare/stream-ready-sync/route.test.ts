import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  runStreamReadySync: vi.fn(),
  captureOperationalError: vi.fn(),
}));

vi.mock("@/lib/cloudflare-stream-ready-sync", () => ({ runStreamReadySync: mocks.runStreamReadySync }));
vi.mock("@/lib/monitoring", () => ({ captureOperationalError: mocks.captureOperationalError }));

import { maxDuration, POST } from "./route";

const jobSecret = "test-fixture-job-secret-0123456789";
const smokeSecret = "test-fixture-ops-smoke-secret-0123456789abcdef";
const cronSecret = "test-fixture-cron-secret-0123456789";
const url = "https://app.example.test/api/admin/ops/cloudflare/stream-ready-sync";

function post(body: unknown, secret = jobSecret) {
  return POST(new Request(url, {
    method: "POST",
    headers: { authorization: `Bearer ${secret}`, "content-type": "application/json" },
    body: typeof body === "string" ? body : JSON.stringify(body),
  }));
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("JOB_SECRET", jobSecret);
  vi.stubEnv("OPS_SMOKE_SECRET", smokeSecret);
  vi.stubEnv("CRON_SECRET", cronSecret);
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("POST /api/admin/ops/cloudflare/stream-ready-sync (A4-04 catch-up)", () => {
  it("keeps the scheduled job's time budget", () => {
    expect(maxDuration).toBe(60);
  });

  it.each([
    ["no secret", () => POST(new Request(url, { method: "POST", body: "{}" }))],
    ["OPS_SMOKE_SECRET", () => post({ maxAgeHours: 72 }, smokeSecret)],
    ["CRON_SECRET", () => post({ maxAgeHours: 72 }, cronSecret)],
  ])("rejects %s without scanning", async (_label, call) => {
    const response = await call();

    expect(response.status).toBe(401);
    expect(mocks.runStreamReadySync).not.toHaveBeenCalled();
  });

  it.each([
    ["a missing window", {}],
    ["a window inside the scheduled 24 h", { maxAgeHours: 12 }],
    ["a window beyond 30 days", { maxAgeHours: 721 }],
    ["a fractional window", { maxAgeHours: 48.5 }],
    ["an unknown field", { maxAgeHours: 48, batchLimit: 1000 }],
    ["an empty vendor", { maxAgeHours: 48, vendorId: " " }],
    ["malformed JSON", "{"],
  ])("rejects %s with a fixed 400", async (_label, body) => {
    const response = await post(body);

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: "Invalid stream ready catch-up request" });
    expect(mocks.runStreamReadySync).not.toHaveBeenCalled();
  });

  it("runs the same fallback with the wider window and optional vendor, returning counts only", async () => {
    const summary = { candidates: 2, queried: 2, updated: 1, notReady: 1 };
    mocks.runStreamReadySync.mockResolvedValue(summary);

    const response = await post({ maxAgeHours: 168, vendorId: "vendor-1" });

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    await expect(response.json()).resolves.toEqual({ ok: true, ...summary });
    expect(mocks.runStreamReadySync).toHaveBeenCalledWith({ maxAgeMs: 168 * 60 * 60_000, vendorId: "vendor-1" });

    await post({ maxAgeHours: 48 });
    expect(mocks.runStreamReadySync).toHaveBeenLastCalledWith({ maxAgeMs: 48 * 60 * 60_000 });
  });

  it("answers a fixed 503 without leaking the scan error", async () => {
    mocks.runStreamReadySync.mockRejectedValue(new Error("postgres://user:secret@db.internal"));

    const response = await post({ maxAgeHours: 48 });
    const text = await response.text();

    expect(response.status).toBe(503);
    expect(JSON.parse(text)).toEqual({ ok: false, error: "stream_ready_sync_failed" });
    expect(text).not.toMatch(/secret|postgres/u);
    expect(mocks.captureOperationalError).toHaveBeenCalledTimes(1);
  });
});
