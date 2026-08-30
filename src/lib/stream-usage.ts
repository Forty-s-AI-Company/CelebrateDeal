import { getDb } from "@/lib/db";
import type { Prisma } from "@prisma/client";
import { parseLiveQuotaPolicy } from "@/lib/live-quota-policy";
import { resolveTeamFunnelAttribution } from "@/lib/team-funnel-attribution";
import { buildStreamUsageAllocations } from "@/lib/stream-usage-attribution";
import { assertStreamQuotaAvailable, assertStreamScopedQuotasAvailable } from "@/lib/stream-quota";

export const STREAM_USAGE_MAX_HEARTBEAT_SECONDS = 60;
const STREAM_USAGE_EVENT_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SOURCE_PAGE_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/i;

export type StreamUsageErrorCode =
  | "invalid_event"
  | "invalid_duration"
  | "live_not_found"
  | "source_page_not_found"
  | "event_conflict"
  | "stream_minutes_exhausted";

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

function isSerializationConflict(error: unknown) {
  return typeof error === "object" && error !== null && "code" in error && error.code === "P2034";
}

function throwForSerializationConflict(error: unknown) {
  if (isSerializationConflict(error)) throw new StreamUsageValidationError("stream_minutes_exhausted");
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

async function assertVendorStreamQuotaAvailable(input: {
  tx: Prisma.TransactionClient;
  vendorId: string;
  monthKey: string;
  capturedAt: Date;
  requestedWatchSeconds: number;
}) {
  const usageLimit = await input.tx.vendorUsageLimit.findUnique({
    where: { vendorId: input.vendorId },
    select: { streamMinutesLimit: true, streamMinutesUsed: true, resetAt: true },
  });
  const streamMinutesLimit = usageLimit?.streamMinutesLimit ?? 0;
  if (streamMinutesLimit <= 0) return null;
  const ledgerUsage = await input.tx.streamUsageLedgerEntry.aggregate({
    where: { vendorId: input.vendorId, monthKey: input.monthKey },
    _sum: { watchSeconds: true },
  });
  const ledgerSeconds = ledgerUsage._sum.watchSeconds ?? 0;
  const legacySeconds = usageLimit?.resetAt && usageLimit.resetAt > input.capturedAt
    ? (usageLimit.streamMinutesUsed ?? 0) * 60
    : 0;
  assertStreamQuotaAvailable({
    includedMinutes: streamMinutesLimit,
    usedSeconds: Math.max(ledgerSeconds, legacySeconds),
    requestedSeconds: input.requestedWatchSeconds,
  });
  return {
    streamMinutesLimit,
    usedSeconds: Math.max(ledgerSeconds, legacySeconds),
  };
}

async function upsertVendorQuotaAlert(input: {
  tx: Prisma.TransactionClient;
  vendorId: string;
  monthKey: string;
  streamMinutesLimit: number;
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
  const isExhausted = input.usedSeconds >= limitSeconds;
  const isWarning = input.usedSeconds * 100 >= limitSeconds * 80;

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

  try {
    return await db.$transaction(async (tx) => {
      const existing = await tx.streamUsageLedgerEntry.findUnique({ where: { eventId: input.eventId } }) as ExistingEntry | null;
      if (existing) {
        if (!matchesExisting(existing, expected)) throw new StreamUsageValidationError("event_conflict");
        return { duplicate: true, entryId: existing.id, source: existing.source };
      }

      const vendorQuota = await assertVendorStreamQuotaAvailable({
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
            create: allocations.map((allocation) => ({
              vendorId: input.vendorId,
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
          usedSeconds: vendorQuota.usedSeconds + input.watchSeconds,
        });
      }
      return { duplicate: false, entryId: entry.id, source: entry.source };
    }, { isolationLevel: "Serializable" });
  } catch (error) {
    throwForSerializationConflict(error);
    if (!isUniqueConflict(error)) throw error;
    const concurrent = await db.streamUsageLedgerEntry.findUnique({ where: { eventId: input.eventId } }) as ExistingEntry | null;
    if (concurrent && matchesExisting(concurrent, expected)) {
      return { duplicate: true, entryId: concurrent.id, source: concurrent.source };
    }
    throw new StreamUsageValidationError("event_conflict");
  }
}
