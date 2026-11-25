import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  attachHlsPlayback,
  hlsStallRetryDelayMs,
  HLS_STALL_MAX_AUTO_ATTEMPTS,
  HLS_STALL_RETRY_MAX_MS,
  NATIVE_MAX_ERROR_RECOVERIES,
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

  it("never assigns the manifest to the element's native src on the hls.js path, through renewal and recovery", async () => {
    const video = fakeVideo({ nativeHls: true });
    const assigned: unknown[] = [];
    let current = "";
    Object.defineProperty(video, "src", {
      get: () => current,
      set: (value: string) => { assigned.push(value); current = value; },
    });
    const { Hls, instances } = fakeHls(true);
    const fetchSource = vi.fn().mockResolvedValue({ playbackUrl: renewedUrl, expiresInSeconds: 600 });
    const cleanup = attachHlsPlayback({ video: video as never, url: firstUrl, expiresInSeconds: 600, fetchSource, loadHls: async () => Hls });
    await settle();
    await vi.advanceTimersByTimeAsync(8 * 60_000);
    instances[0]!.emit({ type: "networkError", response: { code: 403 } });
    await settle();
    cleanup();

    expect(instances[0]!.attachMedia).toHaveBeenCalledWith(video);
    expect(assigned).toEqual([]);
  });

  it("sets the native src only on the native HLS path, again after a renewal", async () => {
    const video = fakeVideo({ nativeHls: true });
    const assigned: string[] = [];
    let current = "";
    Object.defineProperty(video, "src", {
      get: () => current,
      set: (value: string) => { assigned.push(value); current = value; },
    });
    const { Hls } = fakeHls(false);
    const fetchSource = vi.fn().mockResolvedValue({ playbackUrl: renewedUrl, expiresInSeconds: 600 });
    const cleanup = attachHlsPlayback({ video: video as never, url: firstUrl, expiresInSeconds: 600, fetchSource, loadHls: async () => Hls });
    await settle();
    expect(assigned).toEqual([firstUrl]);
    await vi.advanceTimersByTimeAsync(8 * 60_000);
    expect(assigned[0]).toBe(firstUrl);
    cleanup();
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
    // The attachment's own listener (it ends the native error-recovery count).
    expect(video.listenerCount("loadedmetadata")).toBe(1);

    await vi.advanceTimersByTimeAsync(8 * 60_000);
    expect(video.listenerCount("loadedmetadata")).toBe(2);
    await vi.advanceTimersByTimeAsync(8 * 60_000);
    expect(video.listenerCount("loadedmetadata")).toBe(2);

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
    successfulRenewals = Number.POSITIVE_INFINITY,
  }: {
    currentTime: number; paused: boolean; hidden?: boolean; tokenSeconds?: number; blockedFromOpen?: boolean;
    renewalMs?: number; reloadFiresPause?: boolean; successfulRenewals?: number;
  }) {
    const video = fakeVideo({ currentTime, paused });
    const visibility = fakeVisibility(hidden);
    const cdn = { blocked: blockedFromOpen };
    const reloads: Array<{ at: number; url: string }> = [];
    // A blocked manifest fails fatally. Like hls.js, a reload re-creates the MediaSource only
    // for a different URL (no source buffers exist before a manifest parsed), which pauses the
    // element without a pause event (HTML load algorithm; some engines also fire one).
    let loadedUrl: string | null = null;
    const { Hls, instances } = fakeHls(true, (instance, url) => {
      reloads.push({ at: Date.now(), url });
      const rebuilds = loadedUrl !== null && url !== loadedUrl;
      loadedUrl = url;
      if (rebuilds) {
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
      if (fetches.length > successfulRenewals) return null;
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
    // The token renewed at 0 s is reused at 2 and 6 s; after three failed attempts on it, 14 s renews again.
    expect(fetches.map((at) => at - start)).toEqual([0, 14_000]);
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
    const r1 = "https://videodelivery.net/r1.bbb.ccc/manifest/video.m3u8";
    const r2 = "https://videodelivery.net/r2.bbb.ccc/manifest/video.m3u8";
    expect(reloads.map((item) => item.url)).toEqual([firstUrl, r1, r1, r1, r2, r2]);
    expect(starts).toHaveLength(0);
    expect(fetches.map((at) => at - start)).toEqual([0, 14_000]);
    // Only the reloads with a new URL (0 and 14 s) reset the element; playback resumes each time
    // because the viewer's intent is still play.
    expect(video.paused).toBe(false);
    expect(video.play).toHaveBeenCalledTimes(2);
    expect(consumeSourceSwapPlay(video)).toBe(true);

    await vi.advanceTimersByTimeAsync(10 * 60_000);
    expect(reloads).toHaveLength(6);
  });

  it("does not take a pause event fired by its own manifest reload as the viewer's pause", async () => {
    const { video, reloads, cdn } = await stalledPlayer({ currentTime: 0, paused: false, blockedFromOpen: true, reloadFiresPause: true });
    await vi.advanceTimersByTimeAsync(6_000);
    cdn.blocked = false;
    await vi.advanceTimersByTimeAsync(8_000);
    // Resets at 0 s (first URL to r1) and 14 s (r1 to r2) each fired a pause; the viewer's intent stays play.
    expect(reloads).toHaveLength(5);
    expect(video.play).toHaveBeenCalledTimes(2);
    expect(video.paused).toBe(false);
  });

  it("keeps a viewer pause made during the stall when the reload fired no pause event", async () => {
    const { video, reloads, cdn } = await stalledPlayer({ currentTime: 0, paused: false, blockedFromOpen: true });
    expect(video.play).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1_000);
    video.paused = true;
    video.fire("pause");
    cdn.blocked = false;
    await vi.advanceTimersByTimeAsync(60_000);
    expect(reloads).toHaveLength(3);
    expect(video.play).toHaveBeenCalledTimes(1);
    expect(video.paused).toBe(true);
  });

  it("does not let an older play() aborted by a later reload clear the newer resume's mark", async () => {
    const { video, reloads } = await stalledPlayer({ currentTime: 0, paused: false, blockedFromOpen: true });
    consumeSourceSwapPlay(video);
    video.play.mockClear();
    const pending: Array<(reason: Error) => void> = [];
    video.play.mockImplementation(() => {
      video.paused = false;
      // The reload that led to this play() aborted the previous pending one.
      for (const reject of pending.splice(0)) reject(new Error("AbortError"));
      void Promise.resolve().then(() => video.fire("play"));
      return new Promise<void>((_resolve, reject) => { pending.push(reject); });
    });
    await vi.advanceTimersByTimeAsync(14_000);
    expect(video.play).toHaveBeenCalledTimes(1);
    expect(consumeSourceSwapPlay(video)).toBe(true);

    // 90 s: the third renewal resets the element again; its play() aborts the one from 14 s.
    await vi.advanceTimersByTimeAsync(76_000);
    expect(reloads.at(-1)!.url).toBe("https://videodelivery.net/r3.bbb.ccc/manifest/video.m3u8");
    expect(video.play).toHaveBeenCalledTimes(2);
    expect(consumeSourceSwapPlay(video)).toBe(true);
  });

  it("clears the source-swap mark when its own play() is refused, and still hears the viewer's next play", async () => {
    const { video, reloads } = await stalledPlayer({ currentTime: 0, paused: false, blockedFromOpen: true });
    expect(consumeSourceSwapPlay(video)).toBe(true);
    video.play.mockClear();
    video.play.mockImplementation(() => Promise.reject(new Error("NotAllowedError")));
    // 14 s: the renewed URL resets the element and the refused play() fires no play event.
    await vi.advanceTimersByTimeAsync(14_000);
    expect(reloads).toHaveLength(5);
    expect(video.play).toHaveBeenCalledTimes(1);
    expect(consumeSourceSwapPlay(video)).toBe(false);

    await vi.advanceTimersByTimeAsync(1_500);
    video.paused = false;
    video.fire("play");
    await settle();
    expect(reloads).toHaveLength(6);
  });

  it("does not count its own play() after a slow renewal as a viewer retry", async () => {
    const { reloads, fetches } = await stalledPlayer({ currentTime: 0, paused: false, blockedFromOpen: true, renewalMs: 3_000 });
    const start = Date.now();
    await vi.advanceTimersByTimeAsync(10_000);
    // Reload after the 3 s renewal, then the backoff: +2 s and +4 s; no extra attempt from the resumed play.
    expect(reloads.map((item) => item.at - start)).toEqual([0, 3_000, 5_000, 9_000]);
    expect(fetches).toHaveLength(1);
  });

  it("reuses a long token for at most 2 minutes before renewing again", async () => {
    const { video, visibility, hls, fetches, starts } = await stalledPlayer({ currentTime: 100, paused: true, tokenSeconds: 7_200 });
    const start = Date.now();
    hls.emit(forbidden);
    await settle();
    expect(fetches).toHaveLength(1);
    // The paused player goes to a background tab, so the backoff waits for it to show.
    visibility.hidden = true;
    await vi.advanceTimersByTimeAsync(60_000);
    visibility.hidden = false;
    visibility.fire();
    await settle();
    expect(starts.map((item) => item.at - start)).toEqual([0, 60_000]);
    expect(fetches).toHaveLength(1);

    visibility.hidden = true;
    await vi.advanceTimersByTimeAsync(120_000);
    visibility.hidden = false;
    visibility.fire();
    await settle();
    // 180 s after the renewal: past the 2 minute reuse window though the token lasts 2 hours.
    expect(starts.map((item) => item.at - start)).toEqual([0, 60_000, 180_000]);
    expect(fetches.map((at) => at - start)).toEqual([0, 180_000]);
    expect(video.play).not.toHaveBeenCalled();
  });

  it("stops loading with the stall's token once it expired and renewals keep failing", async () => {
    const { hls, starts, fetches } = await stalledPlayer({ currentTime: 100, paused: false, tokenSeconds: 60, successfulRenewals: 1 });
    const start = Date.now();
    hls.emit(forbidden);
    await settle();
    await vi.advanceTimersByTimeAsync(10 * 60_000);
    // The 60 s token renewed at 0 s is still used at 30 s; from 60 s on it has expired.
    expect(starts.map((item) => item.at - start)).toEqual([0, 2_000, 6_000, 14_000, 30_000]);
    expect(fetches.length).toBeGreaterThan(5);
  });

  it("calls play() once through failed startLoad attempts and resumes at the stopped position", async () => {
    const { video, hls, starts, cdn } = await stalledPlayer({ currentTime: 100, paused: false });
    hls.emit(forbidden);
    await settle();
    // The element reports paused without a pause event: the state the existing test
    // "resumes a video that the expired token paused" covers. The viewer's intent is still play.
    await vi.advanceTimersByTimeAsync(3_000);
    video.paused = true;
    video.currentTime = 112;
    await vi.advanceTimersByTimeAsync(17_000);
    expect(starts).toHaveLength(4);
    expect(video.play).toHaveBeenCalledTimes(1);

    cdn.blocked = false;
    await vi.advanceTimersByTimeAsync(10_000);
    expect(starts).toHaveLength(5);
    expect(starts.slice(2).every((item) => item.position === 112)).toBe(true);
    expect(video.play).toHaveBeenCalledTimes(1);
    expect(consumeSourceSwapPlay(video)).toBe(true);
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
    // One renewal per three failed attempts on the same token, at least 5 s apart.
    expect(fetches).toHaveLength(7);
    expect(fetches[0]! - start).toBe(0);
    expect(Math.min(...fetches.slice(1).map((at, index) => at - fetches[index]!))).toBeGreaterThanOrEqual(5_000);

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

/**
 * A Cloudflare Stream stand-in: the entry manifest and media playlists are token-form, and a
 * media playlist fetched with token T lists uid-form init／segment URIs signed for T
 * (`?p=T&s=sig-T`), the shapes staging run 45713686375 recorded. A refused token answers 401.
 */
describe("renewed token reaches the Cloudflare-signed segment URIs", () => {
  const uid = "0123456789abcdef0123456789abcdef";
  const firstToken = "aaa.bbb.ccc";
  const variantFile = "stream_t0a1b2c3d4e5f6a7b8c9d0.m3u8";
  const tokenUrl = (token: string, file = "video.m3u8") => `https://videodelivery.net/${token}/manifest/${file}`;
  const signed = (path: string, token: string) => `https://videodelivery.net/${uid}/video/720/${path}?p=${token}&s=sig-${token}`;
  const mediaPlaylist = (token: string) => [
    "#EXTM3U",
    "#EXT-X-PLAYLIST-TYPE:VOD",
    `#EXT-X-MAP:URI="/${uid}/video/720/init.mp4?p=${token}&s=sig-${token}"`,
    ...[1, 2, 3, 4, 5].flatMap((n) => ["#EXTINF:6.0,", `/${uid}/video/720/seg_${n}.mp4?p=${token}&s=sig-${token}`]),
    "#EXT-X-ENDLIST",
  ].join("\n");
  const tokenOf = (value: string) => new URL(value).pathname.split("/")[1]!;
  const unauthorized = { status: 401, text: async () => "401 Unauthorized: signature expired" };
  const unauthorizedFragment: HlsErrorData = { type: "networkError", details: "fragLoadError", fatal: false, response: { code: 401 } };
  type PlaylistResponse = { status: number; text: () => Promise<string> };

  async function vodPlayer({
    live = false, tokenSeconds = 1_800, refused = () => false,
    fetchPlaylist: customFetch,
    heldPlaylistUrl = tokenUrl(firstToken, variantFile),
  }: {
    live?: boolean;
    tokenSeconds?: number;
    refused?: (token: string) => boolean;
    fetchPlaylist?: (url: string) => Promise<PlaylistResponse>;
    heldPlaylistUrl?: string;
  } = {}) {
    const video = Object.assign(fakeVideo({ currentTime: 600, paused: false }), { playbackRate: 1.5 });
    const { Hls, instances } = fakeHls(true);
    let renewals = 0;
    const fetchSource = vi.fn(async () => ({ playbackUrl: tokenUrl(`r${++renewals}.bbb.ccc`), expiresInSeconds: tokenSeconds }));
    const order: string[] = [];
    const fetchPlaylist = vi.fn(async (url: string): Promise<PlaylistResponse> => {
      order.push(`playlist:${tokenOf(url)}`);
      if (customFetch) return customFetch(url);
      const token = tokenOf(url);
      if (refused(token)) return unauthorized;
      return { status: 200, text: async () => mediaPlaylist(token) };
    });
    const cleanup = attachHlsPlayback({
      video: video as never, url: tokenUrl(firstToken), expiresInSeconds: tokenSeconds, fetchSource, fetchPlaylist,
      loadHls: async () => Hls, random: () => 0,
    });
    await settle();
    const hls = instances[0]!;
    // What hls.js holds once the manifest and the selected level loaded.
    Object.assign(hls, { levels: [{ details: { live, url: heldPlaylistUrl } }, { details: undefined }], audioTracks: [], subtitleTracks: [] });
    hls.startLoad.mockImplementation((position: number) => order.push(`startLoad:${position}`));
    const xhrSetup = hls.config!.xhrSetup! as (xhr: XMLHttpRequest, url: string) => void | Promise<void>;
    /** The URL hls.js would send a request for `url` to. */
    const request = async (url: string) => {
      const xhr = { open: vi.fn() };
      await xhrSetup(xhr as never, url);
      return (xhr.open.mock.calls.at(-1)?.[1] as string | undefined) ?? url;
    };
    return { video, hls, fetchSource, fetchPlaylist, order, request, xhrSetup, cleanup };
  }

  it("re-signs the held VOD playlist once per renewal and sends later segment requests to the new signature, leaving playback untouched", async () => {
    const { video, hls, fetchSource, fetchPlaylist, request } = await vodPlayer();
    expect(await request(signed("seg_3.mp4", firstToken))).toBe(signed("seg_3.mp4", firstToken));

    // Renewal 2 minutes before the 30-minute token expires.
    await vi.advanceTimersByTimeAsync(1_680_000);
    expect(fetchSource).toHaveBeenCalledTimes(1);
    expect(fetchPlaylist).toHaveBeenCalledExactlyOnceWith(tokenUrl("r1.bbb.ccc", variantFile), expect.any(AbortSignal));
    expect(await request(signed("seg_4.mp4", firstToken))).toBe(signed("seg_4.mp4", "r1.bbb.ccc"));
    expect(await request(signed("init.mp4", firstToken))).toBe(signed("init.mp4", "r1.bbb.ccc"));
    // Token-form requests carry the newest token as before.
    expect(await request(tokenUrl(firstToken, variantFile))).toBe(tokenUrl("r1.bbb.ccc", variantFile));
    // No reload, no restart, no play／pause, no seek, no rate change, no native src.
    expect(hls.loadSource).toHaveBeenCalledTimes(1);
    expect(hls.startLoad).not.toHaveBeenCalled();
    expect(video.play).not.toHaveBeenCalled();
    expect(video).toMatchObject({ currentTime: 600, paused: false, playbackRate: 1.5, src: "" });

    await vi.advanceTimersByTimeAsync(1_680_000);
    expect(fetchSource).toHaveBeenCalledTimes(2);
    expect(fetchPlaylist).toHaveBeenCalledTimes(2);
    expect(await request(signed("seg_5.mp4", firstToken))).toBe(signed("seg_5.mp4", "r2.bbb.ccc"));
  });

  it("holds a segment request made while the playlist is being re-signed until the new signature is known", async () => {
    let answer: (value: PlaylistResponse) => void = () => {};
    const { xhrSetup } = await vodPlayer({
      fetchPlaylist: () => new Promise<PlaylistResponse>((resolve) => { answer = resolve; }),
    });
    await vi.advanceTimersByTimeAsync(1_680_000);

    const xhr = { open: vi.fn() };
    const pending = xhrSetup(xhr as never, signed("seg_4.mp4", firstToken));
    expect(pending).toBeInstanceOf(Promise);
    await settle();
    expect(xhr.open).not.toHaveBeenCalled();

    answer({ status: 200, text: async () => mediaPlaylist("r1.bbb.ccc") });
    await pending;
    expect(xhr.open).toHaveBeenCalledExactlyOnceWith("GET", signed("seg_4.mp4", "r1.bbb.ccc"), true);
  });

  it("leaves live playlists to hls.js, which reloads them with the new token", async () => {
    const { fetchPlaylist, request } = await vodPlayer({ live: true });
    await vi.advanceTimersByTimeAsync(1_680_000);
    expect(fetchPlaylist).not.toHaveBeenCalled();
    expect(await request(tokenUrl(firstToken, variantFile))).toBe(tokenUrl("r1.bbb.ccc", variantFile));
    // Segment URIs come from the reloaded playlist; nothing rewrites them.
    expect(await request(signed("seg_9.mp4", "r1.bbb.ccc"))).toBe(signed("seg_9.mp4", "r1.bbb.ccc"));
  });

  it("re-signs before restarting loading after Cloudflare's 401 on a segment signed for an expired token", async () => {
    const { hls, fetchSource, fetchPlaylist, order, request } = await vodPlayer();
    // The scheduled renewal was missed (e.g. a sleeping laptop): segments start failing.
    hls.emit(unauthorizedFragment);
    await settle();

    expect(fetchSource).toHaveBeenCalledTimes(1);
    expect(fetchPlaylist).toHaveBeenCalledTimes(1);
    expect(order).toEqual(["playlist:r1.bbb.ccc", "startLoad:600"]);
    expect(hls.loadSource).toHaveBeenCalledTimes(1);
    expect(await request(signed("seg_2.mp4", firstToken))).toBe(signed("seg_2.mp4", "r1.bbb.ccc"));
  });

  it("does not loop when Cloudflare refuses the renewed token too, and stops after the attempt cap", async () => {
    const { hls, fetchSource, fetchPlaylist } = await vodPlayer({ refused: (token) => token !== firstToken });
    // Every restart meets the same 401 (the segments still carry the old signature).
    hls.startLoad.mockImplementation(() => {
      void Promise.resolve().then(() => hls.emit({ ...unauthorizedFragment, fatal: true }));
    });
    hls.emit(unauthorizedFragment);
    await vi.advanceTimersByTimeAsync(20 * 60_000);

    const attempts = hls.startLoad.mock.calls.length;
    expect(attempts).toBeGreaterThan(0);
    // The immediate attempt plus at most the automatic ones.
    expect(attempts).toBeLessThanOrEqual(HLS_STALL_MAX_AUTO_ATTEMPTS + 1);
    // At most one playlist request per attempt; renewals are limited by the token reuse rule.
    expect(fetchPlaylist.mock.calls.length).toBeLessThanOrEqual(attempts);
    expect(fetchSource.mock.calls.length).toBeLessThanOrEqual(attempts);
    expect(hls.loadSource).toHaveBeenCalledTimes(1);

    // Once the automatic attempts are used up only a scheduled renewal (every 28 min) retries.
    const before = { starts: hls.startLoad.mock.calls.length, playlists: fetchPlaylist.mock.calls.length };
    await vi.advanceTimersByTimeAsync(60 * 60_000);
    expect(hls.startLoad.mock.calls.length - before.starts).toBeLessThanOrEqual(3);
    expect(fetchPlaylist.mock.calls.length - before.playlists).toBeLessThanOrEqual(3);
  });

  it("retries a refresh that failed on the network twice, and a refused one not at all", async () => {
    const failing = await vodPlayer({ fetchPlaylist: () => Promise.reject(new TypeError("Failed to fetch")) });
    await vi.advanceTimersByTimeAsync(1_680_000);
    await vi.advanceTimersByTimeAsync(5 * 60_000);
    expect(failing.fetchPlaylist).toHaveBeenCalledTimes(3);
    expect(await failing.request(signed("seg_2.mp4", firstToken))).toBe(signed("seg_2.mp4", firstToken));
    failing.cleanup();

    const refused = await vodPlayer({ refused: (token) => token !== firstToken });
    await vi.advanceTimersByTimeAsync(1_680_000);
    await vi.advanceTimersByTimeAsync(5 * 60_000);
    expect(refused.fetchPlaylist).toHaveBeenCalledTimes(1);
    refused.cleanup();
  });

  it("takes a uid-form media playlist's new signature from the entry manifest", async () => {
    const heldPlaylistUrl = `https://videodelivery.net/${uid}/manifest/stream.m3u8?p=${firstToken}&s=x`;
    const renewedPlaylistUrl = `https://videodelivery.net/${uid}/manifest/stream.m3u8?p=r1.bbb.ccc&s=y`;
    const { fetchPlaylist, request } = await vodPlayer({
      heldPlaylistUrl,
      fetchPlaylist: async (url) => {
        const parsed = new URL(url);
        if (parsed.pathname.endsWith("/manifest/video.m3u8")) {
          return { status: 200, text: async () => `#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=1\n/${uid}/manifest/stream.m3u8?p=r1.bbb.ccc&s=y\n` };
        }
        return { status: 200, text: async () => mediaPlaylist(parsed.searchParams.get("p")!) };
      },
    });
    await vi.advanceTimersByTimeAsync(1_680_000);
    expect(fetchPlaylist.mock.calls.map(([url]) => url)).toEqual([tokenUrl("r1.bbb.ccc"), renewedPlaylistUrl]);
    expect(await request(heldPlaylistUrl)).toBe(renewedPlaylistUrl);
    expect(await request(signed("seg_1.mp4", firstToken))).toBe(signed("seg_1.mp4", "r1.bbb.ccc"));
  });

  it("never refreshes or rewrites anything for unsigned preview and promo sources", async () => {
    const video = fakeVideo({ currentTime: 30 });
    const { Hls, instances } = fakeHls(true);
    const fetchSource = vi.fn(async () => null);
    const fetchPlaylist = vi.fn();
    const cleanup = attachHlsPlayback({ video: video as never, url: tokenUrl(firstToken), fetchSource, fetchPlaylist, loadHls: async () => Hls });
    await settle();
    Object.assign(instances[0]!, { levels: [{ details: { live: false, url: tokenUrl(firstToken, variantFile) } }] });

    instances[0]!.emit(unauthorizedFragment);
    await vi.advanceTimersByTimeAsync(60 * 60_000);
    expect(instances[0]!.config).toBeUndefined();
    expect(fetchSource).not.toHaveBeenCalled();
    expect(fetchPlaylist).not.toHaveBeenCalled();
    expect(instances[0]!.startLoad).not.toHaveBeenCalled();
    cleanup();
  });
});

describe("native HLS renewal", () => {
  /** Like HTMLMediaElement: assigning src resets playbackRate to defaultPlaybackRate and clears the error. */
  function nativeVideo({ currentTime, paused, playbackRate }: { currentTime: number; paused: boolean; playbackRate: number }) {
    const video = Object.assign(fakeVideo({ nativeHls: true, currentTime, paused }), { playbackRate, defaultPlaybackRate: 1 });
    const assigned: string[] = [];
    let current = "";
    Object.defineProperty(video, "src", {
      get: () => current,
      set: (value: string) => {
        assigned.push(value);
        current = value;
        video.playbackRate = video.defaultPlaybackRate;
        video.error = null;
      },
    });
    return { video, assigned };
  }

  it.each([
    { paused: false, plays: 1 },
    { paused: true, plays: 0 },
  ])("applies the renewed URL at the same position, play state (paused: $paused) and playbackRate", async ({ paused, plays }) => {
    const { video, assigned } = nativeVideo({ currentTime: 900, paused, playbackRate: 1.25 });
    const fetchSource = vi.fn().mockResolvedValue({ playbackUrl: renewedUrl, expiresInSeconds: 1_800 });
    const cleanup = attachHlsPlayback({
      video: video as never, url: firstUrl, expiresInSeconds: 1_800, fetchSource, loadHls: async () => fakeHls(false).Hls,
    });
    await settle();
    // The viewer chose a speed after the first source loaded (that load reset it to 1).
    video.currentTime = 1_500;
    video.playbackRate = 1.25;

    await vi.advanceTimersByTimeAsync(1_680_000);
    expect(assigned).toEqual([firstUrl, renewedUrl]);
    expect(video.playbackRate).toBe(1.25);

    // The new source starts at 0 until its metadata loaded.
    video.currentTime = 0;
    video.fire("loadedmetadata");
    expect(video.currentTime).toBe(1_500);
    expect(video.playbackRate).toBe(1.25);
    expect(video.play).toHaveBeenCalledTimes(plays);
    cleanup();
  });

  it("stops swapping after a few refused sources in a row, and tries again when the viewer presses play", async () => {
    const { video, assigned } = nativeVideo({ currentTime: 300, paused: false, playbackRate: 1 });
    let renewals = 0;
    const fetchSource = vi.fn(async () => ({
      playbackUrl: `https://videodelivery.net/n${++renewals}.bbb.ccc/manifest/video.m3u8`, expiresInSeconds: 1_800,
    }));
    const cleanup = attachHlsPlayback({
      video: video as never, url: firstUrl, expiresInSeconds: 1_800, fetchSource, loadHls: async () => fakeHls(false).Hls,
    });
    await settle();
    // Every new source fails 6 s after it was set (Safari refusing the token), past the 5 s
    // minimum between immediate renewals, so only the recovery cap can end the loop.
    const failLater = () => {
      setTimeout(() => {
        video.error = { code: 2 };
        video.fire("error");
      }, 6_000);
    };
    video.error = { code: 2 };
    video.fire("error");
    // One failure timer per swap.
    let armed = assigned.length;
    const arm = () => {
      if (assigned.length > armed) {
        armed = assigned.length;
        failLater();
      }
    };
    for (let second = 0; second < 5 * 60; second += 1) {
      arm();
      await vi.advanceTimersByTimeAsync(1_000);
    }
    expect(fetchSource).toHaveBeenCalledTimes(NATIVE_MAX_ERROR_RECOVERIES);
    expect(assigned).toHaveLength(1 + NATIVE_MAX_ERROR_RECOVERIES);

    // The viewer asks again: one more renewal and swap.
    video.fire("play");
    await settle();
    expect(fetchSource).toHaveBeenCalledTimes(NATIVE_MAX_ERROR_RECOVERIES + 1);
    expect(assigned).toHaveLength(2 + NATIVE_MAX_ERROR_RECOVERIES);
    cleanup();
  });
});
