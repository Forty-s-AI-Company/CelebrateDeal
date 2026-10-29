import {
  EVERGREEN_SCHEDULE_MODES,
  getEvergreenSessionStart,
  type EvergreenSchedule,
  type EvergreenScheduleMode,
} from "@/lib/evergreen-webinar";

/**
 * The single rule for "this Live is an active evergreen webinar" (常青 Webinar
 * 生效中). Every server path that has to choose between the visitor's own
 * evergreen session and the shared `scheduledAt` lifecycle — the viewer page,
 * admission, playback, funnels, shared interactions, the purchase ticker and
 * outbound reminders — must use `isActiveEvergreenLive` (or
 * `evergreenScheduleForLive`) instead of reading `isEvergreen` directly, so
 * they can never disagree about the same Live.
 *
 * Pure: no crypto, database or environment access.
 */

export const EVERGREEN_MAX_DURATION_SECONDS = 86_400;
const DEFAULT_TIMEZONE = "Asia/Taipei";
const ACTIVE_STATUSES = new Set(["scheduled", "live"]);

/**
 * Every field the rule reads. The keys are required on purpose: a Prisma
 * query that forgets to select one fails type checking instead of silently
 * treating an evergreen Live as a fixed-time one.
 */
export type EvergreenActivationRecord = {
  isEvergreen: boolean | null;
  streamMode: string;
  status: string;
  evergreenScheduleMode: string;
  evergreenIntervalMinutes: number;
  evergreenDailyTimes: string[];
  evergreenSessionStartAt: Date | null;
  video: { durationSec: number | null } | null;
};

/** Prisma select for the rule; callers also select `video.durationSec`. */
export const EVERGREEN_ACTIVATION_SELECT = {
  isEvergreen: true,
  streamMode: true,
  status: true,
  evergreenScheduleMode: true,
  evergreenIntervalMinutes: true,
  evergreenDailyTimes: true,
  evergreenSessionStartAt: true,
} as const;

export type ActiveEvergreenSchedule = EvergreenSchedule & {
  timezone: string;
  /** Merchant anchor: every visitor shares this start (overrides the mode). */
  sharedStartAt: Date | null;
};

function validTimezone(value: string | null | undefined) {
  if (!value) return null;
  try {
    new Intl.DateTimeFormat("en", { timeZone: value }).format(0);
    return value;
  } catch {
    return null;
  }
}

/** A known video length the evergreen engine can schedule, or null. */
export function evergreenVideoDurationSeconds(value: number | null | undefined) {
  return typeof value === "number" && Number.isInteger(value) && value > 0 && value <= EVERGREEN_MAX_DURATION_SECONDS
    ? value
    : null;
}

/**
 * Returns the schedule only when evergreen playback governs this Live:
 * an evergreen VOD that the merchant has not ended, with a known duration and
 * a schedule the engine can compute. Everything else keeps the regular
 * scheduledAt lifecycle.
 */
export function evergreenScheduleForLive(
  live: EvergreenActivationRecord,
  vendorTimezone: string | null | undefined,
  now: Date = new Date(),
): ActiveEvergreenSchedule | null {
  if (live.isEvergreen !== true || live.streamMode !== "vod" || !ACTIVE_STATUSES.has(live.status)) return null;
  const durationSeconds = evergreenVideoDurationSeconds(live.video?.durationSec);
  if (!durationSeconds) return null;
  if (!EVERGREEN_SCHEDULE_MODES.includes(live.evergreenScheduleMode as EvergreenScheduleMode)) return null;
  const mode = live.evergreenScheduleMode as EvergreenScheduleMode;
  const intervalMinutes = [5, 15, 30].includes(live.evergreenIntervalMinutes)
    ? live.evergreenIntervalMinutes as 5 | 15 | 30
    : 15;
  const dailyTimes = [...new Set(live.evergreenDailyTimes ?? [])].sort();
  if (mode === "recurring_daily" && dailyTimes.length === 0) return null;
  const sharedStartAt = live.evergreenSessionStartAt && Number.isFinite(live.evergreenSessionStartAt.getTime())
    ? new Date(live.evergreenSessionStartAt.getTime())
    : null;
  const schedule: ActiveEvergreenSchedule = {
    mode,
    durationSeconds,
    timezone: validTimezone(vendorTimezone) ?? DEFAULT_TIMEZONE,
    intervalMinutes,
    dailyTimes,
    sharedStartAt,
  };
  try {
    // Reject a schedule the engine cannot compute (e.g. malformed daily times).
    getEvergreenSessionStart(schedule, now);
  } catch {
    return null;
  }
  return schedule;
}

/** True only when the evergreen schedule, not `scheduledAt`, governs this Live. */
export function isActiveEvergreenLive(
  live: EvergreenActivationRecord | null | undefined,
  options: { vendorTimezone?: string | null; now?: Date } = {},
) {
  return Boolean(live && evergreenScheduleForLive(live, options.vendorTimezone ?? null, options.now ?? new Date()));
}
