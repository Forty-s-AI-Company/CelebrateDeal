import { afterEach, beforeEach, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ cleanup: vi.fn(), origin: vi.fn() }));
vi.mock("@/lib/db", () => ({ getDb: () => ({}) }));
vi.mock("@/lib/live-media-provider", () => ({ mediaOrigin: m.origin }));
vi.mock("@/lib/live-media-cleanup", () => ({ cleanupMediaSessions: m.cleanup }));
import { GET, POST } from "./route";

// Real api-security bindings (PR #447 review n5): GET accepts only CRON_SECRET,
// POST accepts only JOB_SECRET.
const cronSecret = "live-media-cron-test-secret-0001";
const jobSecret = "live-media-job-test-secret-00001";
const request = (method: "GET" | "POST", secret?: string) => new Request("https://app.test/api/cron/live-media", {
  method,
  headers: secret ? { authorization: `Bearer ${secret}` } : undefined,
});

beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv("CRON_SECRET", cronSecret);
  vi.stubEnv("JOB_SECRET", jobSecret);
  m.origin.mockReturnValue("http://127.0.0.1:18889");
  m.cleanup.mockResolvedValue({ scanned: 2, stopped: 2 });
});
afterEach(() => vi.unstubAllEnvs());

it("never sweeps through GET without CRON_SECRET, and GET rejects JOB_SECRET", async () => {
  for (const secret of [undefined, jobSecret, "wrong-secret"]) expect((await GET(request("GET", secret))).status).toBe(401);
  expect(m.cleanup).not.toHaveBeenCalled();
});
it("uses the private configured provider and returns only counts", async () => {
  const response = await GET(request("GET", cronSecret));
  expect(await response.json()).toEqual({ scanned: 2, stopped: 2 });
  expect(m.cleanup).toHaveBeenCalledWith({}, "http://127.0.0.1:18889");
});
it("fails closed without a media origin", async () => {
  m.origin.mockReturnValue(null);
  expect((await GET(request("GET", cronSecret))).status).toBe(503);
  expect(m.cleanup).not.toHaveBeenCalled();
});
it("never sweeps through POST without JOB_SECRET, and POST rejects CRON_SECRET", async () => {
  for (const secret of [undefined, cronSecret, "wrong-secret"]) expect((await POST(request("POST", secret))).status).toBe(401);
  expect(m.cleanup).not.toHaveBeenCalled();
});
it("runs the same cleanup handler through the job runner entry", async () => {
  const response = await POST(request("POST", jobSecret));
  expect(await response.json()).toEqual({ scanned: 2, stopped: 2 });
  expect(m.cleanup).toHaveBeenCalledWith({}, "http://127.0.0.1:18889");
});
it("fails closed through the job runner entry without a media origin or with secrets unset", async () => {
  m.origin.mockReturnValue(null);
  expect((await POST(request("POST", jobSecret))).status).toBe(503);
  vi.stubEnv("JOB_SECRET", undefined);
  expect((await POST(request("POST", jobSecret))).status).toBe(401);
  expect(m.cleanup).not.toHaveBeenCalled();
});
