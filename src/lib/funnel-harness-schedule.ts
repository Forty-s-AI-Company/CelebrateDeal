import type { FunnelWebinarSettings } from "@/lib/funnel-webinar";

/**
 * Synthetic event schedules for the development-only design harness
 * (`/browser-qa/funnel-design?schedule=…`), so the layout QA can measure the
 * countdown, event facts, `{{webinar.*}}` fields, deadline notice and every
 * `webinar_state` phase. Never used on merchant pages.
 */
export const FUNNEL_HARNESS_SCHEDULES = ["sample", "far", "live", "replay", "ended"] as const;
export type FunnelHarnessScheduleKind = (typeof FUNNEL_HARNESS_SCHEDULES)[number];
export type FunnelHarnessSchedule = { kind: FunnelHarnessScheduleKind; webinar: FunnelWebinarSettings; registrationClosesAt: string; renderedAt: number };

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

export function isFunnelHarnessSchedule(value: unknown): value is FunnelHarnessScheduleKind {
  return typeof value === "string" && (FUNNEL_HARNESS_SCHEDULES as readonly string[]).includes(value);
}

/**
 * - sample：3 天 5 小時後開播（倒數 4 格、報名截止在開播前 1 小時）
 * - far：120 天後開播（3 位數天數）
 * - live：20 分鐘前開播，直播中
 * - replay：昨天結束，回放再開放 6 天
 * - ended：回放已結束
 */
export function funnelHarnessSchedule(kind: FunnelHarnessScheduleKind, now: number): FunnelHarnessSchedule {
  const renderedAt = Math.floor(now / MINUTE) * MINUTE;
  const startsAt = kind === "sample" ? renderedAt + 3 * DAY + 5 * HOUR
    : kind === "far" ? renderedAt + 120 * DAY
      : kind === "live" ? renderedAt - 20 * MINUTE
        : kind === "replay" ? renderedAt - DAY - 90 * MINUTE
          : renderedAt - 10 * DAY;
  const endsAt = startsAt + 90 * MINUTE;
  const replayEndsAt = kind === "ended" ? endsAt + 3 * DAY : endsAt + 7 * DAY;
  const iso = (value: number) => new Date(value).toISOString();
  return {
    kind,
    webinar: { timezone: "Asia/Taipei", startsAt: iso(startsAt), endsAt: iso(endsAt), replayEndsAt: iso(replayEndsAt) },
    registrationClosesAt: iso(startsAt - HOUR),
    renderedAt,
  };
}
