import type { Prisma } from "@prisma/client";

export const LIVE_RUNTIME_STATES = [
  "waiting",
  "playing",
  "replay",
  "unavailable",
] as const;

export type LiveRuntimeState = typeof LIVE_RUNTIME_STATES[number];

export type LiveRuntimeCandidate = {
  streamMode: string;
  scheduledAt: Date | null;
  status: string;
  startedAt: Date | null;
  endedAt: Date | null;
  replayAvailableUntil: Date | null;
  replayEnabled?: boolean | null;
  video?: { durationSec: number | null } | null;
  now?: Date;
};

export type LiveRuntimeResolution = {
  state: LiveRuntimeState;
  playbackStartSeconds: number | null;
};

export type LiveRuntimeReconcileInput = {
  vendorId: string;
  liveId: string;
  now?: Date;
};

type LiveRuntimeDecision = LiveRuntimeResolution & {
  completionAt: Date | null;
  canReconcileToEnded: boolean;
};

type LiveRuntimeRecord = {
  id: string;
  vendorId: string;
  streamMode: string;
  scheduledAt: Date;
  status: string;
  startedAt: Date | null;
  endedAt: Date | null;
  replayAvailableUntil: Date | null;
  replayEnabled: boolean;
  video: { id: string; durationSec: number | null } | null;
};

type LiveRuntimeDelegate = {
  findFirst(args: Prisma.LiveFindFirstArgs): Promise<unknown>;
  updateMany(args: Prisma.LiveUpdateManyArgs): Promise<unknown>;
};

export type LiveRuntimeDatabase = {
  live: LiveRuntimeDelegate;
};

const VALID_LIVE_STATUSES = new Set(["scheduled", "live", "ended"]);
const MAX_PRISMA_INT = 2_147_483_647;
const MAX_DATE_MS = 8.64e15;

function isValidDate(value: unknown): value is Date {
  return value instanceof Date && Number.isFinite(value.getTime());
}

function unavailableDecision(): LiveRuntimeDecision {
  return {
    state: "unavailable",
    playbackStartSeconds: null,
    completionAt: null,
    canReconcileToEnded: false,
  };
}

function replayState(
  now: Date,
  replayEnabled: boolean | null | undefined,
  replayAvailableUntil: Date | null,
) {
  if (replayEnabled !== true) return "unavailable" as const;
  // Equality is deliberately expired: a replay window is open only before
  // its terminal timestamp. `null` means no configured expiry.
  if (replayAvailableUntil !== null && now.getTime() >= replayAvailableUntil.getTime()) {
    return "unavailable" as const;
  }
  return "replay" as const;
}

function finishDecision(
  now: Date,
  replayEnabled: boolean | null | undefined,
  replayAvailableUntil: Date | null,
  completionAt: Date,
): LiveRuntimeDecision {
  return {
    state: replayState(now, replayEnabled, replayAvailableUntil),
    playbackStartSeconds: null,
    completionAt,
    canReconcileToEnded: true,
  };
}

function validVodDuration(
  video: LiveRuntimeCandidate["video"],
): video is { durationSec: number } {
  const durationSec = video?.durationSec;
  return typeof durationSec === "number"
    && Number.isSafeInteger(durationSec)
    && durationSec > 0
    && durationSec <= MAX_PRISMA_INT;
}

function vodCompletionAt(scheduledAt: Date, durationSec: number) {
  const completionMs = scheduledAt.getTime() + durationSec * 1_000;
  if (!Number.isSafeInteger(completionMs) || completionMs > MAX_DATE_MS || completionMs < -MAX_DATE_MS) {
    return null;
  }
  return new Date(completionMs);
}

function isValidLifecycleInput(
  input: LiveRuntimeCandidate,
  now: Date,
  startedAt: Date | null,
  endedAt: Date | null,
  replayAvailableUntil: Date | null,
) {
  return isValidDate(now)
    && isValidDate(input.scheduledAt)
    && VALID_LIVE_STATUSES.has(input.status)
    && ["vod", "live"].includes(input.streamMode)
    && (input.replayEnabled === true || input.replayEnabled === false)
    && (startedAt === null || isValidDate(startedAt))
    && (endedAt === null || isValidDate(endedAt))
    && (replayAvailableUntil === null || isValidDate(replayAvailableUntil))
    && (startedAt === null || endedAt === null || endedAt.getTime() >= startedAt.getTime())
    && (endedAt === null || replayAvailableUntil === null || replayAvailableUntil.getTime() >= endedAt.getTime());
}

function evaluateVodRuntime(
  input: LiveRuntimeCandidate,
  now: Date,
  endedAt: Date | null,
  replayAvailableUntil: Date | null,
): LiveRuntimeDecision {
  const video = input.video;
  if (!validVodDuration(video)) return unavailableDecision();
  const scheduledAt = input.scheduledAt;
  if (!isValidDate(scheduledAt)) return unavailableDecision();
  const durationSec = video.durationSec;
  const completionAt = vodCompletionAt(scheduledAt, durationSec);
  if (!completionAt) return unavailableDecision();

  if (endedAt !== null && endedAt.getTime() < completionAt.getTime()) return unavailableDecision();
  if (input.status === "ended") {
    if (endedAt === null || now.getTime() < endedAt.getTime()) return unavailableDecision();
    return finishDecision(now, input.replayEnabled, replayAvailableUntil, completionAt);
  }
  if (now.getTime() < scheduledAt.getTime()) {
    if (input.status === "ended") return unavailableDecision();
    return {
      state: "waiting",
      playbackStartSeconds: null,
      completionAt,
      canReconcileToEnded: false,
    };
  }
  if (now.getTime() < completionAt.getTime()) {
    if (input.status === "ended") return unavailableDecision();
    const playbackStartSeconds = Math.min(
      durationSec,
      Math.max(0, (now.getTime() - scheduledAt.getTime()) / 1_000),
    );
    return {
      state: "playing",
      playbackStartSeconds,
      completionAt,
      canReconcileToEnded: false,
    };
  }
  if (endedAt !== null && now.getTime() < endedAt.getTime()) return unavailableDecision();
  return finishDecision(now, input.replayEnabled, replayAvailableUntil, completionAt);
}

function evaluateLiveInputRuntime(
  input: LiveRuntimeCandidate,
  now: Date,
  startedAt: Date | null,
  endedAt: Date | null,
  replayAvailableUntil: Date | null,
): LiveRuntimeDecision {
  if (input.status === "scheduled") {
    if (endedAt !== null) return unavailableDecision();
    return {
      state: "waiting",
      playbackStartSeconds: null,
      completionAt: null,
      canReconcileToEnded: false,
    };
  }
  if (input.status === "live") {
    if (startedAt === null || startedAt.getTime() > now.getTime()) return unavailableDecision();
    if (endedAt !== null && now.getTime() >= endedAt.getTime()) {
      return finishDecision(now, input.replayEnabled, replayAvailableUntil, endedAt);
    }
    return {
      state: "playing",
      playbackStartSeconds: null,
      completionAt: endedAt,
      canReconcileToEnded: false,
    };
  }
  if (startedAt === null || endedAt === null || now.getTime() < endedAt.getTime()) {
    return unavailableDecision();
  }
  return finishDecision(now, input.replayEnabled, replayAvailableUntil, endedAt);
}

function evaluateLiveRuntime(input: LiveRuntimeCandidate, fallbackNow: Date): LiveRuntimeDecision {
  const now = input.now ?? fallbackNow;
  const startedAt = input.startedAt;
  const endedAt = input.endedAt;
  const replayAvailableUntil = input.replayAvailableUntil;
  if (!isValidLifecycleInput(input, now, startedAt, endedAt, replayAvailableUntil)) {
    return unavailableDecision();
  }
  return input.streamMode === "vod"
    ? evaluateVodRuntime(input, now, endedAt, replayAvailableUntil)
    : evaluateLiveInputRuntime(input, now, startedAt, endedAt, replayAvailableUntil);
}

/**
 * Resolves the complete runtime decision from one lifecycle contract.
 * Callers must use this result instead of rebuilding schedule comparisons.
 */
export function resolveLiveRuntime(
  input: LiveRuntimeCandidate,
  now = new Date(),
): LiveRuntimeResolution {
  const decision = evaluateLiveRuntime(input, now);
  return {
    state: decision.state,
    playbackStartSeconds: decision.playbackStartSeconds,
  };
}

/** Returns only the canonical four-state value for simple domain gates. */
export function resolveLiveRuntimeState(
  input: LiveRuntimeCandidate,
  now = new Date(),
): LiveRuntimeState {
  return resolveLiveRuntime(input, now).state;
}

function reconciliationTarget(live: LiveRuntimeRecord, decision: LiveRuntimeDecision) {
  if (
    live.streamMode !== "vod"
    || !decision.canReconcileToEnded
    || !decision.completionAt
    || live.status === "ended"
    || !live.video
    || !validVodDuration(live.video)
  ) return null;

  // A persisted endedAt is authoritative; never replace it with an estimate.
  return live.endedAt === null
    ? { status: "ended", endedAt: decision.completionAt }
    : { status: "ended" };
}

/**
 * Reconciles only a lifecycle transition that was derived from a tenant-bound
 * snapshot. The update predicate is intentionally optimistic: a concurrent
 * writer changing any lifecycle field makes this write a no-op.
 */
export async function reconcileLiveRuntimeState(
  db: LiveRuntimeDatabase,
  input: LiveRuntimeReconcileInput,
) {
  const now = input.now ?? new Date();
  const live = await db.live.findFirst({
    where: { id: input.liveId, vendorId: input.vendorId },
    select: {
      id: true,
      vendorId: true,
      streamMode: true,
      scheduledAt: true,
      status: true,
      startedAt: true,
      endedAt: true,
      replayAvailableUntil: true,
      replayEnabled: true,
      video: { select: { id: true, durationSec: true } },
    },
  }) as LiveRuntimeRecord | null;

  if (!live) {
    return {
      state: "unavailable" as const,
      playbackStartSeconds: null,
      updated: false,
      updateCount: 0,
    };
  }

  const decision = evaluateLiveRuntime(live, now);
  const resolution = {
    state: decision.state,
    playbackStartSeconds: decision.playbackStartSeconds,
  } satisfies LiveRuntimeResolution;
  const target = reconciliationTarget(live, decision);
  const video = live.video;
  if (!target || !video || !validVodDuration(video)) {
    return { ...resolution, updated: false, updateCount: 0 };
  }

  const where = {
    id: live.id,
    vendorId: input.vendorId,
    streamMode: live.streamMode,
    scheduledAt: live.scheduledAt,
    status: live.status,
    startedAt: live.startedAt,
    endedAt: live.endedAt,
    replayAvailableUntil: live.replayAvailableUntil,
    replayEnabled: live.replayEnabled,
    video: {
      is: {
        id: video.id,
        durationSec: video.durationSec,
      },
    },
  } satisfies Prisma.LiveWhereInput;

  const updated = await db.live.updateMany({
    where,
    data: target,
  }) as { count: number };

  return {
    ...resolution,
    updated: updated.count === 1,
    updateCount: updated.count,
  };
}
