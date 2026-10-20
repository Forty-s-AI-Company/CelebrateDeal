import { requireCronSecret, unauthorizedJson } from "@/lib/api-security";
import { getDb } from "@/lib/db";

const NO_STORE = { "Cache-Control": "no-store" } as const;
/** Queue rows that still need a worker; terminal states are intentionally excluded. */
const PENDING = ["queued", "sending"];

type JobReadiness = {
  lastSuccessAt: string | null;
  queueDepth: number;
  oldestPendingAt: string | null;
};

type Db = ReturnType<typeof getDb>;

function iso(value: Date | null | undefined) {
  return value ? value.toISOString() : null;
}

async function job(
  lastSuccess: () => Promise<Date | null | undefined>,
  depth: () => Promise<number>,
  oldest: () => Promise<Date | null | undefined>,
): Promise<JobReadiness> {
  const [last, queueDepth, oldestPending] = await Promise.all([lastSuccess(), depth(), oldest()]);
  return { lastSuccessAt: iso(last), queueDepth, oldestPendingAt: iso(oldestPending) };
}

/**
 * F-142: unlike /api/health (DB ping only), this reports background job lag.
 * Only aggregate timestamps and counts are returned; no tenant, recipient or
 * payload data. Derived from existing delivery rows, so no schema change.
 */
async function readiness(db: Db) {
  const pending = { status: { in: PENDING } };
  const [email, line, webhookRetry, learnerNotifications, trackingOutbox] = await Promise.all([
    job(
      async () => (await db.emailDelivery.aggregate({ _max: { sentAt: true } }))._max.sentAt,
      () => db.emailDelivery.count({ where: pending }),
      async () => (await db.emailDelivery.aggregate({ where: pending, _min: { createdAt: true } }))._min.createdAt,
    ),
    job(
      async () => (await db.lineDelivery.aggregate({ _max: { sentAt: true } }))._max.sentAt,
      () => db.lineDelivery.count({ where: pending }),
      async () => (await db.lineDelivery.aggregate({ where: pending, _min: { createdAt: true } }))._min.createdAt,
    ),
    job(
      async () => (await db.webhookEvent.aggregate({ _max: { processedAt: true } }))._max.processedAt,
      () => db.webhookEvent.count({ where: { status: "retrying" } }),
      async () => (await db.webhookEvent.aggregate({ where: { status: "retrying" }, _min: { createdAt: true } }))._min.createdAt,
    ),
    job(
      async () => (await db.learnerNotificationDelivery.aggregate({ _max: { dispatchedAt: true } }))._max.dispatchedAt,
      () => db.learnerNotificationDelivery.count({ where: pending }),
      async () => (await db.learnerNotificationDelivery.aggregate({ where: pending, _min: { createdAt: true } }))._min.createdAt,
    ),
    job(
      async () => (await db.trackingDelivery.aggregate({ _max: { acceptedAt: true } }))._max.acceptedAt,
      () => db.trackingDelivery.count({ where: pending }),
      async () => (await db.trackingDelivery.aggregate({ where: pending, _min: { createdAt: true } }))._min.createdAt,
    ),
  ]);
  return { email, line, webhookRetry, learnerNotifications, trackingOutbox };
}

export async function GET(request: Request) {
  if (!requireCronSecret(request)) return unauthorizedJson();
  try {
    const jobs = await readiness(getDb());
    return Response.json({ ok: true, checkedAt: new Date().toISOString(), jobs }, { headers: NO_STORE });
  } catch {
    return Response.json({ ok: false, error: "Readiness check failed" }, { status: 503, headers: NO_STORE });
  }
}
