import { randomInt } from "node:crypto";
import { setTimeout as sleep } from "node:timers/promises";
import { StreamQuotaExceededError } from "@/lib/stream-quota";
import { getDb } from "@/lib/db";
import type { Prisma } from "@prisma/client";
import { parseLiveQuotaPolicy } from "@/lib/live-quota-policy";
import { resolveTeamFunnelAttribution } from "@/lib/team-funnel-attribution";
import { buildStreamUsageAllocations } from "@/lib/stream-usage-attribution";
import { assertStreamScopedQuotasAvailable } from "@/lib/stream-quota";
import { reserveVendorStreamSeconds } from "@/lib/stream-usage-counter";

export const STREAM_USAGE_MAX_HEARTBEAT_SECONDS = 60;
/** Attempts for a transaction aborted by a deadlock or write conflict (P2034). */
export const STREAM_USAGE_MAX_ATTEMPTS = 3;
const STREAM_USAGE_RETRY_BASE_MS = 15;
const STREAM_USAGE_RETRY_JITTER_MS = 25;
const STREAM_USAGE_EVENT_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SOURCE_PAGE_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/i;

export type StreamUsageErrorCode =
  | "invalid_event"
  | "invalid_duration"
  | "live_not_found"
  | "source_page_not_found"
  | "event_conflict"
  | "stream_minutes_exhausted"
  | "usage_busy";

export class StreamUsageValidationError extends Error {
  constructor(public readonly code: StreamUsageErrorCode) {
    super(code);
    this.name = "StreamUsageValidationError";
  }
}

type ExistingEntry = {
  id: string;
  vendorId: string;
  liveId: string;
  sourcePageId: string | null;
  teamId: string | null;
  templateVersionId: string | null;
  promoterMembershipId: string | null;
  contentOwnerMembershipId: string | null;
  eventId: string;
  monthKey: string;
  watchSeconds: number;
  source: string;
  policyVersion: number;
  attributionMode: string;
};

function monthKey(date: Date) {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`;
}

function normalizeSourcePageSlug(value: string | null | undefined) {
  if (value == null || value.trim() === "") return null;
  const normalized = value.trim().toLowerCase();
  if (!SOURCE_PAGE_PATTERN.test(normalized)) throw new StreamUsageValidationError("source_page_not_found");
  return normalized;
}

function assertUsageInput(eventId: string, watchSeconds: number) {
  if (!STREAM_USAGE_EVENT_ID_PATTERN.test(eventId)) throw new StreamUsageValidationError("invalid_event");
  if (!Number.isInteger(watchSeconds) || watchSeconds < 1 || watchSeconds > STREAM_USAGE_MAX_HEARTBEAT_SECONDS) {
    throw new StreamUsageValidationError("invalid_duration");
  }
}

function matchesExisting(
  existing: ExistingEntry,
  expected: Omit<ExistingEntry, "id" | "capturedAt" | "createdAt">,
) {
  return Object.entries(expected).every(([key, value]) => existing[key as keyof ExistingEntry] === value);
}

function isUniqueConflict(error: unknown) {
  return typeof error === "object" && error !== null && "code" in error && error.code === "P2002";
}

const RETRYABLE_POSTGRES_CODES = new Set(["40001", "40P01"]);
/**
 * Interactive transaction limits (R461-04). Heartbeats of one vendor queue on
 * the vendor-month counter row lock, and that wait counts toward `timeout`.
 */
export const STREAM_USAGE_TRANSACTION_OPTIONS = {
  isolationLevel: "ReadCommitted",
  maxWait: 5_000,
  timeout: 10_000,
} as const;

/** P2028: the transaction could not start or timed out (pool or lock wait). */
function isTransactionTimeout(error: unknown) {
  return typeof error === "object" && error !== null && "code" in error && error.code === "P2028";
}

/** P2034, or a raw-query failure (P2010) carrying a serialization/deadlock SQLSTATE. */
function isSerializationConflict(error: unknown) {
  if (typeof error !== "object" || error === null || !("code" in error)) return false;
  if (error.code === "P2034") return true;
  if (error.code !== "P2010" || !("meta" in error)) return false;
  const meta = error.meta;
  return typeof meta === "object" && meta !== null && "code" in meta
    && typeof meta.code === "string" && RETRYABLE_POSTGRES_CODES.has(meta.code);
}

/** Bounded backoff between transaction attempts; never longer than ~65 ms. */
export function streamUsageRetryDelayMs(attempt: number, jitter: number) {
  const boundedAttempt = Math.max(1, Math.min(STREAM_USAGE_MAX_ATTEMPTS - 1, Math.trunc(attempt) || 1));
  const boundedJitter = Math.max(0, Math.min(STREAM_USAGE_RETRY_JITTER_MS, Math.trunc(jitter) || 0));
  return STREAM_USAGE_RETRY_BASE_MS * boundedAttempt + boundedJitter;
}

type BuiltStreamUsageAllocations = ReturnType<typeof buildStreamUsageAllocations>;

async function assertConfiguredStreamQuotasAvailable(input: {
  tx: Prisma.TransactionClient;
  vendorId: string;
  liveId: string;
  monthKey: string;
  sourcePageId: string | null;
  policy: ReturnType<typeof parseLiveQuotaPolicy>;
  requestedWatchSeconds: number;
  allocations: BuiltStreamUsageAllocations;
}) {
  const pageQuota = input.sourcePageId
    ? input.policy.pageQuotas.find((quota) => quota.pageId === input.sourcePageId)
    : null;
  if (input.policy.memberQuotas.length === 0 && !pageQuota) return;

  const memberUsageGroups = input.policy.memberQuotas.length > 0
    ? await input.tx.streamUsageAllocationEntry.groupBy({
        by: ["recipientTeamId", "recipientMembershipId"],
        where: {
          vendorId: input.vendorId,
          liveId: input.liveId,
          monthKey: input.monthKey,
          recipientMembershipId: { in: input.policy.memberQuotas.map((quota) => quota.membershipId) },
        },
        _sum: { allocatedWatchSeconds: true },
      })
    : [];
  const currentMemberUsage = new Map(
    memberUsageGroups.map((group) => [
      `${group.recipientTeamId ?? ""}:${group.recipientMembershipId ?? ""}`,
      group._sum.allocatedWatchSeconds ?? 0,
    ]),
  );
  const currentPageUsageSeconds = pageQuota
    ? (await input.tx.streamUsageLedgerEntry.aggregate({
        where: { vendorId: input.vendorId, liveId: input.liveId, monthKey: input.monthKey, sourcePageId: input.sourcePageId },
        _sum: { watchSeconds: true },
      }))._sum.watchSeconds ?? 0
    : 0;
  assertStreamScopedQuotasAvailable({
    memberQuotas: input.policy.memberQuotas,
    pageQuotas: input.policy.pageQuotas,
    sourcePageId: input.sourcePageId,
    currentMemberUsage,
    currentPageUsageSeconds,
    requestedWatchSeconds: input.requestedWatchSeconds,
    requestedAllocations: input.allocations,
  });
}

/**
 * Reserves the heartbeat against the vendor's monthly quota with one atomic,
 * conditional increment of the vendor-month counter. The reservation locks
 * that row until the transaction ends; a real exhaustion is the only path to
 * StreamQuotaExceededError (never a concurrency conflict).
 */
async function reserveVendorStreamQuota(input: {
  tx: Prisma.TransactionClient;
  vendorId: string;
  monthKey: string;
  capturedAt: Date;
  requestedWatchSeconds: number;
}) {
  const usageLimit = await input.tx.vendorUsageLimit.findUnique({
    where: { vendorId: input.vendorId },
    select: { entitlementStatus: true, streamMinutesLimit: true, streamMinutesUsed: true, resetAt: true },
  });
  if (usageLimit?.entitlementStatus === "revoked") throw new StreamQuotaExceededError();
  const streamMinutesLimit = Math.max(0, usageLimit?.streamMinutesLimit ?? 0);
  const legacySeconds = usageLimit?.resetAt && usageLimit.resetAt > input.capturedAt
    ? Math.max(0, usageLimit.streamMinutesUsed ?? 0) * 60
    : 0;
  const reservation = await reserveVendorStreamSeconds(input.tx, {
    vendorId: input.vendorId,
    monthKey: input.monthKey,
    seconds: input.requestedWatchSeconds,
    limitSeconds: streamMinutesLimit > 0 ? streamMinutesLimit * 60 : null,
    floorSeconds: legacySeconds,
  });
  if (!reservation.admitted) throw new StreamQuotaExceededError();
  if (streamMinutesLimit <= 0) return null;
  return {
    streamMinutesLimit,
    usedSeconds: Math.max(reservation.previousSeconds, legacySeconds),
  };
}

async function upsertVendorQuotaAlert(input: {
  tx: Prisma.TransactionClient;
  vendorId: string;
  monthKey: string;
  streamMinutesLimit: number;
  previousSeconds: number;
  usedSeconds: number;
}) {
  const limitSeconds = input.streamMinutesLimit * 60;
  if (limitSeconds <= 0) return;

  const warningDedupKey = `stream-quota-warning:${input.vendorId}:${input.monthKey}`;
  const exhaustedDedupKey = `stream-quota-exhausted:${input.vendorId}:${input.monthKey}`;
  const systemActor = {
    id: "system",
    label: "stream-quota-monitor",
  };
  // Write only when this heartbeat crosses a threshold (R461-04): no extra
  // write while holding the counter lock, and an acknowledged alert is not
  // reopened by every later heartbeat of the month.
  const isExhausted = input.usedSeconds >= limitSeconds && input.previousSeconds < limitSeconds;
  const isWarning = input.usedSeconds * 100 >= limitSeconds * 80 && input.previousSeconds * 100 < limitSeconds * 80;

  if (isExhausted) {
    await input.tx.streamOperationsAlert.upsert({
      where: { dedupKey: exhaustedDedupKey },
      create: {
        vendorId: input.vendorId,
        type: "QUOTA_EXHAUSTED",
        status: "OPEN",
        dedupKey: exhaustedDedupKey,
        monthKey: input.monthKey,
        severity: "CRITICAL",
        message: "串流分鐘方案額度已用盡，新的播放心跳將依額度規則拒絕。",
        metadata: { usedSeconds: input.usedSeconds, limitSeconds },
      },
      update: {
        status: "OPEN",
        severity: "CRITICAL",
        message: "串流分鐘方案額度已用盡，新的播放心跳將依額度規則拒絕。",
        metadata: { usedSeconds: input.usedSeconds, limitSeconds },
        acknowledgedByActorId: null,
        acknowledgedByActorLabel: null,
        acknowledgedAt: null,
        resolvedByActorId: null,
        resolvedByActorLabel: null,
        resolvedAt: null,
      },
    });
    await input.tx.streamOperationsAlert.updateMany({
      where: { dedupKey: warningDedupKey, status: { in: ["OPEN", "ACKNOWLEDGED"] } },
      data: {
        status: "RESOLVED",
        resolvedByActorId: systemActor.id,
        resolvedByActorLabel: systemActor.label,
        resolvedAt: new Date(),
      },
    });
    return;
  }

  if (isWarning) {
    await input.tx.streamOperationsAlert.upsert({
      where: { dedupKey: warningDedupKey },
      create: {
        vendorId: input.vendorId,
        type: "QUOTA_WARNING",
        status: "OPEN",
        dedupKey: warningDedupKey,
        monthKey: input.monthKey,
        severity: "WARNING",
        message: "串流分鐘用量已達方案額度 80%，請留意剩餘可用時數。",
        metadata: { usedSeconds: input.usedSeconds, limitSeconds },
      },
      update: {
        status: "OPEN",
        severity: "WARNING",
        message: "串流分鐘用量已達方案額度 80%，請留意剩餘可用時數。",
        metadata: { usedSeconds: input.usedSeconds, limitSeconds },
        acknowledgedByActorId: null,
        acknowledgedByActorLabel: null,
        acknowledgedAt: null,
        resolvedByActorId: null,
        resolvedByActorLabel: null,
        resolvedAt: null,
      },
    });
  }
}

export async function recordStreamUsageLedgerEntry(input: {
  vendorId: string;
  liveId: string;
  sourcePageSlug?: string | null;
  liveShareCode?: string | null;
  eventId: string;
  watchSeconds: number;
  capturedAt?: Date;
}) {
  assertUsageInput(input.eventId, input.watchSeconds);
  const sourcePageSlug = normalizeSourcePageSlug(input.sourcePageSlug);
  const capturedAt = input.capturedAt ?? new Date();
  const currentMonthKey = monthKey(capturedAt);
  const db = getDb();

  const live = await db.live.findFirst({
    where: {
      id: input.liveId,
      vendorId: input.vendorId,
      OR: [
        { status: { in: ["scheduled", "live"] } },
        { status: "ended", replayEnabled: true },
      ],
    },
    select: { id: true, teamId: true, seminarOwnerMembershipId: true, quotaPolicy: true },
  });
  if (!live) throw new StreamUsageValidationError("live_not_found");

  const attribution = input.liveShareCode
    ? await resolveTeamFunnelAttribution({
        vendorId: input.vendorId,
        liveId: input.liveId,
        sourcePageSlug: null,
        liveShareCode: input.liveShareCode,
        referral: null,
        now: capturedAt,
      })
    : sourcePageSlug
    ? await resolveTeamFunnelAttribution({
        vendorId: input.vendorId,
        liveId: input.liveId,
        sourcePageSlug,
        referral: null,
        now: capturedAt,
      })
    : null;
  if ((sourcePageSlug || input.liveShareCode) && !attribution) throw new StreamUsageValidationError("source_page_not_found");

  const policy = parseLiveQuotaPolicy(live.quotaPolicy);
  const source = attribution ? (input.liveShareCode ? "TEAM_FUNNEL_LIVE_SHARE" : "TEAM_FUNNEL_PAGE") : "DIRECT_PLAYBACK";
  const allocations = buildStreamUsageAllocations({
    policy,
    watchSeconds: input.watchSeconds,
    source,
    teamId: attribution?.teamId ?? live.teamId,
    liveOwnerMembershipId: live.seminarOwnerMembershipId,
    promoterMembershipId: attribution?.promoterMembershipId ?? null,
    contentOwnerMembershipId: attribution?.contentOwnerMembershipId ?? null,
  });
  const sourcePageId = attribution?.sourcePageId ?? null;

  const expected = {
    vendorId: input.vendorId,
    liveId: input.liveId,
    sourcePageId,
    teamId: attribution?.teamId ?? null,
    templateVersionId: attribution?.templateVersionId ?? null,
    promoterMembershipId: attribution?.promoterMembershipId ?? null,
    contentOwnerMembershipId: attribution?.contentOwnerMembershipId ?? null,
    eventId: input.eventId,
    monthKey: currentMonthKey,
    watchSeconds: input.watchSeconds,
    source,
    policyVersion: policy.version,
    attributionMode: policy.usageAttributionMode,
  } as const;

  const recordWithinTransaction = (tx: Prisma.TransactionClient) => recordInTransaction(tx, {
    input,
    expected,
    currentMonthKey,
    capturedAt,
    sourcePageId,
    policy,
    allocations,
  });

  try {
    return await runUsageTransaction(db, recordWithinTransaction);
  } catch (error) {
    if (!isUniqueConflict(error)) throw error;
    const concurrent = await db.streamUsageLedgerEntry.findUnique({ where: { eventId: input.eventId } }) as ExistingEntry | null;
    if (concurrent && matchesExisting(concurrent, expected)) {
      return { duplicate: true, entryId: concurrent.id, source: concurrent.source };
    }
    throw new StreamUsageValidationError("event_conflict");
  }
}

/**
 * READ COMMITTED: the vendor-month counter row lock taken by the quota
 * reservation serializes one vendor's heartbeats; no Serializable predicate
 * read is left to abort concurrent viewers. A deadlock or write conflict is
 * retried and finally reported as retryable `usage_busy`, never as quota
 * exhaustion (F-092).
 */
async function runUsageTransaction<T>(
  db: ReturnType<typeof getDb>,
  work: (tx: Prisma.TransactionClient) => Promise<T>,
): Promise<T> {
  for (let attempt = 1; attempt <= STREAM_USAGE_MAX_ATTEMPTS; attempt += 1) {
    try {
      return await db.$transaction(work, STREAM_USAGE_TRANSACTION_OPTIONS);
    } catch (error) {
      // A saturated lock queue or pool is retryable for the browser, not a
      // 500; retrying it here would only lengthen the queue.
      if (isTransactionTimeout(error)) throw new StreamUsageValidationError("usage_busy");
      if (!isSerializationConflict(error)) throw error;
      if (attempt === STREAM_USAGE_MAX_ATTEMPTS) break;
      await sleep(streamUsageRetryDelayMs(attempt, randomInt(0, STREAM_USAGE_RETRY_JITTER_MS + 1)));
    }
  }
  throw new StreamUsageValidationError("usage_busy");
}

type ExpectedEntry = Omit<ExistingEntry, "id">;

async function recordInTransaction(tx: Prisma.TransactionClient, context: {
  input: { vendorId: string; liveId: string; eventId: string; watchSeconds: number };
  expected: ExpectedEntry;
  currentMonthKey: string;
  capturedAt: Date;
  sourcePageId: string | null;
  policy: ReturnType<typeof parseLiveQuotaPolicy>;
  allocations: BuiltStreamUsageAllocations;
}) {
  const { input, expected, currentMonthKey, capturedAt, sourcePageId, policy, allocations } = context;
  const existing = await tx.streamUsageLedgerEntry.findUnique({ where: { eventId: input.eventId } }) as ExistingEntry | null;
  if (existing) {
    if (!matchesExisting(existing, expected)) throw new StreamUsageValidationError("event_conflict");
    return { duplicate: true, entryId: existing.id, source: existing.source };
  }

  const vendorQuota = await reserveVendorStreamQuota({
    tx,
    vendorId: input.vendorId,
    monthKey: currentMonthKey,
    capturedAt,
    requestedWatchSeconds: input.watchSeconds,
  });

  await assertConfiguredStreamQuotasAvailable({
    tx,
    vendorId: input.vendorId,
    liveId: input.liveId,
    monthKey: currentMonthKey,
    sourcePageId,
    policy,
    requestedWatchSeconds: input.watchSeconds,
    allocations,
  });

  const entry = await tx.streamUsageLedgerEntry.create({
    data: {
      ...expected,
      capturedAt,
      allocations: {
        // vendorId is implied by the parent ledger row (composite FK); Prisma
        // rejects it here, which used to fail every real heartbeat write.
        create: allocations.map((allocation) => ({
          liveId: input.liveId,
          monthKey: currentMonthKey,
          recipientKey: allocation.recipientKey,
          recipientType: allocation.recipientType,
          recipientTeamId: allocation.recipientTeamId,
          recipientMembershipId: allocation.recipientMembershipId,
          allocationBps: allocation.allocationBps,
          allocatedWatchSeconds: allocation.allocatedWatchSeconds,
          policyVersion: policy.version,
          attributionMode: policy.usageAttributionMode,
        })),
      },
    },
    select: { id: true, source: true },
  });
  if (vendorQuota) {
    await upsertVendorQuotaAlert({
      tx,
      vendorId: input.vendorId,
      monthKey: currentMonthKey,
      streamMinutesLimit: vendorQuota.streamMinutesLimit,
      previousSeconds: vendorQuota.usedSeconds,
      usedSeconds: vendorQuota.usedSeconds + input.watchSeconds,
    });
  }
  return { duplicate: false, entryId: entry.id, source: entry.source };
}
