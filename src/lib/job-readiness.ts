import { getDb } from "@/lib/db";

/**
 * F-142 readiness queries. The `where` builders mirror the exact candidate
 * conditions the workers use (email-delivery.ts, line-notification.ts,
 * webhook-retry.ts, learner-notification-outbox.ts, tracking-purchase-worker.ts)
 * so "due" means "a worker would pick this row up now". Keep them in sync; the
 * unit test pins every builder.
 */
const EMAIL_LEASE_MS = 10 * 60_000;
const LINE_LEASE_MS = 5 * 60_000;
const WEBHOOK_LEASE_MS = 10 * 60_000;
const LEARNER_LEASE_MS = 10 * 60_000;
/** Success timestamps have no index; recompute at most once per window. */
export const READINESS_CACHE_MS = 60_000;

const ago = (now: Date, ms: number) => new Date(now.getTime() - ms);

export const readinessWhere = {
  email: {
    due: (now: Date) => ({ status: { in: ["queued", "failed"] }, nextAttemptAt: { lte: now } }),
    inFlight: () => ({ status: "sending" }),
    stale: (now: Date) => ({ status: "sending", claimedAt: { lte: ago(now, EMAIL_LEASE_MS) } }),
  },
  line: {
    due: (now: Date) => ({ status: { in: ["queued", "failed"] }, nextAttemptAt: { lte: now } }),
    inFlight: () => ({ status: "sending" }),
    stale: (now: Date) => ({ status: "sending", claimedAt: { lt: ago(now, LINE_LEASE_MS) } }),
  },
  webhookRetry: {
    due: (now: Date) => ({ status: "failed", nextRetryAt: { lte: now } }),
    inFlight: () => ({ status: "retrying" }),
    stale: (now: Date) => ({ status: "retrying", updatedAt: { lte: ago(now, WEBHOOK_LEASE_MS) } }),
  },
  learnerNotifications: {
    due: (now: Date) => ({ status: "queued", attemptCount: { lt: 5 }, nextAttemptAt: { lte: now } }),
    inFlight: () => ({ status: "processing" }),
    // Learner processing rows are never auto-recovered, so a stale one needs a human.
    stale: (now: Date) => ({ status: "processing", claimedAt: { lte: ago(now, LEARNER_LEASE_MS) } }),
  },
  trackingOutbox: {
    due: (now: Date) => ({ status: "queued", nextAttemptAt: { lte: now } }),
    inFlight: () => ({ status: "processing" }),
    stale: (now: Date) => ({ status: "processing", leaseExpiresAt: { lte: now } }),
  },
} as const;

type Delegate = {
  count: (args: { where: object }) => Promise<number>;
  aggregate: (args: { where?: object; _min?: Record<string, true> }) => Promise<{ _min: Record<string, Date | null> }>;
  findFirst: (args: { where: object; orderBy: object; select: object }) => Promise<Record<string, Date | null> | null>;
};

export type JobReadiness = {
  lastSuccessAt: string | null;
  due: { count: number; oldestDueAt: string | null };
  inFlight: { count: number; staleCount: number };
};

const iso = (value: Date | null | undefined) => (value ? value.toISOString() : null);

async function job(
  delegate: Delegate,
  now: Date,
  spec: { builders: { due: (n: Date) => object; inFlight: () => object; stale: (n: Date) => object }; successWhere: object; successField: string; dueField: string },
): Promise<JobReadiness> {
  const due = spec.builders.due(now);
  const [lastRow, dueCount, oldest, inFlightCount, staleCount] = await Promise.all([
    delegate.findFirst({ where: spec.successWhere, orderBy: { [spec.successField]: "desc" }, select: { [spec.successField]: true } }),
    delegate.count({ where: due }),
    delegate.aggregate({ where: due, _min: { [spec.dueField]: true } }),
    delegate.count({ where: spec.builders.inFlight() }),
    delegate.count({ where: spec.builders.stale(now) }),
  ]);
  return {
    lastSuccessAt: iso(lastRow?.[spec.successField]),
    due: { count: dueCount, oldestDueAt: iso(oldest._min[spec.dueField]) },
    inFlight: { count: inFlightCount, staleCount },
  };
}

export async function computeReadiness(db: ReturnType<typeof getDb>, now = new Date()) {
  const d = db as unknown as Record<string, Delegate>;
  const [email, line, webhookRetry, learnerNotifications, trackingOutbox] = await Promise.all([
    job(d.emailDelivery!, now, { builders: readinessWhere.email, successWhere: { status: "sent" }, successField: "sentAt", dueField: "nextAttemptAt" }),
    job(d.lineDelivery!, now, { builders: readinessWhere.line, successWhere: { status: "sent" }, successField: "sentAt", dueField: "nextAttemptAt" }),
    job(d.webhookEvent!, now, { builders: readinessWhere.webhookRetry, successWhere: { status: "processed" }, successField: "processedAt", dueField: "nextRetryAt" }),
    job(d.learnerNotificationDelivery!, now, { builders: readinessWhere.learnerNotifications, successWhere: { dispatchedAt: { not: null } }, successField: "dispatchedAt", dueField: "nextAttemptAt" }),
    job(d.trackingDelivery!, now, { builders: readinessWhere.trackingOutbox, successWhere: { acceptedAt: { not: null } }, successField: "acceptedAt", dueField: "nextAttemptAt" }),
  ]);
  return { email, line, webhookRetry, learnerNotifications, trackingOutbox };
}

let cache: { at: number; value: Awaited<ReturnType<typeof computeReadiness>> } | null = null;

export async function cachedReadiness(db: ReturnType<typeof getDb>, now = new Date()) {
  if (cache && now.getTime() - cache.at < READINESS_CACHE_MS && now.getTime() >= cache.at) return cache.value;
  const value = await computeReadiness(db, now);
  cache = { at: now.getTime(), value };
  return value;
}

export function resetReadinessCacheForTests() { cache = null; }
