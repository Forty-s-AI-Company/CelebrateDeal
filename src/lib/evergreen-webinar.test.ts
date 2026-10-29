import { describe, expect, it } from "vitest";
import {
  getEvergreenPlaybackState,
  getEvergreenSessionStart,
  getNextJustInTimeStart,
  getTriggeredEvergreenEvents,
  validateEvergreenWatchProgress,
} from "@/lib/evergreen-webinar";

describe("evergreen webinar session engine", () => {
  it("assigns a JIT visitor to the next 15-minute cohort", () => {
    const enteredAt = new Date("2026-09-08T06:03:00.000Z");
    expect(getNextJustInTimeStart(enteredAt, 15).toISOString()).toBe("2026-09-08T06:15:00.000Z");
    expect(getEvergreenPlaybackState({ mode: "just_in_time", intervalMinutes: 15, durationSeconds: 3600 }, enteredAt)).toMatchObject({
      roomState: "waiting_countdown",
      countdownSeconds: 720,
      offsetSeconds: 0,
    });
  });

  it("keeps a persisted JIT cohort stable through playing and ended states", () => {
    const schedule = { mode: "just_in_time" as const, sessionStartAt: "2026-09-08T06:15:00.000Z", durationSeconds: 3600 };
    expect(getEvergreenPlaybackState(schedule, "2026-09-08T06:45:00.500Z")).toMatchObject({ roomState: "playing", offsetSeconds: 1800.5 });
    expect(getEvergreenPlaybackState(schedule, "2026-09-08T07:15:00.000Z")).toMatchObject({ roomState: "ended", offsetSeconds: 3600 });
  });

  it("calculates recurring daily sessions in their IANA timezone across UTC dates", () => {
    const schedule = { mode: "recurring_daily" as const, timezone: "Asia/Taipei", dailyTimes: ["10:00", "14:00", "20:00"], durationSeconds: 3600 };
    const waiting = getEvergreenPlaybackState(schedule, "2026-09-07T23:30:00.000Z");
    expect(waiting.sessionStartAt.toISOString()).toBe("2026-09-08T02:00:00.000Z");
    expect(waiting.roomState).toBe("waiting_countdown");
    const playing = getEvergreenPlaybackState(schedule, "2026-09-08T06:30:00.000Z");
    expect(playing).toMatchObject({ roomState: "playing", offsetSeconds: 1800 });
  });

  it("skips a spring-forward gap and uses the first fall-back occurrence", () => {
    const spring = getEvergreenPlaybackState({
      mode: "recurring_daily", timezone: "America/New_York", dailyTimes: ["02:30", "04:00"], durationSeconds: 1800,
    }, "2026-03-08T06:45:00.000Z");
    expect(spring.sessionStartAt.toISOString()).toBe("2026-03-08T08:00:00.000Z");

    const fall = getEvergreenPlaybackState({
      mode: "recurring_daily", timezone: "America/New_York", dailyTimes: ["01:30"], durationSeconds: 1800,
    }, "2026-11-01T04:00:00.000Z");
    expect(fall.sessionStartAt.toISOString()).toBe("2026-11-01T05:30:00.000Z");
  });

  it("starts on-demand immediately", () => {
    expect(getEvergreenPlaybackState({ mode: "on_demand", durationSeconds: 90 }, "2026-09-08T00:00:00.000Z")).toMatchObject({ roomState: "playing", offsetSeconds: 0 });
  });

  it("rejects an unknown persisted schedule mode", () => {
    expect(() => getEvergreenPlaybackState({ mode: "unexpected" as never, durationSeconds: 90 }, "2026-09-08T00:00:00.000Z"))
      .toThrow("mode must be a supported evergreen schedule mode");
  });
});

describe("evergreen session start in the merchant timezone", () => {
  it("rounds just-in-time entries up to the next interval boundary, never the current one", () => {
    const schedule = { mode: "just_in_time" as const, intervalMinutes: 15 as const, timezone: "Asia/Taipei", durationSeconds: 3_600 };
    // Asia/Taipei is UTC+08:00 without DST: 14:14:59.999 local joins 14:15.
    expect(getEvergreenSessionStart(schedule, "2026-10-29T06:14:59.999Z").toISOString()).toBe("2026-10-29T06:15:00.000Z");
    // Arriving exactly on a boundary joins the next cohort, so a countdown always exists.
    expect(getEvergreenSessionStart(schedule, "2026-10-29T06:15:00.000Z").toISOString()).toBe("2026-10-29T06:30:00.000Z");
    expect(getEvergreenSessionStart({ ...schedule, intervalMinutes: 5 }, "2026-10-29T06:16:00.000Z").toISOString()).toBe("2026-10-29T06:20:00.000Z");
    expect(getEvergreenSessionStart({ ...schedule, intervalMinutes: 30 }, "2026-10-29T06:16:00.000Z").toISOString()).toBe("2026-10-29T06:30:00.000Z");
  });

  it("aligns just-in-time cohorts to a non-hour-offset timezone's wall clock", () => {
    // Asia/Kathmandu is UTC+05:45: 06:03Z is 11:48 local, so the next :00/:30 cohort is 12:00 local (06:15Z),
    // not the UTC-aligned 06:30Z.
    const kathmandu = { mode: "just_in_time" as const, intervalMinutes: 30 as const, timezone: "Asia/Kathmandu", durationSeconds: 1_800 };
    expect(getNextJustInTimeStart("2026-10-29T06:03:00.000Z", 30, "Asia/Kathmandu").toISOString()).toBe("2026-10-29T06:15:00.000Z");
    expect(getNextJustInTimeStart("2026-10-29T06:03:00.000Z", 30).toISOString()).toBe("2026-10-29T06:30:00.000Z");
    expect(getEvergreenPlaybackState(kathmandu, "2026-10-29T06:03:00.000Z")).toMatchObject({ roomState: "waiting_countdown", countdownSeconds: 720 });
    expect(() => getNextJustInTimeStart("2026-10-29T06:03:00.000Z", 15, "Mars/Olympus")).toThrow("timezone must be a valid IANA timezone");
  });

  it("joins a daily slot that started before midnight and otherwise waits for the next day", () => {
    const lateNight = { mode: "recurring_daily" as const, timezone: "Asia/Taipei", dailyTimes: ["23:30"], durationSeconds: 3_600 };
    // 00:10 local on Oct 30: the Oct 29 23:30 slot is still running.
    expect(getEvergreenPlaybackState(lateNight, "2026-10-29T16:10:00.000Z")).toMatchObject({
      roomState: "playing",
      offsetSeconds: 2_400,
      sessionStartAt: new Date("2026-10-29T15:30:00.000Z"),
    });
    // 00:45 local: that slot ended at 00:30, so the visitor waits for 23:30 on Oct 30.
    const next = getEvergreenPlaybackState(lateNight, "2026-10-29T16:45:00.000Z");
    expect(next.roomState).toBe("waiting_countdown");
    expect(next.sessionStartAt.toISOString()).toBe("2026-10-30T15:30:00.000Z");
  });

  it("picks the next of up to four daily slots in another timezone", () => {
    const schedule = { mode: "recurring_daily" as const, timezone: "Asia/Kathmandu", dailyTimes: ["21:00", "09:00", "13:30", "18:15"], durationSeconds: 1_800 };
    // 15:45 local: 13:30 already ended (14:00), so 18:15 local = 12:30Z is next.
    expect(getEvergreenSessionStart(schedule, "2026-10-29T10:00:00.000Z").toISOString()).toBe("2026-10-29T12:30:00.000Z");
    // 21:20 local is inside the 21:00 slot.
    expect(getEvergreenPlaybackState(schedule, "2026-10-29T15:35:00.000Z")).toMatchObject({ roomState: "playing", offsetSeconds: 1_200 });
  });

  it("starts on-demand at first entry and keeps that start once persisted", () => {
    const schedule = { mode: "on_demand" as const, durationSeconds: 600, timezone: "Asia/Taipei" };
    const firstEntry = getEvergreenSessionStart(schedule, "2026-10-29T06:00:00.000Z");
    expect(firstEntry.toISOString()).toBe("2026-10-29T06:00:00.000Z");
    expect(getEvergreenPlaybackState({ ...schedule, sessionStartAt: firstEntry }, "2026-10-29T06:04:00.000Z")).toMatchObject({ roomState: "playing", offsetSeconds: 240 });
    expect(getEvergreenPlaybackState({ ...schedule, sessionStartAt: firstEntry }, "2026-10-29T06:10:00.000Z")).toMatchObject({ roomState: "ended" });
  });
});

describe("evergreen timeline and watch integrity", () => {
  it("returns every event crossed by a delayed heartbeat in deterministic order", () => {
    const events = [{ id: "poll", triggerSec: 60 }, { id: "chat", triggerSec: 30 }, { id: "pitch", triggerSec: 60 }];
    expect(getTriggeredEvergreenEvents(events, 20, 65).map(({ id }) => id)).toEqual(["chat", "pitch", "poll"]);
  });

  it("rejects rewind, speed changes, and impossible public progress", () => {
    expect(validateEvergreenWatchProgress({ previousOffsetSeconds: 20, reportedOffsetSeconds: 19, elapsedWallSeconds: 5, claimedWatchSeconds: 5 })).toMatchObject({ accepted: false, reason: "rewind" });
    expect(validateEvergreenWatchProgress({ previousOffsetSeconds: 20, reportedOffsetSeconds: 25, elapsedWallSeconds: 5, claimedWatchSeconds: 5, playbackRate: 2 })).toMatchObject({ accepted: false, reason: "playback_rate" });
    expect(validateEvergreenWatchProgress({ previousOffsetSeconds: 20, reportedOffsetSeconds: 60, elapsedWallSeconds: 5, claimedWatchSeconds: 5 })).toMatchObject({ accepted: false, reason: "time_jump" });
  });

  it("allows accelerated preview without inflating credited watch time", () => {
    expect(validateEvergreenWatchProgress(
      { previousOffsetSeconds: 20, reportedOffsetSeconds: 30, elapsedWallSeconds: 5, claimedWatchSeconds: 5, playbackRate: 2 },
      { merchantPreview: true },
    )).toEqual({ accepted: true, watchSeconds: 5 });
  });

  it("rejects non-finite preview rates and watch credit without media progress", () => {
    expect(validateEvergreenWatchProgress(
      { previousOffsetSeconds: 20, reportedOffsetSeconds: 3_600, elapsedWallSeconds: 5, claimedWatchSeconds: 5, playbackRate: Number.POSITIVE_INFINITY },
      { merchantPreview: true },
    )).toEqual({ accepted: false, reason: "playback_rate" });
    expect(validateEvergreenWatchProgress({ previousOffsetSeconds: 20, reportedOffsetSeconds: 20, elapsedWallSeconds: 5, claimedWatchSeconds: 5 })).toEqual({ accepted: false, reason: "time_jump" });
    expect(validateEvergreenWatchProgress({ previousOffsetSeconds: 20, reportedOffsetSeconds: 30, elapsedWallSeconds: 5, claimedWatchSeconds: 5, playbackRate: 2 })).toEqual({ accepted: false, reason: "playback_rate" });
  });
});
