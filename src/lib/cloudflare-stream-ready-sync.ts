import { consumeAccountRateLimit, type AccountRateLimitScope } from "@/lib/account-rate-limit";
import {
  CloudflareStreamError,
  cloudflareStreamConfigured,
  getStreamVideoStatus,
  type CloudflareStreamErrorCode,
} from "@/lib/cloudflare-stream";
import {
  applyCloudflareStreamProviderState,
  CloudflareStreamProviderPayload,
} from "@/lib/cloudflare-stream-video-sync";
import type { convergeCloudflareVideoTransition } from "@/lib/cloudflare-video-transition";
import { getDb } from "@/lib/db";
import { captureOperationalError } from "@/lib/monitoring";

/**
 * Cloudflare Stream ready fallback (A4-04).
 *
 * The signed webhook (`/api/cloudflare/stream-webhook`) is the primary way a
 * video becomes ready. A Cloudflare account has exactly one webhook URL, so
 * every other environment (staging while the URL points at Production, or
 * Production after a lost delivery) would leave `cloudflareReadyToStream`
 * false forever. This module asks Cloudflare directly with the read-only
 * `GET /accounts/{account}/stream/{uid}` and, only when it reports
 * `readyToStream: true`, hands the response to the same
 * `applyCloudflareStreamProviderState` the webhook uses. Not-ready, error and
 * timeout answers never write.
 *
 * Two callers, both rate limited through `AccountRateLimitBucket` (a
 * PostgreSQL counter shared by every instance):
 * - `runStreamReadySync`: the `stream-ready-sync` scheduled job.
 * - `syncStreamVideoReadyForOps`: the secret-gated ops status endpoint
 *   `GET /api/admin/ops/cloudflare/direct-upload`, so the staging smoke does
 *   not wait for the schedule.
 *
 * Results and logs carry counts and fixed category names only: never the
 * API token, a signed URL, a provider message or a provider UID.
 */

/** A video becomes eligible this long after its upload mapping was written. */
export const STREAM_READY_SYNC_MIN_AGE_MS = 5 * 60_000;
/** Videos still not ready this long after upload leave the scan. */
export const STREAM_READY_SYNC_MAX_AGE_MS = 24 * 60 * 60_000;
/** Cloudflare calls per run (throttled videos do not count). */
export const STREAM_READY_SYNC_BATCH_LIMIT = 10;
/** Candidate rows read per run, newest upload first. */
export const STREAM_READY_SYNC_SCAN_LIMIT = 100;
/** No new Cloudflare call starts after this long; the rest wait for the next run. */
export const STREAM_READY_SYNC_DEADLINE_MS = 30_000;
/** One scheduled Cloudflare call may take this long before it counts as a network error. */
export const STREAM_READY_SYNC_QUERY_TIMEOUT_MS = 8_000;
/** One ops-endpoint Cloudflare call, kept below the smoke's own 15 s request cap. */
export const STREAM_READY_OPS_QUERY_TIMEOUT_MS = 5_000;

const FAST_TIER_MAX_AGE_MS = 60 * 60_000;
const MEDIUM_TIER_MAX_AGE_MS = 6 * 60 * 60_000;

type StreamReadyDatabase = ReturnType<typeof getDb>;

export type StreamReadyPollScope = Extract<AccountRateLimitScope, `stream_ready_poll_${string}`>;
export type StreamReadyThrottle = (scope: StreamReadyPollScope, subject: string) => Promise<{ allowed: boolean }>;
type FetchStreamStatus = typeof getStreamVideoStatus;

export type StreamReadyErrorCode = CloudflareStreamErrorCode | "internal_failure";

export type StreamReadyPollOutcome =
  | "updated"
  | "unchanged"
  | "not_ready"
  | "provider_error"
  | "unmapped"
  | "ambiguous"
  | "scope_mismatch"
  | "contention_exhausted";

export type StreamReadyPollResult = {
  outcome: StreamReadyPollOutcome;
  /** Set for `provider_error` only: a fixed category, never a provider message. */
  errorCode?: StreamReadyErrorCode;
};

function defaultThrottle(db: StreamReadyDatabase): StreamReadyThrottle {
  return (scope, subject) => consumeAccountRateLimit(scope, subject, db);
}

function classifyPollError(error: unknown): StreamReadyErrorCode {
  return error instanceof CloudflareStreamError ? error.code : "internal_failure";
}

/** Back-off tier by age since upload: every run for the first hour, then about every 30 min, then every 2 h. */
export function streamReadyPollScope(ageMs: number): StreamReadyPollScope {
  if (ageMs < FAST_TIER_MAX_AGE_MS) return "stream_ready_poll_fast";
  if (ageMs < MEDIUM_TIER_MAX_AGE_MS) return "stream_ready_poll_medium";
  return "stream_ready_poll_slow";
}

/**
 * Asks Cloudflare about one known video and, when it is ready, applies the
 * answer through the webhook's transition code bound to this video and
 * vendor. Database errors propagate; provider errors are returned as a
 * category and write nothing.
 */
export async function pollCloudflareStreamVideoReady({
  db,
  video,
  fetchStatus = getStreamVideoStatus,
  timeoutMs = STREAM_READY_SYNC_QUERY_TIMEOUT_MS,
  converge,
}: {
  db: StreamReadyDatabase;
  video: { id: string; vendorId: string; cloudflareStreamUid: string };
  fetchStatus?: FetchStreamStatus;
  timeoutMs?: number;
  converge?: typeof convergeCloudflareVideoTransition;
}): Promise<StreamReadyPollResult> {
  let details: Awaited<ReturnType<FetchStreamStatus>>;
  try {
    details = await fetchStatus(video.cloudflareStreamUid, { timeoutMs });
  } catch (error) {
    return { outcome: "provider_error", errorCode: classifyPollError(error) };
  }

  if (details.uid !== video.cloudflareStreamUid) {
    return { outcome: "provider_error", errorCode: "invalid_response" };
  }
  if (details.readyToStream !== true) return { outcome: "not_ready" };

  // The same schema the webhook body must pass (duration bounds included).
  const payload = CloudflareStreamProviderPayload.safeParse(details);
  if (!payload.success) return { outcome: "provider_error", errorCode: "invalid_response" };

  const applied = await applyCloudflareStreamProviderState({
    db,
    payload: payload.data,
    expectedVideo: { id: video.id, vendorId: video.vendorId },
    ...(converge ? { converge } : {}),
  });
  switch (applied.outcome) {
    case "updated":
    case "unchanged":
    case "unmapped":
    case "ambiguous":
    case "scope_mismatch":
    case "contention_exhausted":
      return { outcome: applied.outcome };
    case "unsupported_status":
      // Unreachable: readyToStream is true, which always maps to "ready".
      return { outcome: "provider_error", errorCode: "invalid_response" };
  }
}

export type StreamReadySyncSummary = {
  /** `provider_unavailable`: Cloudflare Stream is not configured here; nothing scanned or queried. */
  skipped?: "provider_unavailable";
  candidates: number;
  /** Cloudflare calls made. */
  queried: number;
  /** Candidates inside their back-off window (no call). */
  throttled: number;
  /** Candidates left for the next run by the batch limit or the deadline. */
  deferred: number;
  /** Videos this run made ready. */
  updated: number;
  /** Ready at Cloudflare and already ready here (a webhook or another run won). */
  unchanged: number;
  notReady: number;
  /** Cloudflare errors, timeouts or unusable answers (nothing written). */
  providerErrors: number;
  /** The UID no longer maps to exactly this video and vendor (nothing written). */
  mappingSkipped: number;
  contention: number;
  /** Database or throttle failures (reported; the next run tries again). */
  errors: number;
};

function emptySummary(): StreamReadySyncSummary {
  return {
    candidates: 0,
    queried: 0,
    throttled: 0,
    deferred: 0,
    updated: 0,
    unchanged: 0,
    notReady: 0,
    providerErrors: 0,
    mappingSkipped: 0,
    contention: 0,
    errors: 0,
  };
}

/** Interleaves candidates vendor by vendor, keeping each vendor's own order. */
function roundRobinByVendor<T extends { vendorId: string }>(rows: T[]) {
  const queues = new Map<string, T[]>();
  for (const row of rows) {
    const queue = queues.get(row.vendorId);
    if (queue) queue.push(row);
    else queues.set(row.vendorId, [row]);
  }
  const ordered: T[] = [];
  const active = [...queues.values()];
  while (active.length > 0) {
    for (let index = 0; index < active.length; ) {
      const next = active[index]!.shift();
      if (next) ordered.push(next);
      if (active[index]!.length === 0) active.splice(index, 1);
      else index += 1;
    }
  }
  return ordered;
}

function reportRun(summary: StreamReadySyncSummary, firstErrorCode: StreamReadyErrorCode | null) {
  try {
    if (summary.providerErrors > 0) {
      captureOperationalError(new Error("Cloudflare Stream ready sync provider query failed"), {
        source: "stream_ready_sync_job",
        operation: "provider_query",
        provider: "cloudflare_stream",
        status: firstErrorCode ?? "internal_failure",
        count: summary.providerErrors,
      }, { level: "warning" });
    }
    const failures = summary.errors + summary.contention;
    if (failures > 0) {
      captureOperationalError(new Error("Cloudflare Stream ready sync could not apply a result"), {
        source: "stream_ready_sync_job",
        operation: "apply",
        provider: "cloudflare_stream",
        status: summary.errors > 0 ? "failed" : "contention_exhausted",
        count: failures,
      });
    }
  } catch {
    // Monitoring is best-effort; the job summary stays authoritative.
  }
}

/**
 * One run of the scheduled fallback: Cloudflare Stream uploads still
 * `processing` and not ready, whose mapping was written between
 * STREAM_READY_SYNC_MIN_AGE_MS and STREAM_READY_SYNC_MAX_AGE_MS ago
 * (`updatedAt`, which a replacement upload resets), newest first,
 * round-robin across vendors, at most STREAM_READY_SYNC_BATCH_LIMIT calls and
 * no new call after STREAM_READY_SYNC_DEADLINE_MS. Each video is also held to
 * its own back-off (`streamReadyPollScope`).
 */
export async function runStreamReadySync({
  db = getDb(),
  now = () => Date.now(),
  configured = cloudflareStreamConfigured(),
  fetchStatus = getStreamVideoStatus,
  throttle,
  batchLimit = STREAM_READY_SYNC_BATCH_LIMIT,
  scanLimit = STREAM_READY_SYNC_SCAN_LIMIT,
  deadlineMs = STREAM_READY_SYNC_DEADLINE_MS,
  converge,
}: {
  db?: StreamReadyDatabase;
  now?: () => number;
  configured?: boolean;
  fetchStatus?: FetchStreamStatus;
  throttle?: StreamReadyThrottle;
  batchLimit?: number;
  scanLimit?: number;
  deadlineMs?: number;
  converge?: typeof convergeCloudflareVideoTransition;
} = {}): Promise<StreamReadySyncSummary> {
  const summary = emptySummary();
  if (!configured) return { ...summary, skipped: "provider_unavailable" };
  const consume = throttle ?? defaultThrottle(db);
  const startedAt = now();

  const rows = await db.video.findMany({
    where: {
      cloudflareStreamUid: { not: null },
      cloudflareReadyToStream: false,
      status: "processing",
      updatedAt: {
        lte: new Date(startedAt - STREAM_READY_SYNC_MIN_AGE_MS),
        gte: new Date(startedAt - STREAM_READY_SYNC_MAX_AGE_MS),
      },
    },
    select: { id: true, vendorId: true, cloudflareStreamUid: true, updatedAt: true },
    orderBy: [{ updatedAt: "desc" }, { id: "asc" }],
    take: scanLimit,
  });
  const candidates = roundRobinByVendor(rows.flatMap((row) => (
    row.cloudflareStreamUid ? [{ ...row, cloudflareStreamUid: row.cloudflareStreamUid }] : []
  )));
  summary.candidates = candidates.length;

  let firstErrorCode: StreamReadyErrorCode | null = null;
  for (const [index, video] of candidates.entries()) {
    if (summary.queried >= batchLimit || now() - startedAt >= deadlineMs) {
      summary.deferred = candidates.length - index;
      break;
    }

    let allowed: boolean;
    try {
      ({ allowed } = await consume(streamReadyPollScope(startedAt - video.updatedAt.getTime()), video.id));
    } catch {
      // Fail closed: without the shared counter no call is made.
      summary.errors += 1;
      continue;
    }
    if (!allowed) {
      summary.throttled += 1;
      continue;
    }

    summary.queried += 1;
    let result: StreamReadyPollResult;
    try {
      result = await pollCloudflareStreamVideoReady({
        db,
        video,
        fetchStatus,
        timeoutMs: STREAM_READY_SYNC_QUERY_TIMEOUT_MS,
        ...(converge ? { converge } : {}),
      });
    } catch {
      summary.errors += 1;
      continue;
    }

    switch (result.outcome) {
      case "updated": summary.updated += 1; break;
      case "unchanged": summary.unchanged += 1; break;
      case "not_ready": summary.notReady += 1; break;
      case "provider_error":
        summary.providerErrors += 1;
        firstErrorCode ??= result.errorCode ?? "internal_failure";
        break;
      case "unmapped":
      case "ambiguous":
      case "scope_mismatch":
        summary.mappingSkipped += 1;
        break;
      case "contention_exhausted": summary.contention += 1; break;
    }
  }

  reportRun(summary, firstErrorCode);
  return summary;
}

export type StreamReadyOpsCheck =
  | { outcome: "provider_unavailable" | "throttled" | "throttle_unavailable" | "error" }
  | StreamReadyPollResult;

/**
 * The ops status endpoint's on-read check for one not-ready video it has
 * already bound to the smoke vendor: at most one Cloudflare call per video per
 * 15 s and 12 per minute overall, each capped at 5 s.
 */
export async function syncStreamVideoReadyForOps({
  db = getDb(),
  video,
  configured = cloudflareStreamConfigured(),
  fetchStatus = getStreamVideoStatus,
  throttle,
}: {
  db?: StreamReadyDatabase;
  video: { id: string; vendorId: string; cloudflareStreamUid: string };
  configured?: boolean;
  fetchStatus?: FetchStreamStatus;
  throttle?: StreamReadyThrottle;
}): Promise<StreamReadyOpsCheck> {
  if (!configured) return { outcome: "provider_unavailable" };
  const consume = throttle ?? defaultThrottle(db);
  try {
    if (!(await consume("stream_ready_poll_ops_video", video.id)).allowed) return { outcome: "throttled" };
    if (!(await consume("stream_ready_poll_ops_global", "all")).allowed) return { outcome: "throttled" };
  } catch {
    return { outcome: "throttle_unavailable" };
  }
  try {
    return await pollCloudflareStreamVideoReady({
      db,
      video,
      fetchStatus,
      timeoutMs: STREAM_READY_OPS_QUERY_TIMEOUT_MS,
    });
  } catch {
    return { outcome: "error" };
  }
}
