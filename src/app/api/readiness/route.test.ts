import { afterEach, beforeEach, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({ current: {} as Record<string, unknown> }));
vi.mock("@/lib/db", () => ({ getDb: () => db.current }));
import { GET } from "./route";
import { readinessWhere, resetReadinessCacheForTests } from "@/lib/job-readiness";

const secret = "readiness-cron-test-secret-0001";
const NOW = new Date("2026-10-21T12:00:00.000Z");
const request = (token?: string) => new Request("https://app.test/api/readiness", {
  headers: token ? { authorization: `Bearer ${token}` } : undefined,
});

type Counts = { due?: number; inFlight?: number; stale?: number; last?: Date | null; oldest?: Date | null };
/** Fake delegate that answers by inspecting the exact `where` the route sends. */
function delegate(field: string, dueField: string, counts: Counts) {
  const wheres: object[] = [];
  const isStale = (where: Record<string, unknown>) => ["claimedAt", "updatedAt", "leaseExpiresAt"].some((k) => k in where);
  return {
    wheres,
    findFirst: vi.fn(async (args: { where: object }) => { wheres.push(args.where); return counts.last ? { [field]: counts.last } : null; }),
    aggregate: vi.fn(async () => ({ _min: { [dueField]: counts.oldest ?? null } })),
    count: vi.fn(async (args: { where: Record<string, unknown> }) => {
      wheres.push(args.where);
      if (dueField in args.where) return counts.due ?? 0;
      if (isStale(args.where)) return counts.stale ?? 0;
      return counts.inFlight ?? 0;
    }),
  };
}
function build(counts: Partial<Record<"email" | "line" | "webhook" | "learner" | "tracking", Counts>> = {}) {
  const parts = {
    emailDelivery: delegate("sentAt", "nextAttemptAt", counts.email ?? {}),
    lineDelivery: delegate("sentAt", "nextAttemptAt", counts.line ?? {}),
    webhookEvent: delegate("processedAt", "nextRetryAt", counts.webhook ?? {}),
    learnerNotificationDelivery: delegate("dispatchedAt", "nextAttemptAt", counts.learner ?? {}),
    trackingDelivery: delegate("acceptedAt", "nextAttemptAt", counts.tracking ?? {}),
  };
  db.current = parts;
  return parts;
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW);
  vi.stubEnv("CRON_SECRET", secret);
  vi.stubEnv("JOB_SECRET", "other-job-secret-000000000000001");
  resetReadinessCacheForTests();
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs(); });

it("rejects missing, wrong and JOB_SECRET bearers before touching the database", async () => {
  const parts = build();
  for (const token of [undefined, "wrong", "other-job-secret-000000000000001"]) {
    expect((await GET(request(token))).status).toBe(401);
  }
  expect(parts.emailDelivery.count).not.toHaveBeenCalled();
});

it("reports a healthy system without false alarms", async () => {
  const last = new Date("2026-10-21T11:59:00.000Z");
  build({ email: { last }, webhook: { last }, tracking: { last }, learner: { last }, line: { last } });
  const body = await (await GET(request(secret))).json();
  expect(Object.keys(body.jobs).sort()).toEqual(["email", "learnerNotifications", "line", "trackingOutbox", "webhookRetry"]);
  for (const job of Object.values(body.jobs) as Array<{ lastSuccessAt: string; due: { count: number; oldestDueAt: null }; inFlight: { staleCount: number } }>) {
    expect(job.lastSuccessAt).toBe(last.toISOString());
    expect(job.due).toEqual({ count: 0, oldestDueAt: null });
    expect(job.inFlight.staleCount).toBe(0);
  }
  expect(JSON.stringify(body)).not.toMatch(/vendorId|recipient|email@/i);
});

it("shows a stalled job: due backlog with an old due time and stale in-flight rows", async () => {
  const oldest = new Date("2026-10-21T09:00:00.000Z");
  build({ webhook: { due: 4, oldest, stale: 2, inFlight: 2 }, learner: { stale: 1, inFlight: 1 } });
  const body = await (await GET(request(secret))).json();
  expect(body.jobs.webhookRetry).toMatchObject({ due: { count: 4, oldestDueAt: oldest.toISOString() }, inFlight: { count: 2, staleCount: 2 } });
  expect(body.jobs.learnerNotifications.inFlight).toEqual({ count: 1, staleCount: 1 });
  expect(body.jobs.email.due.count).toBe(0);
});

it("uses the same candidate conditions as the workers and never counts future schedules as due", async () => {
  const parts = build();
  await GET(request(secret));
  // Future-dated reminders (nextAttemptAt > now) are excluded by `lte: now`.
  expect(parts.emailDelivery.wheres).toContainEqual({ status: { in: ["queued", "failed"] }, nextAttemptAt: { lte: NOW } });
  expect(parts.lineDelivery.wheres).toContainEqual({ status: { in: ["queued", "failed"] }, nextAttemptAt: { lte: NOW } });
  expect(parts.webhookEvent.wheres).toContainEqual({ status: "failed", nextRetryAt: { lte: NOW } });
  expect(parts.webhookEvent.wheres).toContainEqual({ status: "retrying" });
  expect(parts.learnerNotificationDelivery.wheres).toContainEqual({ status: "queued", attemptCount: { lt: 5 }, nextAttemptAt: { lte: NOW } });
  expect(parts.learnerNotificationDelivery.wheres).toContainEqual({ status: "processing" });
  expect(parts.trackingDelivery.wheres).toContainEqual({ status: "queued", nextAttemptAt: { lte: NOW } });
  expect(parts.trackingDelivery.wheres).toContainEqual({ status: "processing" });
  expect(readinessWhere.trackingOutbox.stale(NOW)).toEqual({ status: "processing", leaseExpiresAt: { lte: NOW } });
});

it("reads the latest success with a single ordered row and caches for 60 seconds", async () => {
  const parts = build();
  await GET(request(secret));
  expect(parts.emailDelivery.findFirst).toHaveBeenCalledWith({ where: { status: "sent" }, orderBy: { sentAt: "desc" }, select: { sentAt: true } });
  expect(parts.emailDelivery.aggregate).toHaveBeenCalledTimes(1);
  await GET(request(secret));
  expect(parts.emailDelivery.findFirst).toHaveBeenCalledTimes(1);
  vi.setSystemTime(new Date(NOW.getTime() + 61_000));
  await GET(request(secret));
  expect(parts.emailDelivery.findFirst).toHaveBeenCalledTimes(2);
});

it("fails closed with a generic 503", async () => {
  build();
  (db.current.emailDelivery as { findFirst: ReturnType<typeof vi.fn> }).findFirst = vi.fn(async () => { throw new Error("postgres://secret"); });
  const response = await GET(request(secret));
  expect(response.status).toBe(503);
  expect(JSON.stringify(await response.json())).not.toContain("postgres");
});
