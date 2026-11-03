import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { attachHlsPlayback, type HlsConstructor, type HlsErrorData } from "@/lib/hls-playback-attachment";
import { consumeSourceSwapPlay } from "@/lib/signed-playback-renewal";

const firstUrl = "https://videodelivery.net/aaa.bbb.ccc/manifest/video.m3u8";
const renewedUrl = "https://videodelivery.net/ddd.eee.fff/manifest/video.m3u8";

function fakeVideo({ nativeHls = false, currentTime = 0, paused = false } = {}) {
  const listeners = new Map<string, Set<() => void>>();
  return {
    currentTime,
    paused,
    src: "",
    error: null as { code: number } | null,
    canPlayType: vi.fn(() => (nativeHls ? "maybe" : "")),
    play: vi.fn(() => Promise.resolve()),
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
}

function fakeHls(supported: boolean) {
  const instances: Array<{
    config: { xhrSetup?: (xhr: XMLHttpRequest, url: string) => void } | undefined;
    loadSource: ReturnType<typeof vi.fn>;
    attachMedia: ReturnType<typeof vi.fn>;
    startLoad: ReturnType<typeof vi.fn>;
    destroy: ReturnType<typeof vi.fn>;
    emit: (data: HlsErrorData) => void;
  }> = [];
  class FakeHls {
    static isSupported = () => supported;
    static Events = { ERROR: "hlsError" };
    static ErrorTypes = { NETWORK_ERROR: "networkError" };
    private errorListeners: Array<(event: string, data: HlsErrorData) => void> = [];
    loadSource = vi.fn();
    attachMedia = vi.fn();
    startLoad = vi.fn();
    destroy = vi.fn();
    constructor(public config?: { xhrSetup?: (xhr: XMLHttpRequest, url: string) => void }) {
      instances.push(this as never);
    }
    on(event: string, listener: (event: string, data: HlsErrorData) => void) {
      if (event === "hlsError") this.errorListeners.push(listener);
    }
    emit(data: HlsErrorData) {
      for (const listener of this.errorListeners) listener("hlsError", data);
    }
  }
  return { Hls: FakeHls as unknown as HlsConstructor, instances };
}

async function settle() {
  for (let index = 0; index < 5; index += 1) await Promise.resolve();
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
