import { describe, expect, it } from "vitest";
import {
  postLiveFollowupIdempotencyPrefix,
  resolveLiveCompletionAt,
  resolvePostLiveDeliveryAt,
  rotatingPostLivePageSkip,
  stablePostLiveFollowupDeliveryId,
} from "@/lib/post-live-followup";

const scheduledAt = new Date("2026-08-17T02:00:00.000Z");

describe("post-live follow-up domain", () => {
  it("uses scheduled time plus duration for VOD and ignores endedAt", () => {
    expect(resolveLiveCompletionAt({
      streamMode: "vod",
      scheduledAt,
      endedAt: new Date("2026-08-17T02:05:00.000Z"),
      videoDurationSec: 3_600,
    })).toEqual(new Date("2026-08-17T03:00:00.000Z"));
  });

  it("uses endedAt only for live input and fails closed for unknown or invalid media", () => {
    const endedAt = new Date("2026-08-17T03:15:00.000Z");
    expect(resolveLiveCompletionAt({ streamMode: "live", scheduledAt, endedAt, videoDurationSec: 3_600 })).toEqual(endedAt);
    expect(resolveLiveCompletionAt({ streamMode: "live", scheduledAt, endedAt: null, videoDurationSec: 3_600 })).toBeNull();
    expect(resolveLiveCompletionAt({ streamMode: "vod", scheduledAt, endedAt, videoDurationSec: 0 })).toBeNull();
    expect(resolveLiveCompletionAt({ streamMode: "hybrid", scheduledAt, endedAt, videoDurationSec: 3_600 })).toBeNull();
  });

  it("adds a bounded non-negative follow-up offset", () => {
    const base = { streamMode: "vod", scheduledAt, endedAt: null, videoDurationSec: 3_600 };
    expect(resolvePostLiveDeliveryAt(base, 90)).toEqual(new Date("2026-08-17T04:30:00.000Z"));
    expect(resolvePostLiveDeliveryAt(base, -1)).toBeNull();
    expect(resolvePostLiveDeliveryAt(base, 10_081)).toBeNull();
  });

  it("changes the deterministic id when canonical configuration changes", () => {
    const input = {
      vendorId: "vendor-1",
      liveId: "live-1",
      liveTitle: "研討會",
      liveScheduledAt: scheduledAt,
      formSubmissionId: "submission-1",
      ruleId: "rule-1",
      offsetMinutes: 30,
      completionAt: new Date("2026-08-17T03:00:00.000Z"),
      template: { id: "template-1", subject: "課後資料", body: "內容" },
    };
    expect(stablePostLiveFollowupDeliveryId(input)).toBe(stablePostLiveFollowupDeliveryId({ ...input }));
    expect(stablePostLiveFollowupDeliveryId(input)).not.toBe(stablePostLiveFollowupDeliveryId({
      ...input,
      template: { ...input.template, body: "新版內容" },
    }));
    expect(postLiveFollowupIdempotencyPrefix("rule-1")).toBe("post-live-followup/rule-1/");
  });

  it("rotates through every bounded page on consecutive one-minute cron slots", () => {
    const minute = new Date("2026-08-17T00:00:00.000Z");
    expect([0, 1, 2].map((offset) => rotatingPostLivePageSkip(
      21,
      10,
      new Date(minute.getTime() + offset * 60_000),
    ))).toEqual([0, 10, 20]);
    expect(rotatingPostLivePageSkip(0, 10, minute)).toBe(0);
  });
});
