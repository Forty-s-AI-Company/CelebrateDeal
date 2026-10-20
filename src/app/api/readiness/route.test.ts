import { afterEach, beforeEach, expect, it, vi } from "vitest";

const agg = (key: string, value: Date | null) => vi.fn(async () => ({ _max: { [key]: value }, _min: { createdAt: value } }));
const model = (key: string) => ({ aggregate: agg(key, new Date("2026-10-21T00:00:00.000Z")), count: vi.fn(async () => 3) });
const db = vi.hoisted(() => ({ current: {} as Record<string, unknown> }));
vi.mock("@/lib/db", () => ({ getDb: () => db.current }));
import { GET } from "./route";

const secret = "readiness-cron-test-secret-0001";
const request = (token?: string) => new Request("https://app.test/api/readiness", {
  headers: token ? { authorization: `Bearer ${token}` } : undefined,
});

beforeEach(() => {
  vi.stubEnv("CRON_SECRET", secret);
  vi.stubEnv("JOB_SECRET", "other-job-secret-000000000000001");
  db.current = {
    emailDelivery: model("sentAt"),
    lineDelivery: model("sentAt"),
    webhookEvent: model("processedAt"),
    learnerNotificationDelivery: model("dispatchedAt"),
    trackingDelivery: model("acceptedAt"),
  };
});
afterEach(() => vi.unstubAllEnvs());

it("rejects missing, wrong and JOB_SECRET bearers before touching the database", async () => {
  for (const token of [undefined, "wrong", "other-job-secret-000000000000001"]) {
    expect((await GET(request(token))).status).toBe(401);
  }
  expect((db.current.emailDelivery as ReturnType<typeof model>).count).not.toHaveBeenCalled();
});

it("returns last success and queue depth for all five jobs without identifiers", async () => {
  const response = await GET(request(secret));
  expect(response.status).toBe(200);
  expect(response.headers.get("cache-control")).toBe("no-store");
  const body = await response.json();
  expect(Object.keys(body.jobs).sort()).toEqual(["email", "learnerNotifications", "line", "trackingOutbox", "webhookRetry"]);
  expect(body.jobs.email).toEqual({ lastSuccessAt: "2026-10-21T00:00:00.000Z", queueDepth: 3, oldestPendingAt: "2026-10-21T00:00:00.000Z" });
  expect(JSON.stringify(body)).not.toMatch(/vendorId|email@|recipient/i);
});

it("fails closed with a generic 503", async () => {
  db.current = { ...db.current, emailDelivery: { aggregate: vi.fn(async () => { throw new Error("postgres://secret"); }), count: vi.fn() } };
  const response = await GET(request(secret));
  expect(response.status).toBe(503);
  expect(JSON.stringify(await response.json())).not.toContain("postgres");
});
