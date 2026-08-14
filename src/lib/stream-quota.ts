import type { LiveMemberQuota, LivePageQuota } from "@/lib/live-quota-policy";

export class StreamQuotaExceededError extends Error {
  readonly code = "stream_minutes_exhausted" as const;

  constructor() {
    super("stream_minutes_exhausted");
    this.name = "StreamQuotaExceededError";
  }
}

/** Enforce the included-minute boundary until an explicit overage billing policy exists. */
export function assertStreamQuotaAvailable(input: {
  includedMinutes: number;
  usedSeconds: number;
  requestedSeconds: number;
}) {
  if (input.includedMinutes <= 0) return;
  const usedSeconds = Math.max(0, input.usedSeconds);
  const requestedSeconds = Math.max(0, input.requestedSeconds);
  if (usedSeconds + requestedSeconds > input.includedMinutes * 60) {
    throw new StreamQuotaExceededError();
  }
}

/** Returns the in-app notification copy for the deterministic vendor quota thresholds. */
export function streamQuotaNotification(input: { used: number; limit: number; warningPercent?: number }) {
  if (input.limit <= 0) return null;
  const used = Math.max(0, input.used);
  const warningPercent = input.warningPercent ?? 80;
  if (used >= input.limit) return "Stream 額度已用完：新播放已暫停，請通知付款人與相關成員。";
  if (used * 100 >= input.limit * warningPercent) {
    return `Stream 額度已達 ${warningPercent}%：請通知付款人與相關成員。`;
  }
  return null;
}

/** Enforces configured live-scoped member and page quotas against immutable usage. */
export function assertStreamScopedQuotasAvailable(input: {
  memberQuotas: readonly LiveMemberQuota[];
  pageQuotas: readonly LivePageQuota[];
  sourcePageId: string | null;
  currentMemberUsage: ReadonlyMap<string, number>;
  currentPageUsageSeconds: number;
  requestedWatchSeconds: number;
  requestedAllocations: ReadonlyArray<{
    recipientTeamId: string | null;
    recipientMembershipId: string | null;
    allocatedWatchSeconds: number;
  }>;
}) {
  for (const quota of input.memberQuotas) {
    const key = `${quota.teamId}:${quota.membershipId}`;
    const requestedSeconds = input.requestedAllocations
      .filter((allocation) => allocation.recipientTeamId === quota.teamId && allocation.recipientMembershipId === quota.membershipId)
      .reduce((sum, allocation) => sum + allocation.allocatedWatchSeconds, 0);
    if (requestedSeconds <= 0) continue;
    assertStreamQuotaAvailable({
      includedMinutes: quota.includedMinutes,
      usedSeconds: input.currentMemberUsage.get(key) ?? 0,
      requestedSeconds,
    });
  }

  const pageQuota = input.pageQuotas.find((quota) => quota.pageId === input.sourcePageId);
  if (pageQuota) {
    assertStreamQuotaAvailable({
      includedMinutes: pageQuota.includedMinutes,
      usedSeconds: input.currentPageUsageSeconds,
      requestedSeconds: input.requestedWatchSeconds,
    });
  }
}
