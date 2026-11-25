import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  attachHlsPlayback,
  hlsStallRetryDelayMs,
  HLS_STALL_MAX_AUTO_ATTEMPTS,
  HLS_STALL_RETRY_MAX_MS,
  type HlsConstructor,
  type HlsErrorData,
} from "@/lib/hls-playback-attachment";
import { consumeSourceSwapPlay } from "@/lib/signed-playback-renewal";

const firstUrl = "https://videodelivery.net/aaa.bbb.ccc/manifest/video.m3u8";
const renewedUrl = "https://videodelivery.net/ddd.eee.fff/manifest/video.m3u8";

function fakeVideo({ nativeHls = false, currentTime = 0, paused = false } = {}) {
  const listeners = new Map<string, Set<() => void>>();
  const video = {
    currentTime,
    paused,
    src: "",
    error: null as { code: number } | null,
    canPlayType: vi.fn(() => (nativeHls ? "maybe" : "")),
    play: vi.fn((): Promise<void> => Promise.resolve()),
    addEventListener: vi.fn((name: string, listener: () => void) => {
      if (!listeners.has(name)) listeners.set(name, new Set());
      listeners.get(name)!.add(listener);
    }),
    removeEventListener: vi.fn((name: string, listener: () => void) => listeners.get(name)?.delete(listener)),
    fire(name: string) {
      for (const listener of [...(listeners.get(name) ?? [])]) listener();
    },
    listenerCount(name: string) {
      return listeners.get(name)?.size ?? 0;
    },
  };
  // Like HTMLMediaElement.play(): `paused` turns false at once, the play event is queued.
  video.play.mockImplementation(() => {
    video.paused = false;
    void Promise.resolve().then(() => video.fire("play"));
    return Promise.resolve();
  });
  return video;
}

type FakeHlsInstance = {
  config: { xhrSetup?: (xhr: XMLHttpRequest, url: string) => void } | undefined;
  loadSource: ReturnType<typeof vi.fn>;
  attachMedia: ReturnType<typeof vi.fn>;
  startLoad: ReturnType<typeof vi.fn>;
  destroy: ReturnType<typeof vi.fn>;
  emit: (data: HlsErrorData) => void;
  manifestParsed: () => void;
  fragLoaded: () => void;
};

/** By default a loadSource() parses the manifest a moment later, like an unblocked hls.js. */
function fakeHls(supported: boolean, onLoadSource?: (instance: FakeHlsInstance, url: string) => void) {
  const instances: FakeHlsInstance[] = [];
  class FakeHls {
    static isSupported = () => supported;
    static Events = { ERROR: "hlsError", FRAG_LOADED: "hlsFragLoaded", MANIFEST_PARSED: "hlsManifestParsed" };
    static ErrorTypes = { NETWORK_ERROR: "networkError" };
    static ErrorDetails = { MANIFEST_LOAD_ERROR: "manifestLoadError", MANIFEST_LOAD_TIMEOUT: "manifestLoadTimeOut" };
    private listeners = new Map<string, Array<(event: string, data: HlsErrorData) => void>>();
    loadSource = vi.fn((url: string) => {
      if (onLoadSource) onLoadSource(this as never, url);
      else void Promise.resolve().then(() => this.manifestParsed());
    });
    attachMedia = vi.fn();
    startLoad = vi.fn();
    destroy = vi.fn();
    constructor(public config?: { xhrSetup?: (xhr: XMLHttpRequest, url: string) => void }) {
      instances.push(this as never);
    }
    on(event: string, listener: (event: string, data: HlsErrorData) => void) {
      if (!this.listeners.has(event)) this.listeners.set(event, []);
      this.listeners.get(event)!.push(listener);
    }
    emit(data: HlsErrorData) {
      for (const listener of this.listeners.get("hlsError") ?? []) listener("hlsError", data);
    }
    manifestParsed() {
      for (const listener of this.listeners.get("hlsManifestParsed") ?? []) listener("hlsManifestParsed", {});
    }
    fragLoaded() {
      for (const listener of this.listeners.get("hlsFragLoaded") ?? []) listener("hlsFragLoaded", {});
    }
  }
  return { Hls: FakeHls as unknown as HlsConstructor, instances };
}

async function settle() {
  for (let index = 0; index < 20; index += 1) await Promise.resolve();
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("attachHlsPlayback", () => {
  it("prefers hls.js whenever it is supported, even where native HLS exists", async () => {
    const video = fakeVideo({ nativeHls: true });
    const { Hls, instances } = fakeHls(true);
    const cleanup = attachHlsPlayback({ video: video as never, url: firstUrl, fetchSource: vi.fn(), loadHls: async () => Hls });
    await settle();

    expect(instances).toHaveLength(1);
    expect(instances[0]!.loadSource).toHaveBeenCalledWith(firstUrl);
    expect(instances[0]!.attachMedia).toHaveBeenCalledWith(video);
    expect(instances[0]!.config).toBeUndefined();
    expect(video.src).toBe("");
    cleanup();
    expect(instances[0]!.destroy).toHaveBeenCalled();
  });

  it("falls back to native HLS only when hls.js is unsupported or fails to load", async () => {
    const unsupported = fakeVideo({ nativeHls: true });
    attachHlsPlayback({ video: unsupported as never, url: firstUrl, fetchSource: vi.fn(), loadHls: async () => fakeHls(false).Hls });
    const failed = fakeVideo({ nativeHls: true });
    attachHlsPlayback({ video: failed as never, url: firstUrl, fetchSource: vi.fn(), loadHls: () => Promise.reject(new Error("chunk")) });
    const neither = fakeVideo({ nativeHls: false });
    attachHlsPlayback({ video: neither as never, url: firstUrl, fetchSource: vi.fn(), loadHls: async () => fakeHls(false).Hls });
    await settle();

    expect(unsupported.src).toBe(firstUrl);
    expect(failed.src).toBe(firstUrl);
    expect(neither.src).toBe("");
  });

  it("swaps the token on later hls.js requests after a scheduled renewal", async () => {
    const video = fakeVideo();
    const { Hls, instances } = fakeHls(true);
    const fetchSource = vi.fn().mockResolvedValue({ playbackUrl: renewedUrl, expiresInSeconds: 600 });
    attachHlsPlayback({ video: video as never, url: firstUrl, expiresInSeconds: 600, fetchSource, loadHls: async () => Hls });
    await settle();
    const xhrSetup = instances[0]!.config!.xhrSetup!;
    const xhr = { open: vi.fn() };

    xhrSetup(xhr as never, "https://videodelivery.net/aaa.bbb.ccc/video/1.ts");
    expect(xhr.open).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(8 * 60_000);
    xhrSetup(xhr as never, "https://videodelivery.net/aaa.bbb.ccc/video/2.ts");
    expect(xhr.open).toHaveBeenCalledWith("GET", "https://videodelivery.net/ddd.eee.fff/video/2.ts", true);
    expect(instances[0]!.loadSource).toHaveBeenCalledTimes(1);
  });

  it.each([401, 403])("renews at once and only restarts loading at the stopped position after an hls.js %i error", async (code) => {
    const video = fakeVideo({ currentTime: 321 });
    const { Hls, instances } = fakeHls(true);
    const fetchSource = vi.fn().mockResolvedValue({ playbackUrl: renewedUrl, expiresInSeconds: 600 });
    attachHlsPlayback({ video: video as never, url: firstUrl, expiresInSeconds: 600, fetchSource, loadHls: async () => Hls });
    await settle();

    instances[0]!.emit({ type: "networkError", response: { code } });
    await settle();

    expect(fetchSource).toHaveBeenCalledTimes(1);
    // loadSource() would re-attach the media in hls.js and reset currentTime to 0.
    expect(instances[0]!.loadSource).toHaveBeenCalledTimes(1);
    expect(instances[0]!.loadSource).toHaveBeenCalledWith(firstUrl);
    expect(instances[0]!.startLoad).toHaveBeenCalledExactlyOnceWith(321);
    expect(video.play).not.toHaveBeenCalled();

    // Later requests carry the renewed token.
    const xhr = { open: vi.fn() };
    instances[0]!.config!.xhrSetup!(xhr as never, "https://videodelivery.net/aaa.bbb.ccc/video/9.ts");
    expect(xhr.open).toHaveBeenCalledWith("GET", "https://videodelivery.net/ddd.eee.fff/video/9.ts", true);
  });

  it("resumes a video that the expired token paused, without reporting a viewer play", async () => {
    const video = fakeVideo({ currentTime: 40, paused: false });
    const { Hls, instances } = fakeHls(true);
    const fetchSource = vi.fn().mockResolvedValue({ playbackUrl: renewedUrl, expiresInSeconds: 600 });
    attachHlsPlayback({ video: video as never, url: firstUrl, expiresInSeconds: 600, fetchSource, loadHls: async () => Hls });
    await settle();

    instances[0]!.emit({ type: "networkError", response: { code: 403 } });
    video.paused = true;
    await settle();

    expect(instances[0]!.startLoad).toHaveBeenCalledWith(40);
    expect(video.play).toHaveBeenCalledTimes(1);
    expect(consumeSourceSwapPlay(video)).toBe(true);
  });

  it("does not start a video that was already paused when the token expired", async () => {
    const video = fakeVideo({ currentTime: 40, paused: true });
    const { Hls, instances } = fakeHls(true);
    const fetchSource = vi.fn().mockResolvedValue({ playbackUrl: renewedUrl, expiresInSeconds: 600 });
    attachHlsPlayback({ video: video as never, url: firstUrl, expiresInSeconds: 600, fetchSource, loadHls: async () => Hls });
    await settle();

    instances[0]!.emit({ type: "networkError", response: { code: 403 } });
    await settle();

    expect(instances[0]!.startLoad).toHaveBeenCalledWith(40);
    expect(video.play).not.toHaveBeenCalled();
  });

  it("ignores other hls.js errors and unsigned sources", async () => {
    const video = fakeVideo();
    const { Hls, instances } = fakeHls(true);
    const fetchSource = vi.fn();
    attachHlsPlayback({ video: video as never, url: firstUrl, expiresInSeconds: 600, fetchSource, loadHls: async () => Hls });
    attachHlsPlayback({ video: video as never, url: firstUrl, fetchSource, loadHls: async () => Hls });
    await settle();

    instances[0]!.emit({ type: "networkError", response: { code: 404 } });
    instances[0]!.emit({ type: "mediaError", response: { code: 403 } });
    instances[1]!.emit({ type: "networkError", response: { code: 403 } });
    await settle();
    expect(fetchSource).not.toHaveBeenCalled();
  });

  it("keeps retrying after a refused recovery and reloads once a renewal succeeds", async () => {
    const video = fakeVideo({ currentTime: 50 });
    const { Hls, instances } = fakeHls(true);
    const fetchSource = vi.fn().mockResolvedValueOnce(null).mockResolvedValue({ playbackUrl: renewedUrl, expiresInSeconds: 600 });
    attachHlsPlayback({ video: video as never, url: firstUrl, expiresInSeconds: 600, fetchSource, loadHls: async () => Hls });
    await settle();

    instances[0]!.emit({ type: "networkError", networkDetails: { status: 403 } });
    await settle();
    expect(instances[0]!.startLoad).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(15_000);
    expect(instances[0]!.loadSource).toHaveBeenCalledTimes(1);
    expect(instances[0]!.startLoad).toHaveBeenCalledWith(50);
  });

  it("reloads native HLS on a media network error and marks the resumed play", async () => {
    const video = fakeVideo({ nativeHls: true, currentTime: 88, paused: false });
    const fetchSource = vi.fn().mockResolvedValue({ playbackUrl: renewedUrl, expiresInSeconds: 600 });
    const cleanup = attachHlsPlayback({
      video: video as never, url: firstUrl, expiresInSeconds: 600, fetchSource, loadHls: async () => fakeHls(false).Hls,
    });
    await settle();
    expect(video.src).toBe(firstUrl);

    video.error = { code: 2 };
    video.fire("error");
    await settle();
    expect(video.src).toBe(renewedUrl);

    video.currentTime = 0;
    video.fire("loadedmetadata");
    expect(video.currentTime).toBe(88);
    expect(consumeSourceSwapPlay(video)).toBe(true);

    cleanup();
    expect(video.listenerCount("error")).toBe(0);
  });

  it("drops a pending native source swap on cleanup and on the next swap", async () => {
    const video = fakeVideo({ nativeHls: true, currentTime: 12 });
    const fetchSource = vi.fn()
      .mockResolvedValueOnce({ playbackUrl: renewedUrl, expiresInSeconds: 600 })
      .mockResolvedValueOnce({ playbackUrl: "https://videodelivery.net/ggg.hhh.iii/manifest/video.m3u8", expiresInSeconds: 600 });
    const cleanup = attachHlsPlayback({
      video: video as never, url: firstUrl, expiresInSeconds: 600, fetchSource, loadHls: async () => fakeHls(false).Hls,
    });
    await settle();

    await vi.advanceTimersByTimeAsync(8 * 60_000);
    expect(video.listenerCount("loadedmetadata")).toBe(1);
    await vi.advanceTimersByTimeAsync(8 * 60_000);
    expect(video.listenerCount("loadedmetadata")).toBe(1);

    cleanup();
    expect(video.listenerCount("loadedmetadata")).toBe(0);
  });

  it("stops renewing after cleanup", async () => {
    const video = fakeVideo();
    const { Hls } = fakeHls(true);
    const fetchSource = vi.fn().mockResolvedValue(null);
    const cleanup = attachHlsPlayback({ video: video as never, url: firstUrl, expiresInSeconds: 600, fetchSource, loadHls: async () => Hls });
    await settle();
    cleanup();
    await vi.advanceTimersByTimeAsync(60 * 60_000);
    expect(fetchSource).not.toHaveBeenCalled();
  });
});

describe("hls.js stall recovery after a sustained rejection", () => {
  const forbidden: HlsErrorData = { type: "networkError", details: "fragLoadError", fatal: true, response: { code: 403 } };
  const manifestForbidden: HlsErrorData = { type: "networkError", details: "manifestLoadError", fatal: true, response: { code: 403 } };

  function fakeVisibility(hidden = false) {
    const listeners = new Set<() => void>();
    return {
      hidden,
      addEventListener: vi.fn((_type: string, listener: () => void) => listeners.add(listener)),
      removeEventListener: vi.fn((_type: string, listener: () => void) => listeners.delete(listener)),
      fire() {
        for (const listener of [...listeners]) listener();
      },
      listenerCount: () => listeners.size,
    };
  }

  /**
   * One hls.js player behind a Stream CDN that answers every request with 403 while
   * `cdn.blocked` is true (the staging runner's blanket block): each startLoad() then ends in a
   * fatal 403 (hls.js does not retry 4xx and stops loading), otherwise in a loaded fragment.
   */
  async function stalledPlayer({
    currentTime, paused, hidden = false, tokenSeconds = 1_800, blockedFromOpen = false, renewalMs = 0, reloadFiresPause = false,
  }: {
    currentTime: number; paused: boolean; hidden?: boolean; tokenSeconds?: number; blockedFromOpen?: boolean;
    renewalMs?: number; reloadFiresPause?: boolean;
  }) {
    const video = fakeVideo({ currentTime, paused });
    const visibility = fakeVisibility(hidden);
    const cdn = { blocked: blockedFromOpen };
    const reloads: Array<{ at: number; url: string }> = [];
    // A blocked manifest fails fatally; a reload re-creates the MediaSource, which pauses the
    // element without a pause event (HTML load algorithm; some engines also fire one).
    const { Hls, instances } = fakeHls(true, (instance, url) => {
      reloads.push({ at: Date.now(), url });
      if (reloads.length > 1) {
        if (reloadFiresPause && !video.paused) void Promise.resolve().then(() => video.fire("pause"));
        video.paused = true;
      }
      void Promise.resolve().then(() => {
        if (cdn.blocked) instance.emit(manifestForbidden);
        else {
          instance.manifestParsed();
          instance.fragLoaded();
        }
      });
    });
    const fetches: number[] = [];
    const fetchSource = vi.fn(async () => {
      fetches.push(Date.now());
      const playbackUrl = `https://videodelivery.net/r${fetches.length}.bbb.ccc/manifest/video.m3u8`;
      if (renewalMs > 0) await new Promise((resolve) => { setTimeout(resolve, renewalMs); });
      return { playbackUrl, expiresInSeconds: tokenSeconds };
    });
    const cleanup = attachHlsPlayback({
      video: video as never,
      url: firstUrl,
      expiresInSeconds: tokenSeconds,
      fetchSource,
      loadHls: async () => Hls,
      random: () => 0,
      visibility,
    });
    await settle();
    cdn.blocked = true;
    const hls = instances[0]!;
    const starts: Array<{ at: number; position: number }> = [];
    hls.startLoad.mockImplementation((position: number) => {
      starts.push({ at: Date.now(), position });
      void Promise.resolve().then(() => (cdn.blocked ? hls.emit(forbidden) : hls.fragLoaded()));
    });
    return { video, visibility, hls, fetchSource, fetches, starts, reloads, cdn, cleanup };
  }

  it("backs off from an immediate attempt to a 30 second cap with jitter", () => {
    expect([0, 1, 2, 3, 4, 5, 6, 40].map((level) => hlsStallRetryDelayMs(level, () => 0)))
      .toEqual([0, 2_000, 4_000, 8_000, 16_000, 30_000, 30_000, 30_000]);
    expect(hlsStallRetryDelayMs(1, () => 1)).toBe(1_500);
    expect(hlsStallRetryDelayMs(40, () => 1)).toBe(22_500);
    expect(hlsStallRetryDelayMs(40, () => 7)).toBe(22_500);
    expect(hlsStallRetryDelayMs(40, () => -1)).toBe(HLS_STALL_RETRY_MAX_MS);
  });

  it("resumes a playing video by itself once a 20 second blanket block ends, never from 0", async () => {
    const { video, hls, fetchSource, fetches, starts, cdn } = await stalledPlayer({ currentTime: 100, paused: false });
    const start = Date.now();

    hls.emit(forbidden);
    await settle();
    // The renewal succeeds at once, but the next request is refused again.
    expect(fetchSource).toHaveBeenCalledTimes(1);
    expect(starts).toEqual([{ at: start, position: 100 }]);

    video.currentTime = 112; // still playing out the buffer
    await vi.advanceTimersByTimeAsync(20_000);
    cdn.blocked = false;
    await vi.advanceTimersByTimeAsync(10_000);

    // Attempts at 0, 2, 6, 14 and 30 s; the one at 30 s loads again.
    expect(starts.map((item) => item.at - start)).toEqual([0, 2_000, 6_000, 14_000, 30_000]);
    expect(starts.slice(1).every((item) => item.position === 112)).toBe(true);
    expect(hls.loadSource).toHaveBeenCalledTimes(1);
    // One renewal per stall: the token renewed at 0 s still has more than half its 30 minutes left.
    expect(fetches.map((at) => at - start)).toEqual([0]);
    expect(video.play).not.toHaveBeenCalled();

    // Recovered: no further attempts.
    await vi.advanceTimersByTimeAsync(10 * 60_000);
    expect(starts).toHaveLength(5);
  });

  it("re-requests a manifest that was blocked from page open, then plays as the viewer wanted", async () => {
    const { video, fetches, starts, reloads, cdn } = await stalledPlayer({ currentTime: 0, paused: false, blockedFromOpen: true });
    const start = Date.now();
    await vi.advanceTimersByTimeAsync(20_000);
    cdn.blocked = false;
    await vi.advanceTimersByTimeAsync(10_000);

    // startLoad() does nothing before hls.js has levels, so every attempt reloads the manifest
    // with the newest token: at 0, 2, 6, 14 and 30 s; the one at 30 s parses and loads.
    expect(reloads.map((item) => item.at - start)).toEqual([0, 0, 2_000, 6_000, 14_000, 30_000]);
    expect(reloads[0]!.url).toBe(firstUrl);
    expect(reloads.slice(1).every((item) => item.url === "https://videodelivery.net/r1.bbb.ccc/manifest/video.m3u8")).toBe(true);
    expect(starts).toHaveLength(0);
    expect(fetches.map((at) => at - start)).toEqual([0]);
    // Each reload reset the element; playback resumes because the viewer's intent is still play.
    expect(video.paused).toBe(false);
    expect(video.play).toHaveBeenCalledTimes(5);
    expect(consumeSourceSwapPlay(video)).toBe(true);

    await vi.advanceTimersByTimeAsync(10 * 60_000);
    expect(reloads).toHaveLength(6);
  });

  it("does not take a pause event fired by its own manifest reload as the viewer's pause", async () => {
    const { video, reloads, cdn } = await stalledPlayer({ currentTime: 0, paused: false, blockedFromOpen: true, reloadFiresPause: true });
    await vi.advanceTimersByTimeAsync(6_000);
    cdn.blocked = false;
    await vi.advanceTimersByTimeAsync(8_000);
    expect(reloads).toHaveLength(5);
    expect(video.play).toHaveBeenCalledTimes(4);
    expect(video.paused).toBe(false);
  });

  it("clears the source-swap mark when its own play() is refused, and still hears the viewer's next play", async () => {
    const { video, reloads } = await stalledPlayer({ currentTime: 0, paused: false, blockedFromOpen: true });
    expect(consumeSourceSwapPlay(video)).toBe(true);
    video.play.mockImplementation(() => Promise.reject(new Error("NotAllowedError")));
    await vi.advanceTimersByTimeAsync(2_000);
    expect(reloads).toHaveLength(3);
    expect(consumeSourceSwapPlay(video)).toBe(false);

    await vi.advanceTimersByTimeAsync(1_500);
    video.paused = false;
    video.fire("play");
    await settle();
    expect(reloads).toHaveLength(4);
  });

  it("does not count its own play() after a slow renewal as a viewer retry", async () => {
    const { reloads, fetches } = await stalledPlayer({ currentTime: 0, paused: false, blockedFromOpen: true, renewalMs: 3_000 });
    const start = Date.now();
    await vi.advanceTimersByTimeAsync(10_000);
    // Reload after the 3 s renewal, then the backoff: +2 s and +4 s; no extra attempt from the resumed play.
    expect(reloads.map((item) => item.at - start)).toEqual([0, 3_000, 5_000, 9_000]);
    expect(fetches).toHaveLength(1);
  });

  it("renews again once the stall's token is past half its lifetime", async () => {
    const { hls, fetches, starts } = await stalledPlayer({ currentTime: 100, paused: false, tokenSeconds: 300 });
    const start = Date.now();
    hls.emit(forbidden);
    await settle();
    await vi.advanceTimersByTimeAsync(200_000);
    // Attempts at 0, 2, 6, 14, 30, 60, 90, 120, 150, 180 s; only 0 s and 150 s (half of 300 s) renew.
    expect(starts.map((item) => item.at - start)).toEqual([0, 2_000, 6_000, 14_000, 30_000, 60_000, 90_000, 120_000, 150_000, 180_000]);
    expect(fetches.map((at) => at - start)).toEqual([0, 150_000]);
  });

  it("keeps a paused video paused at its position, and loads at once when the viewer presses play", async () => {
    const { video, hls, starts, cdn } = await stalledPlayer({ currentTime: 500, paused: true });
    const start = Date.now();
    hls.emit(forbidden);
    await settle();

    await vi.advanceTimersByTimeAsync(20_000);
    cdn.blocked = false;
    // Before the next scheduled attempt (30 s) the viewer presses play.
    await vi.advanceTimersByTimeAsync(5_000);
    expect(video.play).not.toHaveBeenCalled();
    expect(starts.every((item) => item.position === 500)).toBe(true);
    const before = starts.length;

    video.paused = false;
    video.fire("play");
    await settle();
    expect(starts).toHaveLength(before + 1);
    expect(starts.at(-1)).toEqual({ at: start + 25_000, position: 500 });
    expect(video.play).not.toHaveBeenCalled();

    // The loaded fragment ended the stall; the 30 s attempt does not run.
    await vi.advanceTimersByTimeAsync(60_000);
    expect(starts).toHaveLength(before + 1);
  });

  it("recovers a paused video by itself too, without starting it", async () => {
    const { video, hls, starts, cdn } = await stalledPlayer({ currentTime: 500, paused: true });
    hls.emit(forbidden);
    await settle();
    await vi.advanceTimersByTimeAsync(20_000);
    cdn.blocked = false;
    await vi.advanceTimersByTimeAsync(10_000);
    expect(starts).toHaveLength(5);
    expect(starts.every((item) => item.position === 500)).toBe(true);
    expect(video.play).not.toHaveBeenCalled();
  });

  it("does not undo a viewer pause made during the stall", async () => {
    const { video, hls, starts, cdn } = await stalledPlayer({ currentTime: 100, paused: false });
    hls.emit(forbidden);
    await settle();
    video.paused = true;
    video.fire("pause");
    cdn.blocked = false;
    await vi.advanceTimersByTimeAsync(5_000);
    expect(starts).toHaveLength(2);
    expect(video.play).not.toHaveBeenCalled();
  });

  it("caps automatic attempts and renewals during an endless block, then retries only on viewer action", async () => {
    const { video, visibility, hls, fetches, starts } = await stalledPlayer({ currentTime: 100, paused: false });
    const start = Date.now();
    hls.emit(forbidden);
    await settle();

    await vi.advanceTimersByTimeAsync(20 * 60_000);
    expect(starts).toHaveLength(1 + HLS_STALL_MAX_AUTO_ATTEMPTS);
    expect(starts.at(-1)!.at - start).toBeLessThan(10 * 60_000);
    const gaps = starts.slice(1).map((item, index) => item.at - starts[index]!.at);
    expect(Math.max(...gaps)).toBe(HLS_STALL_RETRY_MAX_MS);
    expect(Math.min(...gaps)).toBe(2_000);
    // One renewal for the whole stall: the 30 minute token stays more than half valid.
    expect(fetches.map((at) => at - start)).toEqual([0]);

    // Then quiet for an hour, apart from one restart per scheduled renewal (every 28 minutes).
    const exhausted = starts.length;
    await vi.advanceTimersByTimeAsync(60 * 60_000);
    expect(starts.length - exhausted).toBe(2);

    // The tab showing again retries the stall even with no automatic attempts left.
    const quiet = starts.length;
    visibility.hidden = true;
    visibility.fire();
    visibility.hidden = false;
    visibility.fire();
    await settle();
    expect(starts).toHaveLength(quiet + 1);

    await vi.advanceTimersByTimeAsync(1_000);
    video.fire("play");
    await settle();
    expect(starts).toHaveLength(quiet + 2);
    expect(starts.every((item) => item.position === 100)).toBe(true);
  });

  it("does not loop without delay when loading fails again right after a recovery", async () => {
    const { hls, starts, cdn } = await stalledPlayer({ currentTime: 100, paused: false });
    const start = Date.now();
    hls.emit(forbidden);
    await settle();
    cdn.blocked = false;
    await vi.advanceTimersByTimeAsync(2_000);
    expect(starts).toHaveLength(2);
    // The failure returns 1 s after the fragment loaded: the backoff continues instead of restarting at 0.
    cdn.blocked = true;
    await vi.advanceTimersByTimeAsync(1_000);
    hls.emit(forbidden);
    await settle();
    expect(starts).toHaveLength(2);
    await vi.advanceTimersByTimeAsync(8_000);
    expect(starts.map((item) => item.at - start)).toEqual([0, 2_000, 7_000]);
  });

  it("restarts other fatal network errors without renewing, and ignores non-fatal ones", async () => {
    const { hls, fetchSource, starts, cdn } = await stalledPlayer({ currentTime: 70, paused: false });
    hls.emit({ type: "networkError", fatal: false, response: { code: 502 } });
    await settle();
    expect(starts).toHaveLength(0);

    cdn.blocked = false;
    hls.emit({ type: "networkError", fatal: true, response: { code: 0 } });
    await settle();
    expect(starts).toEqual([{ at: Date.now(), position: 70 }]);
    expect(fetchSource).not.toHaveBeenCalled();
  });

  it("waits for a hidden tab to show before reloading a paused video", async () => {
    const { video, visibility, hls, starts, fetchSource, cdn } = await stalledPlayer({ currentTime: 300, paused: true, hidden: true });
    hls.emit(forbidden);
    await settle();
    cdn.blocked = false;
    await vi.advanceTimersByTimeAsync(10 * 60_000);
    expect(starts).toHaveLength(0);
    expect(fetchSource).not.toHaveBeenCalled();

    visibility.hidden = false;
    visibility.fire();
    await settle();
    expect(starts).toEqual([{ at: Date.now(), position: 300 }]);
    expect(video.play).not.toHaveBeenCalled();
  });

  it("keeps retrying a playing video in a hidden tab", async () => {
    const { hls, starts, cdn } = await stalledPlayer({ currentTime: 300, paused: false, hidden: true });
    hls.emit(forbidden);
    await settle();
    cdn.blocked = false;
    await vi.advanceTimersByTimeAsync(2_000);
    expect(starts).toHaveLength(2);
  });

  it("stops retrying and removes its listeners on cleanup", async () => {
    const { video, visibility, hls, starts, cleanup } = await stalledPlayer({ currentTime: 100, paused: false });
    hls.emit(forbidden);
    await settle();
    expect(starts).toHaveLength(1);
    cleanup();
    await vi.advanceTimersByTimeAsync(10 * 60_000);
    expect(starts).toHaveLength(1);
    expect(video.listenerCount("play")).toBe(0);
    expect(video.listenerCount("pause")).toBe(0);
    expect(visibility.listenerCount()).toBe(0);
  });
});
