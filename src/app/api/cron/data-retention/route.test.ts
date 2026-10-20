import { afterEach, beforeEach, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({ purge: vi.fn() }));
vi.mock("@/lib/db", () => ({ getDb: () => ({}) }));
vi.mock("@/lib/data-retention", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/data-retention")>()),
  purgeExpiredData: m.purge,
}));
import { GET, POST } from "./route";

const cronSecret = "data-retention-cron-test-secret-01";
const jobSecret = "data-retention-job-test-secret-001";
const request = (method: "GET" | "POST", secret?: string) => new Request("https://app.test/api/cron/data-retention", {
  method,
  headers: secret ? { authorization: `Bearer ${secret}` } : undefined,
});
const counts = { webhookPayloadsPurged: 3, analyticsEventsDeleted: 5, auditLogIpsCleared: 7, remaining: false };

beforeEach(() => {
  vi.resetAllMocks();
  vi.stubEnv("CRON_SECRET", cronSecret);
  vi.stubEnv("JOB_SECRET", jobSecret);
  m.purge.mockResolvedValue(counts);
});
afterEach(() => vi.unstubAllEnvs());

it("never sweeps through GET without CRON_SECRET, and GET rejects JOB_SECRET", async () => {
  for (const secret of [undefined, jobSecret, "wrong-secret"]) expect((await GET(request("GET", secret))).status).toBe(401);
  expect(m.purge).not.toHaveBeenCalled();
});

it("never sweeps through POST without JOB_SECRET, and POST rejects CRON_SECRET", async () => {
  for (const secret of [undefined, cronSecret, "wrong-secret"]) expect((await POST(request("POST", secret))).status).toBe(401);
  expect(m.purge).not.toHaveBeenCalled();
});

it("runs with the default 180/365/365-day policy and returns counts only", async () => {
  const response = await GET(request("GET", cronSecret));
  expect(response.status).toBe(200);
  expect(response.headers.get("cache-control")).toBe("no-store");
  expect(await response.json()).toEqual(counts);
  expect(m.purge).toHaveBeenCalledWith({}, { policy: { webhookPayloadDays: 180, analyticsEventDays: 365, auditLogIpDays: 365 } });
  expect((await POST(request("POST", jobSecret))).status).toBe(200);
});

it("honours environment overrides", async () => {
  vi.stubEnv("DATA_RETENTION_WEBHOOK_PAYLOAD_DAYS", "90");
  vi.stubEnv("DATA_RETENTION_AUDIT_LOG_IP_DAYS", "730");
  await GET(request("GET", cronSecret));
  expect(m.purge).toHaveBeenCalledWith({}, { policy: { webhookPayloadDays: 90, analyticsEventDays: 365, auditLogIpDays: 730 } });
});

it.each(["7", "abc", "99999", "-30"])("fails closed on an invalid window (%s) without sweeping", async (value) => {
  vi.stubEnv("DATA_RETENTION_ANALYTICS_EVENT_DAYS", value);
  const response = await GET(request("GET", cronSecret));
  expect(response.status).toBe(503);
  expect(m.purge).not.toHaveBeenCalled();
});

it("hides database errors behind a generic 503", async () => {
  m.purge.mockRejectedValueOnce(new Error("relation secret_table does not exist"));
  const response = await GET(request("GET", cronSecret));
  expect(response.status).toBe(503);
  expect(JSON.stringify(await response.json())).not.toContain("secret_table");
});
