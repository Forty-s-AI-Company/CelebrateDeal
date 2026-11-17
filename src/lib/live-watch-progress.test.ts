import { describe, expect, it } from "vitest";
import { creditLiveWatchProgress, watchProgressLengthSeconds, watchProgressPercent } from "@/lib/live-watch-progress";
import { WATCH_PROGRESS_DEADLINE_MS, watchProgressDeadline, watchProgressEventId } from "@/lib/watch-progress-automation";

const base = {
  vendorId: "vendor-1",
  status: "scheduled",
  scheduledAt: new Date("2026-11-18T10:00:00.000Z"),
  startedAt: null,
  endedAt: null,
};

describe("watch progress length and percent (Q-11 viewer_watch_progress)", () => {
  it("uses the Live's own video length for a VOD-based Live", () => {
    expect(watchProgressLengthSeconds({ ...base, streamMode: "vod", video: { vendorId: "vendor-1", durationSec: 600 } })).toBe(600);
    // Another tenant's video, an unknown or broken length: no length, so no progress is judged.
    expect(watchProgressLengthSeconds({ ...base, streamMode: "vod", video: { vendorId: "vendor-2", durationSec: 600 } })).toBeNull();
    for (const durationSec of [null, 0, -5, 12.5]) {
      expect(watchProgressLengthSeconds({ ...base, streamMode: "vod", video: { vendorId: "vendor-1", durationSec } })).toBeNull();
    }
    expect(watchProgressLengthSeconds({ ...base, streamMode: "vod", video: null })).toBeNull();
  });

  it("knows a real live stream's length only once it ended: the time it actually played (review MAJOR-1)", () => {
    const startedAt = new Date("2026-11-18T10:05:00.000Z");
    const live = { ...base, streamMode: "live", status: "live", startedAt, video: null };
    expect(watchProgressLengthSeconds(live)).toBeNull();
    // Started 5 minutes late: measured from startedAt, not from scheduledAt.
    expect(watchProgressLengthSeconds({ ...live, status: "ended", endedAt: new Date("2026-11-18T11:00:00.000Z") })).toBe(3_300);
    // No recorded start: from scheduledAt.
    expect(watchProgressLengthSeconds({ ...live, startedAt: null, status: "ended", endedAt: new Date("2026-11-18T11:00:00.000Z") })).toBe(3_600);
    expect(watchProgressLengthSeconds({ ...live, status: "ended", endedAt: startedAt })).toBeNull();
    expect(watchProgressLengthSeconds({ ...live, streamMode: "browser", status: "ended", endedAt: new Date("2026-11-18T11:00:00.000Z") })).toBeNull();
  });

  it("gives a viewer who watched all of a stream started 10 minutes late at least 90 % (review MAJOR-1)", () => {
    const scheduledAt = new Date("2026-11-18T10:00:00.000Z");
    const startedAt = new Date("2026-11-18T10:10:00.000Z");
    const endedAt = new Date("2026-11-18T11:10:00.000Z");
    const length = watchProgressLengthSeconds({ ...base, scheduledAt, streamMode: "live", status: "ended", startedAt, endedAt, video: null })!;
    expect(length).toBe(3_600);
    // Renewals every 30 s from the start; the tail after the last renewal is lost.
    expect(watchProgressPercent(3_600 - 30, length)).toBeGreaterThanOrEqual(90);
  });

  it("floors the percent and caps it at 100", () => {
    expect(watchProgressPercent(299, 600)).toBe(49);
    expect(watchProgressPercent(300, 600)).toBe(50);
    expect(watchProgressPercent(10_000, 600)).toBe(100);
    expect(watchProgressPercent(0, 600)).toBe(0);
    expect(watchProgressPercent(300, 0)).toBe(0);
    expect(watchProgressPercent(Number.NaN, 600)).toBe(0);
  });

  it("names one event per registration and threshold", () => {
    expect(watchProgressEventId("submission-1", 50)).toBe("watch-progress:submission-1:50");
    expect(watchProgressEventId("submission-1", 75)).not.toBe(watchProgressEventId("submission-1", 50));
  });

  it("bounds the pass inside the e-mail job round", () => {
    expect(watchProgressDeadline(0)).toBe(WATCH_PROGRESS_DEADLINE_MS);
    expect(watchProgressDeadline(35_000)).toBe(10_000);
    expect(watchProgressDeadline(42_500)).toBeNull();
    expect(watchProgressDeadline(Number.NaN)).toBeNull();
  });

  it("writes nothing for an id that is not a plain identifier", async () => {
    const db = { $queryRaw: () => { throw new Error("must not query"); } };
    for (const formSubmissionId of ["", "a b", "x".repeat(129), "id;drop"]) {
      await expect(creditLiveWatchProgress({ vendorId: "vendor-1", liveId: "live-1", formSubmissionId }, db as never)).resolves.toBe("skipped");
    }
    await expect(creditLiveWatchProgress({ vendorId: "vendor 1", liveId: "live-1", formSubmissionId: "s1" }, db as never)).resolves.toBe("skipped");
  });
});
