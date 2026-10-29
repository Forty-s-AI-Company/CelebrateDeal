import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  EVERGREEN_ACTIVATION_SELECT,
  evergreenScheduleForLive,
  evergreenVideoDurationSeconds,
  isActiveEvergreenLive,
} from "@/lib/evergreen-activation";
import {
  EVERGREEN_LIVE_SELECT,
  EVERGREEN_NEUTRAL_START_TEXT,
  evergreenRegistrationStartText,
  resolveEvergreenViewerSession,
  resolveViewerLiveRuntime,
  type EvergreenLiveRecord,
} from "@/lib/evergreen-viewer-session";

const NOW = new Date("2026-10-29T06:03:00.000Z");

function live(overrides: Partial<EvergreenLiveRecord> = {}) {
  return {
    id: "live-1",
    vendorId: "vendor-1",
    status: "scheduled",
    streamMode: "vod",
    isEvergreen: true,
    evergreenScheduleMode: "just_in_time",
    evergreenIntervalMinutes: 15,
    evergreenDailyTimes: [] as string[],
    evergreenSessionStartAt: null,
    replayEnabled: false,
    replayAvailableUntil: null,
    video: { durationSec: 1_800 },
    scheduledAt: new Date("2026-10-29T06:00:00.000Z"),
    startedAt: null,
    endedAt: null,
    ...overrides,
  };
}

const CASES: Array<[string, Partial<EvergreenLiveRecord>, boolean]> = [
  ["an evergreen VOD with a known duration", {}, true],
  ["an evergreen VOD that is live", { status: "live" }, true],
  ["a daily evergreen schedule", { evergreenScheduleMode: "recurring_daily", evergreenDailyTimes: ["20:00"] }, true],
  ["an on-demand evergreen schedule", { evergreenScheduleMode: "on_demand" }, true],
  ["a merchant-anchored evergreen session", { evergreenSessionStartAt: new Date("2026-10-29T07:00:00.000Z") }, true],
  ["a regular live", { isEvergreen: false }, false],
  ["an evergreen flag on a real-time broadcast", { streamMode: "live" }, false],
  ["an ended evergreen live", { status: "ended" }, false],
  ["an evergreen live without a video", { video: null }, false],
  ["an evergreen live with an unknown duration", { video: { durationSec: null } }, false],
  ["an evergreen live with a zero duration", { video: { durationSec: 0 } }, false],
  ["an evergreen live longer than 24 hours", { video: { durationSec: 86_401 } }, false],
  ["an unknown schedule mode", { evergreenScheduleMode: "mystery" }, false],
  ["a daily schedule without times", { evergreenScheduleMode: "recurring_daily", evergreenDailyTimes: [] }, false],
  ["a daily schedule with a malformed time", { evergreenScheduleMode: "recurring_daily", evergreenDailyTimes: ["25:00"] }, false],
];

beforeEach(() => vi.stubEnv("CSRF_SECRET", "synthetic-evergreen-activation-root-secret-0123456789"));
afterEach(() => vi.unstubAllEnvs());

describe("one evergreen activation rule for every consumer", () => {
  it.each(CASES)("agrees on %s", (_label, overrides, active) => {
    const record = live(overrides);
    expect(isActiveEvergreenLive(record, { now: NOW })).toBe(active);
    expect(evergreenScheduleForLive(record, "Asia/Taipei", NOW) !== null).toBe(active);
    // The viewer page, admission and playback source resolve the session through the same rule.
    expect(resolveEvergreenViewerSession({ live: record, vendorTimezone: "Asia/Taipei", token: null, intent: "read", now: NOW }) !== null).toBe(active);
    expect(resolveViewerLiveRuntime(record, { vendorTimezone: "Asia/Taipei", evergreenToken: null, now: NOW }).evergreen !== null).toBe(active);
  });

  it("treats a missing record as not evergreen", () => {
    expect(isActiveEvergreenLive(null)).toBe(false);
    expect(isActiveEvergreenLive(undefined)).toBe(false);
  });

  it("does not depend on the merchant timezone for activation", () => {
    for (const [, overrides, active] of CASES) {
      expect(isActiveEvergreenLive(live(overrides), { vendorTimezone: "Asia/Kathmandu", now: NOW })).toBe(active);
      expect(isActiveEvergreenLive(live(overrides), { vendorTimezone: "Not/AZone", now: NOW })).toBe(active);
    }
  });

  it("keeps the session select a superset of the activation select", () => {
    for (const key of Object.keys(EVERGREEN_ACTIVATION_SELECT)) {
      expect(EVERGREEN_LIVE_SELECT).toHaveProperty(key, true);
    }
  });

  it("accepts only an integer duration between 1 second and 24 hours", () => {
    expect([1, 1_800, 86_400].map(evergreenVideoDurationSeconds)).toEqual([1, 1_800, 86_400]);
    expect([0, -1, 1.5, 86_401, Number.NaN, null, undefined].map(evergreenVideoDurationSeconds)).toEqual([null, null, null, null, null, null, null]);
  });
});

describe("registration {{live_start_at}} for an evergreen live", () => {
  it("uses the visitor's own signed session in the merchant timezone", () => {
    const claimed = resolveEvergreenViewerSession({ live: live(), vendorTimezone: "Asia/Taipei", token: null, intent: "claim", now: NOW })!;
    const text = evergreenRegistrationStartText({ live: live(), vendorTimezone: "Asia/Taipei", token: claimed.issuedToken, now: NOW });
    // 06:15 UTC is 14:15 in Asia/Taipei; scheduledAt (06:00 UTC) is never used.
    expect(text).toContain("2:15");
    expect(text).not.toContain("2:00");
    expect(text).not.toBe(EVERGREEN_NEUTRAL_START_TEXT);
  });

  it("falls back to a neutral phrase without a session, or once the session ended", () => {
    expect(evergreenRegistrationStartText({ live: live(), vendorTimezone: "Asia/Taipei", token: null, now: NOW })).toBe("依你的觀看時段開始");
    const claimed = resolveEvergreenViewerSession({ live: live(), vendorTimezone: "Asia/Taipei", token: null, intent: "claim", now: NOW })!;
    expect(evergreenRegistrationStartText({ live: live(), vendorTimezone: "Asia/Taipei", token: claimed.issuedToken, now: new Date("2026-10-29T07:00:00.000Z") }))
      .toBe(EVERGREEN_NEUTRAL_START_TEXT);
  });

  it("uses the shared merchant anchor for every visitor", () => {
    const anchored = live({ evergreenSessionStartAt: new Date("2026-10-29T12:00:00.000Z") });
    expect(evergreenRegistrationStartText({ live: anchored, vendorTimezone: "Asia/Taipei", token: null, now: NOW })).toContain("8:00");
  });
});
