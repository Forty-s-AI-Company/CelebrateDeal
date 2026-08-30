import { describe, expect, it } from "vitest";
import {
  isVideoProviderError,
  isVideoProviderReady,
  parseVideoProviderSnapshot,
  VIDEO_STATUS_MAX_POLL_ATTEMPTS,
  VIDEO_STATUS_POLL_INTERVAL_MS,
} from "./video-provider-status";

describe("video provider status", () => {
  it("recognizes ready only after provider readiness is confirmed", () => {
    expect(isVideoProviderReady({ status: "ready", cloudflareReadyToStream: true })).toBe(true);
    expect(isVideoProviderReady({ status: "ready", cloudflareReadyToStream: false })).toBe(false);
    expect(isVideoProviderReady({ status: "processing", cloudflareReadyToStream: true })).toBe(false);
  });

  it("stops the polling state machine on provider error", () => {
    expect(isVideoProviderError({ status: "error" })).toBe(true);
    expect(isVideoProviderError({ status: "processing" })).toBe(false);
    expect(VIDEO_STATUS_POLL_INTERVAL_MS).toBeGreaterThan(0);
    expect(VIDEO_STATUS_MAX_POLL_ATTEMPTS).toBeGreaterThan(0);
  });

  it("accepts only the safe provider snapshot shape and normalizes nullable metadata", () => {
    expect(parseVideoProviderSnapshot({
      video: {
        status: "processing",
        cloudflareReadyToStream: false,
        durationSec: 92,
        estimatedMinutes: 2,
        thumbnailUrl: null,
        videoUrl: null,
        resourceId: "video-1",
        token: "must-not-be-used",
      },
    }, "fallback")).toEqual({
      status: "processing",
      cloudflareReadyToStream: false,
      durationSec: 92,
      estimatedMinutes: 2,
      thumbnailUrl: null,
      videoUrl: null,
      resourceId: "video-1",
    });
    expect(parseVideoProviderSnapshot({ video: { status: "processing" } }, "fallback")).toBeNull();
    expect(parseVideoProviderSnapshot(null, "fallback")).toBeNull();
  });
});
