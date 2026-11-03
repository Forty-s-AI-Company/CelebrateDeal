import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  scheduleSignedPlaybackRenewal,
  signedPlaybackRenewalDelayMs,
  SIGNED_PLAYBACK_MIN_RENEWAL_DELAY_MS,
  SIGNED_PLAYBACK_RETRY_DELAY_MS,
  swapNativePlaybackSource,
  withCurrentStreamToken,
} from "@/lib/signed-playback-renewal";

const oldToken = "aaa.bbb.ccc";
const newToken = "ddd.eee.fff";

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("signedPlaybackRenewalDelayMs", () => {
  it("renews two minutes before a normal token lapses", () => {
    expect(signedPlaybackRenewalDelayMs(600)).toBe(8 * 60_000);
    expect(signedPlaybackRenewalDelayMs(1_800)).toBe(28 * 60_000);
  });

  it("renews halfway through a short token, but not more often than the minimum delay", () => {
    expect(signedPlaybackRenewalDelayMs(120)).toBe(60_000);
    expect(signedPlaybackRenewalDelayMs(2)).toBe(SIGNED_PLAYBACK_MIN_RENEWAL_DELAY_MS);
  });
});

describe("scheduleSignedPlaybackRenewal", () => {
  it("re-requests the source before expiry and keeps renewing with each new expiry", async () => {
    const fetchSource = vi.fn()
      .mockResolvedValueOnce({ playbackUrl: "https://videodelivery.net/t2/manifest/video.m3u8", expiresInSeconds: 600 })
      .mockResolvedValueOnce({ playbackUrl: "https://videodelivery.net/t3/manifest/video.m3u8", expiresInSeconds: 600 });
    const applySource = vi.fn();
    const stop = scheduleSignedPlaybackRenewal({ expiresInSeconds: 600, fetchSource, applySource });

    await vi.advanceTimersByTimeAsync(8 * 60_000 - 1);
    expect(fetchSource).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(applySource).toHaveBeenLastCalledWith("https://videodelivery.net/t2/manifest/video.m3u8");

    await vi.advanceTimersByTimeAsync(8 * 60_000);
    expect(applySource).toHaveBeenLastCalledWith("https://videodelivery.net/t3/manifest/video.m3u8");
    expect(fetchSource).toHaveBeenCalledTimes(2);
    stop();
  });

  it("retries a refused renewal only while the current token is still valid", async () => {
    const fetchSource = vi.fn().mockResolvedValue(null);
    const applySource = vi.fn();
    scheduleSignedPlaybackRenewal({ expiresInSeconds: 600, fetchSource, applySource });

    // First attempt at 8:00, then 8:30, 9:00, 9:30; 10:00 is the expiry, so no retry at or past it.
    await vi.advanceTimersByTimeAsync(20 * 60_000);
    expect(fetchSource).toHaveBeenCalledTimes(4);
    expect(applySource).not.toHaveBeenCalled();
    expect(SIGNED_PLAYBACK_RETRY_DELAY_MS).toBe(30_000);
  });

  it("treats a thrown renewal like a refusal", async () => {
    const fetchSource = vi.fn().mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValueOnce({ playbackUrl: "https://videodelivery.net/t2/manifest/video.m3u8", expiresInSeconds: 600 });
    const applySource = vi.fn();
    scheduleSignedPlaybackRenewal({ expiresInSeconds: 600, fetchSource, applySource });

    await vi.advanceTimersByTimeAsync(8 * 60_000 + SIGNED_PLAYBACK_RETRY_DELAY_MS);
    expect(applySource).toHaveBeenCalledWith("https://videodelivery.net/t2/manifest/video.m3u8");
  });

  it("applies an unsigned source once and stops when the server no longer signs", async () => {
    const fetchSource = vi.fn().mockResolvedValue({ playbackUrl: "https://videodelivery.net/uid/manifest/video.m3u8" });
    const applySource = vi.fn();
    scheduleSignedPlaybackRenewal({ expiresInSeconds: 600, fetchSource, applySource });

    await vi.advanceTimersByTimeAsync(60 * 60_000);
    expect(fetchSource).toHaveBeenCalledTimes(1);
    expect(applySource).toHaveBeenCalledTimes(1);
  });

  it("stops cleanly, including a renewal already in flight", async () => {
    let resolveFetch: (value: unknown) => void = () => undefined;
    const fetchSource = vi.fn(() => new Promise<never>((resolve) => { resolveFetch = resolve as never; }));
    const applySource = vi.fn();
    const stop = scheduleSignedPlaybackRenewal({ expiresInSeconds: 600, fetchSource, applySource });

    await vi.advanceTimersByTimeAsync(8 * 60_000);
    stop();
    resolveFetch({ playbackUrl: "https://videodelivery.net/t2/manifest/video.m3u8", expiresInSeconds: 600 });
    await vi.advanceTimersByTimeAsync(60 * 60_000);
    expect(applySource).not.toHaveBeenCalled();
    expect(fetchSource).toHaveBeenCalledTimes(1);
  });
});

describe("withCurrentStreamToken", () => {
  const current = `https://videodelivery.net/${newToken}/manifest/video.m3u8`;

  it("swaps the token in manifest and segment requests", () => {
    expect(withCurrentStreamToken(`https://videodelivery.net/${oldToken}/manifest/stream_1.m3u8?p=1`, current))
      .toBe(`https://videodelivery.net/${newToken}/manifest/stream_1.m3u8?p=1`);
    expect(withCurrentStreamToken(`https://videodelivery.net/${oldToken}/video/720/seg_3.ts`, current))
      .toBe(`https://videodelivery.net/${newToken}/video/720/seg_3.ts`);
  });

  it("follows a host change to the customer subdomain", () => {
    expect(withCurrentStreamToken(
      `https://videodelivery.net/${oldToken}/manifest/video.m3u8`,
      `https://customer-abc.cloudflarestream.com/${newToken}/manifest/video.m3u8`,
    )).toBe(`https://customer-abc.cloudflarestream.com/${newToken}/manifest/video.m3u8`);
  });

  it.each([
    "https://video.example.test/aaa.bbb.ccc/manifest/video.m3u8",
    "https://videodelivery.net/a1b2c3d4e5f60718293a4b5c6d7e8f90/manifest/video.m3u8",
    "not a url",
  ])("leaves unrelated or unsigned requests untouched: %s", (url) => {
    expect(withCurrentStreamToken(url, current)).toBe(url);
  });
});

describe("swapNativePlaybackSource", () => {
  function fakeVideo(currentTime: number, paused: boolean) {
    const listeners = new Map<string, () => void>();
    return {
      currentTime,
      paused,
      src: "https://videodelivery.net/old/manifest/video.m3u8",
      play: vi.fn(() => Promise.resolve()),
      addEventListener: vi.fn((name: string, listener: () => void) => listeners.set(name, listener)),
      removeEventListener: vi.fn((name: string) => listeners.delete(name)),
      fire(name: string) {
        listeners.get(name)?.();
      },
    };
  }

  it("restores the position and keeps playing after the source swap", () => {
    const video = fakeVideo(312, false);
    swapNativePlaybackSource(video as unknown as HTMLVideoElement, "https://videodelivery.net/new/manifest/video.m3u8");
    expect(video.src).toBe("https://videodelivery.net/new/manifest/video.m3u8");

    video.currentTime = 0;
    video.fire("loadedmetadata");
    expect(video.currentTime).toBe(312);
    expect(video.play).toHaveBeenCalledTimes(1);
    expect(video.removeEventListener).toHaveBeenCalledWith("loadedmetadata", expect.any(Function));
  });

  it("does not resume a paused video", () => {
    const video = fakeVideo(40, true);
    swapNativePlaybackSource(video as unknown as HTMLVideoElement, "https://videodelivery.net/new/manifest/video.m3u8");
    video.fire("loadedmetadata");
    expect(video.play).not.toHaveBeenCalled();
  });
});
