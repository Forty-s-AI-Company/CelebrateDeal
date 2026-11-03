import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  consumeSourceSwapPlay,
  createSignedPlaybackRenewal,
  signedPlaybackRenewalDelayMs,
  signedPlaybackRetryDelayMs,
  SIGNED_PLAYBACK_MIN_RECOVERY_INTERVAL_MS,
  SIGNED_PLAYBACK_MIN_RENEWAL_DELAY_MS,
  SIGNED_PLAYBACK_RETRY_MAX_MS,
  swapNativePlaybackSource,
  withCurrentStreamToken,
} from "@/lib/signed-playback-renewal";

const oldToken = "aaa.bbb.ccc";
const newToken = "ddd.eee.fff";
const t2 = "https://videodelivery.net/t2/manifest/video.m3u8";
const t3 = "https://videodelivery.net/t3/manifest/video.m3u8";

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("delays", () => {
  it("renews two minutes before a normal token lapses", () => {
    expect(signedPlaybackRenewalDelayMs(600)).toBe(8 * 60_000);
    expect(signedPlaybackRenewalDelayMs(1_800)).toBe(28 * 60_000);
  });

  it("renews halfway through a short token, but not more often than the minimum delay", () => {
    expect(signedPlaybackRenewalDelayMs(120)).toBe(60_000);
    expect(signedPlaybackRenewalDelayMs(2)).toBe(SIGNED_PLAYBACK_MIN_RENEWAL_DELAY_MS);
  });

  it("backs off failed renewals exponentially up to five minutes", () => {
    expect([0, 1, 2, 3, 4, 5, 50].map(signedPlaybackRetryDelayMs))
      .toEqual([15_000, 30_000, 60_000, 120_000, 240_000, SIGNED_PLAYBACK_RETRY_MAX_MS, SIGNED_PLAYBACK_RETRY_MAX_MS]);
  });
});

describe("createSignedPlaybackRenewal", () => {
  it("re-requests the source before expiry and keeps renewing with each new expiry", async () => {
    const fetchSource = vi.fn()
      .mockResolvedValueOnce({ playbackUrl: t2, expiresInSeconds: 600 })
      .mockResolvedValueOnce({ playbackUrl: t3, expiresInSeconds: 600 });
    const applySource = vi.fn();
    const renewal = createSignedPlaybackRenewal({ expiresInSeconds: 600, fetchSource, applySource });

    await vi.advanceTimersByTimeAsync(8 * 60_000 - 1);
    expect(fetchSource).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(applySource).toHaveBeenLastCalledWith(t2);

    await vi.advanceTimersByTimeAsync(8 * 60_000);
    expect(applySource).toHaveBeenLastCalledWith(t3);
    expect(fetchSource).toHaveBeenCalledTimes(2);
    renewal.stop();
  });

  it("keeps retrying with backoff past the token expiry while the player is mounted", async () => {
    const fetchSource = vi.fn().mockResolvedValue(null);
    const applySource = vi.fn();
    const renewal = createSignedPlaybackRenewal({ expiresInSeconds: 600, fetchSource, applySource });

    // 8:00, then +15 s, +30 s, +60 s, +120 s, +240 s, +300 s ... well past the 10:00 expiry.
    await vi.advanceTimersByTimeAsync(8 * 60_000 + 15_000 + 30_000 + 60_000 + 120_000 + 240_000 + 300_000);
    expect(fetchSource).toHaveBeenCalledTimes(7);

    fetchSource.mockResolvedValueOnce({ playbackUrl: t2, expiresInSeconds: 600 });
    await vi.advanceTimersByTimeAsync(300_000);
    expect(applySource).toHaveBeenCalledWith(t2);

    renewal.stop();
    const calls = fetchSource.mock.calls.length;
    await vi.advanceTimersByTimeAsync(60 * 60_000);
    expect(fetchSource).toHaveBeenCalledTimes(calls);
  });

  it("treats a thrown renewal like a refusal", async () => {
    const fetchSource = vi.fn().mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValueOnce({ playbackUrl: t2, expiresInSeconds: 600 });
    const applySource = vi.fn();
    createSignedPlaybackRenewal({ expiresInSeconds: 600, fetchSource, applySource });

    await vi.advanceTimersByTimeAsync(8 * 60_000 + 15_000);
    expect(applySource).toHaveBeenCalledWith(t2);
  });

  it("applies an unsigned source once and stops when the server no longer signs", async () => {
    const fetchSource = vi.fn().mockResolvedValue({ playbackUrl: "https://videodelivery.net/uid/manifest/video.m3u8" });
    const applySource = vi.fn();
    createSignedPlaybackRenewal({ expiresInSeconds: 600, fetchSource, applySource });

    await vi.advanceTimersByTimeAsync(60 * 60_000);
    expect(fetchSource).toHaveBeenCalledTimes(1);
    expect(applySource).toHaveBeenCalledTimes(1);
  });

  it("renews immediately on demand, shares an in-flight request and rate-limits recoveries", async () => {
    let resolveFetch: (value: unknown) => void = () => undefined;
    const fetchSource = vi.fn(() => new Promise((resolve) => { resolveFetch = resolve; }));
    const applySource = vi.fn();
    const renewal = createSignedPlaybackRenewal({
      expiresInSeconds: 600,
      fetchSource: fetchSource as never,
      applySource,
    });

    const first = renewal.renewNow();
    const shared = renewal.renewNow();
    expect(fetchSource).toHaveBeenCalledTimes(1);
    resolveFetch({ playbackUrl: t2, expiresInSeconds: 600 });
    await expect(first).resolves.toBe(t2);
    await expect(shared).resolves.toBe(t2);
    expect(applySource).toHaveBeenCalledWith(t2);

    await expect(renewal.renewNow()).resolves.toBeNull();
    expect(fetchSource).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(SIGNED_PLAYBACK_MIN_RECOVERY_INTERVAL_MS);
    void renewal.renewNow();
    expect(fetchSource).toHaveBeenCalledTimes(2);
    renewal.stop();
  });

  it("stops cleanly, including a renewal already in flight", async () => {
    let resolveFetch: (value: unknown) => void = () => undefined;
    const fetchSource = vi.fn(() => new Promise((resolve) => { resolveFetch = resolve; }));
    const applySource = vi.fn();
    const renewal = createSignedPlaybackRenewal({ expiresInSeconds: 600, fetchSource: fetchSource as never, applySource });

    await vi.advanceTimersByTimeAsync(8 * 60_000);
    renewal.stop();
    resolveFetch({ playbackUrl: t2, expiresInSeconds: 600 });
    await vi.advanceTimersByTimeAsync(60 * 60_000);
    expect(applySource).not.toHaveBeenCalled();
    expect(fetchSource).toHaveBeenCalledTimes(1);
    await expect(renewal.renewNow()).resolves.toBeNull();
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

  it("restores the position, keeps playing, and marks the resulting play as a source swap", () => {
    const video = fakeVideo(312, false);
    swapNativePlaybackSource(video as unknown as HTMLVideoElement, "https://videodelivery.net/new/manifest/video.m3u8");
    expect(video.src).toBe("https://videodelivery.net/new/manifest/video.m3u8");

    video.currentTime = 0;
    video.fire("loadedmetadata");
    expect(video.currentTime).toBe(312);
    expect(video.play).toHaveBeenCalledTimes(1);
    expect(consumeSourceSwapPlay(video)).toBe(true);
    expect(consumeSourceSwapPlay(video)).toBe(false);
  });

  it("does not resume or mark a paused video", () => {
    const video = fakeVideo(40, true);
    swapNativePlaybackSource(video as unknown as HTMLVideoElement, "https://videodelivery.net/new/manifest/video.m3u8");
    video.fire("loadedmetadata");
    expect(video.play).not.toHaveBeenCalled();
    expect(consumeSourceSwapPlay(video)).toBe(false);
  });
});
