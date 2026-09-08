import { describe, expect, it } from "vitest";
import {
  getEvergreenPlaybackState,
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

  it("starts on-demand immediately", () => {
    expect(getEvergreenPlaybackState({ mode: "on_demand", durationSeconds: 90 }, "2026-09-08T00:00:00.000Z")).toMatchObject({ roomState: "playing", offsetSeconds: 0 });
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
    expect(validateEvergreenWatchProgress({ previousOffsetSeconds: 20, reportedOffsetSeconds: 40, elapsedWallSeconds: 5, claimedWatchSeconds: 5, playbackRate: 4, previewMode: true })).toEqual({ accepted: true, watchSeconds: 5 });
  });
});
