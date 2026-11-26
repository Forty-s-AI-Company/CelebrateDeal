import { Prisma, type PrismaClient } from "@prisma/client";
import { reconcileLiveRuntimeState, type LiveRuntimeDatabase } from "@/lib/live-runtime-state";
import { captureOperationalError } from "@/lib/monitoring";

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
 * - LiveViewerProfile (viewer nicknames): deleted once the profile has been
 *   idle for 30 days and its live ended and closed its replay more than 30
 *   days ago, or once it has been idle for 180 days whatever the live (an
 *   evergreen live never ends). Before that, VOD lives with no persisted end
 *   are reconciled with the shared runtime rules (live-runtime-state.ts), so
 *   the end is not missed just because nobody opened the page afterwards.
 *   The same statement clears the messages' viewerProfileId and stamps
 *   viewerProfileRemovedAt, so the room shows "觀眾" for them, never the
 *   registration name; the message rows themselves stay.
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

/** Days after a live ended (and its replay closed) before its viewer nicknames are deleted. */
export const LIVE_VIEWER_PROFILE_RETENTION_DAYS = 30;
/** Idle days after which a nickname is deleted whatever its live (evergreen never ends). */
export const LIVE_VIEWER_PROFILE_IDLE_DAYS = 180;
/** Lives reconciled per sweep before the nickname purge. */
const LIVE_RECONCILE_LIMIT = 200;

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
  liveViewerProfilesDeleted: number;
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
type RawExecutor = Pick<PrismaClient, "$executeRaw" | "$queryRaw"> & LiveRuntimeDatabase;

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

  // Fixed windows (not configurable): nicknames have no use after the room closed.
  const profileCutoff = cutoff(LIVE_VIEWER_PROFILE_RETENTION_DAYS);
  const idleCutoff = cutoff(LIVE_VIEWER_PROFILE_IDLE_DAYS);
  // A scheduled VOD only gets its persisted end when someone loads it after
  // it finished; settle that from the shared runtime rules first, oldest idle
  // profiles first. One live failing is logged and skipped, never the sweep.
  const unsettled = await db.$queryRaw<Array<{ vendorId: string; liveId: string }>>`
    SELECT "live"."vendorId", "live"."id" AS "liveId"
      FROM "LiveViewerProfile" "profile"
      JOIN "Live" "live" ON "live"."vendorId" = "profile"."vendorId" AND "live"."id" = "profile"."liveId"
     WHERE "profile"."lastActiveAt" < ${profileCutoff}
       AND "live"."endedAt" IS NULL
       AND "live"."streamMode" = 'vod'
       AND "live"."videoId" IS NOT NULL
       AND "live"."isEvergreen" = false
     GROUP BY "live"."vendorId", "live"."id"
     ORDER BY MIN("profile"."lastActiveAt") ASC, "live"."id" ASC
     LIMIT ${LIVE_RECONCILE_LIMIT}`;
  for (const live of unsettled) {
    try {
      await reconcileLiveRuntimeState(db, { vendorId: live.vendorId, liveId: live.liveId, now });
    } catch (error) {
      captureOperationalError(error, { source: "data_retention", operation: "live_viewer_profile_reconcile" }, { level: "warning" });
    }
  }
  // Delete first and detach only what was deleted, in one statement (the
  // NO ACTION foreign key is checked at its end). The DELETE repeats the
  // idle conditions: a viewer who posts while this runs refreshes
  // lastActiveAt in the same transaction as the message, so after waiting
  // for that row lock PostgreSQL re-checks the new row version and keeps the
  // profile instead of failing the batch on the new message's foreign key.
  const profiles = await drain(async () => {
    const [row] = await db.$queryRaw<Array<{ count: number }>>`
      WITH "doomed" AS (
        SELECT "profile"."id"
          FROM "LiveViewerProfile" "profile"
          JOIN "Live" "live" ON "live"."vendorId" = "profile"."vendorId" AND "live"."id" = "profile"."liveId"
         WHERE "profile"."lastActiveAt" < ${idleCutoff}
            OR ("profile"."lastActiveAt" < ${profileCutoff}
                AND "live"."endedAt" IS NOT NULL
                AND "live"."endedAt" < ${profileCutoff}
                AND ("live"."replayEnabled" = false
                     OR ("live"."replayAvailableUntil" IS NOT NULL AND "live"."replayAvailableUntil" < ${profileCutoff})))
         ORDER BY "profile"."id"
         LIMIT ${batchSize}
      ), "deleted" AS (
        DELETE FROM "LiveViewerProfile"
         WHERE "id" IN (SELECT "id" FROM "doomed")
           AND "lastActiveAt" < ${profileCutoff}
        RETURNING "id"
      ), "detached" AS (
        UPDATE "LiveChatMessage"
           SET "viewerProfileId" = NULL,
               "viewerProfileRemovedAt" = ${now}
         WHERE "viewerProfileId" IN (SELECT "id" FROM "deleted")
      )
      SELECT COUNT(*)::int AS "count" FROM "deleted"`;
    return row?.count ?? 0;
  }, batchSize, maxBatches);

  return {
    webhookPayloadsPurged: webhook.total,
    analyticsEventsDeleted: analytics.total,
    auditLogIpsCleared: audit.total,
    liveViewerProfilesDeleted: profiles.total,
    remaining: webhook.remaining || analytics.remaining || audit.remaining || profiles.remaining,
  };
}
