import { Prisma, type PrismaClient } from "@prisma/client";

/**
 * F-070 / B04-17: bounded retention sweep for operational data that has no
 * business need after a while.
 *
 * - WebhookEvent: the raw provider dump (`raw`, `diagnostics`) is removed from
 *   the payload; the row itself, its (provider, eventId) idempotency key and
 *   the already-redacted `normalized` block stay, because refund proofs and
 *   retry alerts read them and deleting the row would allow a replay.
 * - AnalyticsEvent: rows older than the window are deleted (their
 *   TrackingDelivery logs cascade).
 * - AuditLog: the IP address is cleared; the audit entry itself is kept.
 *
 * The windows are provisional defaults (180 / 365 / 365 days) until the owner
 * fixes them on legal advice; each can be overridden by an environment
 * variable. Values outside [MIN_DAYS, MAX_DAYS] are a configuration error.
 */

export const DATA_RETENTION_ENV = {
  webhookPayloadDays: "DATA_RETENTION_WEBHOOK_PAYLOAD_DAYS",
  analyticsEventDays: "DATA_RETENTION_ANALYTICS_EVENT_DAYS",
  auditLogIpDays: "DATA_RETENTION_AUDIT_LOG_IP_DAYS",
} as const;

export const DATA_RETENTION_DEFAULT_DAYS = {
  webhookPayloadDays: 180,
  analyticsEventDays: 365,
  auditLogIpDays: 365,
} as const;

const MIN_DAYS = 30;
const MAX_DAYS = 3650;
const DAY_MS = 86_400_000;
export const DATA_RETENTION_BATCH_SIZE = 1_000;
export const DATA_RETENTION_MAX_BATCHES = 20;
// Webhook events that may still be processed or need a human are never
// touched, whatever their age: in flight, awaiting retry, or awaiting manual
// reconciliation (MANUAL_RECONCILIATION_STATUS).
const PROTECTED_WEBHOOK_STATUSES = ["received", "retrying", "failed", "needs_manual_reconciliation"];

/** Server-side switch: the sweep writes nothing unless this is exactly "true". */
export const DATA_RETENTION_ENABLED_ENV = "DATA_RETENTION_ENABLED";

export function dataRetentionEnabled(env: Readonly<Record<string, string | undefined>> = process.env) {
  return env[DATA_RETENTION_ENABLED_ENV] === "true";
}

export type DataRetentionPolicy = Record<keyof typeof DATA_RETENTION_ENV, number>;

export class DataRetentionConfigError extends Error {
  constructor(public readonly setting: string) {
    super("Data retention configuration is invalid.");
    this.name = "DataRetentionConfigError";
  }
}

export function dataRetentionPolicy(env: Readonly<Record<string, string | undefined>> = process.env): DataRetentionPolicy {
  const policy = { ...DATA_RETENTION_DEFAULT_DAYS } as DataRetentionPolicy;
  for (const key of Object.keys(DATA_RETENTION_ENV) as Array<keyof typeof DATA_RETENTION_ENV>) {
    const name = DATA_RETENTION_ENV[key];
    const raw = env[name]?.trim();
    if (!raw) continue;
    if (!/^\d{1,5}$/.test(raw)) throw new DataRetentionConfigError(name);
    const days = Number(raw);
    if (days < MIN_DAYS || days > MAX_DAYS) throw new DataRetentionConfigError(name);
    policy[key] = days;
  }
  return policy;
}

export type DataRetentionResult = {
  webhookPayloadsPurged: number;
  analyticsEventsDeleted: number;
  auditLogIpsCleared: number;
  /** True when a category hit the per-run batch cap and needs another run. */
  remaining: boolean;
};

async function drain(step: () => Promise<number>, batchSize: number, maxBatches: number) {
  let total = 0;
  for (let batch = 0; batch < maxBatches; batch += 1) {
    const affected = await step();
    total += affected;
    if (affected < batchSize) return { total, remaining: false };
  }
  return { total, remaining: true };
}

/** Accepts a client or an interactive transaction; only raw statements are used. */
type RawExecutor = Pick<PrismaClient, "$executeRaw">;

export async function purgeExpiredData(
  db: RawExecutor,
  options: { now?: Date; policy?: DataRetentionPolicy; batchSize?: number; maxBatches?: number } = {},
): Promise<DataRetentionResult> {
  const now = options.now ?? new Date();
  const policy = options.policy ?? dataRetentionPolicy();
  const batchSize = options.batchSize ?? DATA_RETENTION_BATCH_SIZE;
  const maxBatches = options.maxBatches ?? DATA_RETENTION_MAX_BATCHES;
  const cutoff = (days: number) => new Date(now.getTime() - days * DAY_MS);

  const webhookCutoff = cutoff(policy.webhookPayloadDays);
  const purgedAt = now.toISOString();
  const webhook = await drain(() => db.$executeRaw`
    UPDATE "WebhookEvent"
       SET "payload" = ("payload" - 'raw' - 'diagnostics')
                       || jsonb_build_object('retentionPurgedAt', ${purgedAt}::text),
           "updatedAt" = ${now}
     WHERE "id" IN (
       SELECT "id" FROM "WebhookEvent"
        WHERE "createdAt" < ${webhookCutoff}
          AND "status" NOT IN (${Prisma.join(PROTECTED_WEBHOOK_STATUSES)})
          AND jsonb_typeof("payload") = 'object'
          AND jsonb_exists_any("payload", ARRAY['raw', 'diagnostics'])
        ORDER BY "id"
        LIMIT ${batchSize}
     )`, batchSize, maxBatches);

  const analyticsCutoff = cutoff(policy.analyticsEventDays);
  const analytics = await drain(() => db.$executeRaw`
    DELETE FROM "AnalyticsEvent"
     WHERE "id" IN (
       SELECT "id" FROM "AnalyticsEvent"
        WHERE "createdAt" < ${analyticsCutoff}
        ORDER BY "id"
        LIMIT ${batchSize}
     )`, batchSize, maxBatches);

  const auditCutoff = cutoff(policy.auditLogIpDays);
  const audit = await drain(() => db.$executeRaw`
    UPDATE "AuditLog"
       SET "ipAddress" = NULL
     WHERE "id" IN (
       SELECT "id" FROM "AuditLog"
        WHERE "createdAt" < ${auditCutoff}
          AND "ipAddress" IS NOT NULL
        ORDER BY "id"
        LIMIT ${batchSize}
     )`, batchSize, maxBatches);

  return {
    webhookPayloadsPurged: webhook.total,
    analyticsEventsDeleted: analytics.total,
    auditLogIpsCleared: audit.total,
    remaining: webhook.remaining || analytics.remaining || audit.remaining,
  };
}
