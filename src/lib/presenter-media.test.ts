import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createPresenterMedia } from "./presenter-media";
import { DEFAULT_PRESENTER_LAYOUT } from "./presenter-layout";

class Track extends EventTarget {
  readyState = "live";
  muted = false;
  enabled = true;
  stop = vi.fn(() => { this.readyState = "ended"; });
  constructor(public kind: string) { super(); }
}
class Stream {
  constructor(public tracks: Track[] = []) {}
  getTracks() { return this.tracks; }
  getVideoTracks() { return this.tracks.filter((t) => t.kind === "video"); }
  getAudioTracks() { return this.tracks.filter((t) => t.kind === "audio"); }
  addTrack(track: Track) { if (!this.tracks.includes(track)) this.tracks.push(track); }
  removeTrack(track: Track) { this.tracks = this.tracks.filter((t) => t !== track); }
}
const deferred = <T>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
};

describe("presenter media lifecycle", () => {
  const context = { fillStyle: "", font: "", textAlign: "", fillRect: vi.fn(), fillText: vi.fn(), drawImage: vi.fn() };
  const camera = vi.fn();
  const screen = vi.fn();
  let videos: Array<{ srcObject: unknown; muted: boolean; playsInline: boolean; readyState: number; videoWidth: number; videoHeight: number; play: ReturnType<typeof vi.fn>; pause: ReturnType<typeof vi.fn> }>;
  let output: Stream;
  let canvas: HTMLCanvasElement;
  let capture: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    vi.useFakeTimers(); vi.clearAllMocks();
    videos = [];
    output = new Stream([new Track("video")]);
    capture = vi.fn(() => output);
    canvas = { getContext: () => context, captureStream: capture } as unknown as HTMLCanvasElement;
    vi.stubGlobal("navigator", { mediaDevices: { getUserMedia: camera, getDisplayMedia: screen } });
    vi.stubGlobal("document", { createElement: () => {
      const video = { srcObject: null as unknown, muted: false, playsInline: false, readyState: 2, videoWidth: 1920, videoHeight: 1080, play: vi.fn().mockResolvedValue(undefined), pause: vi.fn() };
      videos.push(video); return video;
    } });
  });
  afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

  it("captures portrait dimensions and locks orientation after output", () => {
    const controller = createPresenterMedia(canvas, vi.fn());
    controller.setLayout({ ...DEFAULT_PRESENTER_LAYOUT, orientation: "portrait" });
    expect([canvas.width, canvas.height]).toEqual([1080, 1920]);
    controller.output();
    expect(() => controller.setLayout(DEFAULT_PRESENTER_LAYOUT)).toThrow("停止傳送");
    expect([canvas.width, canvas.height]).toEqual([1080, 1920]);
    controller.stop();
  });

  it("acquires only on request, retains the output track across layout changes and releases everything", async () => {
    const stream = new Stream([new Track("video"), new Track("audio")]);
    camera.mockResolvedValue(stream);
    const controller = createPresenterMedia(canvas, vi.fn());
    expect(camera).not.toHaveBeenCalled(); expect(screen).not.toHaveBeenCalled();
    await controller.startCamera();
    const first = controller.output();
    controller.setLayout({ ...DEFAULT_PRESENTER_LAYOUT, mode: "picture-in-picture" });
    expect(controller.output()).toBe(first);
    expect(capture).toHaveBeenCalledExactlyOnceWith(30);
    expect(first.getAudioTracks()).toEqual(stream.getAudioTracks());
    const allTracks = [...stream.tracks, ...output.getVideoTracks()];
    controller.stop(); controller.stop();
    for (const track of allTracks) expect(track.stop).toHaveBeenCalledTimes(1);
    expect(videos[0]?.srcObject).toBeNull();
    expect(vi.getTimerCount()).toBe(0);
  });
  it("deduplicates pending requests and releases permissions resolved after unmount", async () => {
    const grant = deferred<Stream>(); camera.mockReturnValue(grant.promise);
    const status = vi.fn();
    const controller = createPresenterMedia(canvas, status);
    const first = controller.startCamera();
    expect(controller.startCamera()).toBe(first);
    controller.stop();
    const stream = new Stream([new Track("video"), new Track("audio")]);
    grant.resolve(stream); await first;
    expect(camera).toHaveBeenCalledTimes(1);
    expect(stream.tracks.every((track) => track.stop.mock.calls.length === 1)).toBe(true);
    expect(videos).toHaveLength(0); expect(status).not.toHaveBeenCalled();
  });
  it("allows retry after permission rejection", async () => {
    camera.mockRejectedValueOnce(new Error("NotAllowedError"));
    const status = vi.fn(); const controller = createPresenterMedia(canvas, status);
    await expect(controller.startCamera()).rejects.toThrow("NotAllowedError");
    expect(status).toHaveBeenLastCalledWith(expect.stringContaining("權限"));
    camera.mockResolvedValueOnce(new Stream([new Track("video")]));
    await controller.startCamera(); expect(videos).toHaveLength(1); controller.stop();
  });
  it("clears muted and ended frames immediately and detaches source listeners", async () => {
    const track = new Track("video"); screen.mockResolvedValue(new Stream([track]));
    const status = vi.fn(); const controller = createPresenterMedia(canvas, status);
    await controller.startScreen();
    expect(context.drawImage).toHaveBeenCalled(); context.drawImage.mockClear();
    track.muted = true; track.dispatchEvent(new Event("mute"));
    vi.advanceTimersByTime(40); expect(context.drawImage).not.toHaveBeenCalled();
    track.muted = false; track.dispatchEvent(new Event("unmute"));
    expect(context.drawImage).toHaveBeenCalled(); context.drawImage.mockClear();
    track.readyState = "ended"; track.dispatchEvent(new Event("ended"));
    expect(videos[0]?.srcObject).toBeNull();
    vi.advanceTimersByTime(40); expect(context.drawImage).not.toHaveBeenCalled();
    controller.stop(); status.mockClear(); track.dispatchEvent(new Event("mute"));
    expect(status).not.toHaveBeenCalled();
  });
  it("replaces old camera tracks and removes their microphone from output", async () => {
    const old = new Stream([new Track("video"), new Track("audio")]);
    const next = new Stream([new Track("video"), new Track("audio")]);
    camera.mockResolvedValueOnce(old).mockResolvedValueOnce(next);
    const controller = createPresenterMedia(canvas, vi.fn());
    await controller.startCamera(); controller.output(); await controller.startCamera();
    expect(old.tracks.every((track) => track.stop.mock.calls.length === 1)).toBe(true);
    expect(output.getAudioTracks()).toEqual(next.getAudioTracks());
    controller.stop();
    await expect(controller.startCamera()).rejects.toThrow("關閉");
    expect(() => controller.output()).toThrow("關閉");
  });
  it("composites transparent output into the broadcast canvas and clears it on camera mute, replacement and stop", async () => {
    const workers: Array<{ send: (data: unknown) => void; terminate: ReturnType<typeof vi.fn> }> = [];
    vi.stubGlobal("Worker", class {
      onmessage?: (event: { data: unknown }) => void;
      terminate = vi.fn(); postMessage = vi.fn();
      constructor() { workers.push(this); }
      send(data: unknown) { this.onmessage?.({ data }); }
    });
    vi.stubGlobal("OffscreenCanvas", class {});
    vi.stubGlobal("createImageBitmap", vi.fn(async () => ({ close: vi.fn() })));
    const old = new Stream([new Track("video"), new Track("audio")]);
    camera.mockResolvedValueOnce(old).mockResolvedValueOnce(new Stream([new Track("video")]));
    const state = vi.fn(); const controller = createPresenterMedia(canvas, vi.fn(), state);
    await controller.startCamera(); const output = controller.output();
    controller.setLayout({ ...DEFAULT_PRESENTER_LAYOUT, mode: "picture-in-picture" });
    controller.setBackgroundRemoval(true);
    const cutout = { width: 640, height: 360, close: vi.fn() };
    workers[0]!.send({ type: "ready" }); workers[0]!.send({ type: "frame", bitmap: cutout, durationMs: 10 });
    context.drawImage.mockClear(); vi.advanceTimersByTime(40);
    expect(context.drawImage).toHaveBeenCalledWith(cutout, expect.any(Number), expect.any(Number), expect.any(Number), expect.any(Number));
    expect(controller.output()).toBe(output);
    old.getVideoTracks()[0]!.muted = true; old.getVideoTracks()[0]!.dispatchEvent(new Event("mute"));
    expect(cutout.close).toHaveBeenCalledOnce(); expect(workers[0]!.terminate).toHaveBeenCalledOnce();
    expect(state).toHaveBeenLastCalledWith("off");
    old.getVideoTracks()[0]!.muted = false;
    controller.setBackgroundRemoval(true); await controller.startCamera();
    expect(workers[1]!.terminate).toHaveBeenCalledOnce(); expect(state).toHaveBeenLastCalledWith("off");
    controller.setBackgroundRemoval(true); controller.stop();
    expect(workers[2]!.terminate).toHaveBeenCalledOnce(); expect(vi.getTimerCount()).toBe(0);
  });
  it("releases acquired tracks while video playback is still pending", async () => {
    const playback = deferred<void>();
    const stream = new Stream([new Track("video"), new Track("audio")]);
    camera.mockImplementation(async () => {
      vi.stubGlobal("document", { createElement: () => {
        const video = { srcObject: null as unknown, muted: false, playsInline: false, readyState: 0, videoWidth: 0, videoHeight: 0, play: vi.fn(() => playback.promise), pause: vi.fn() };
        videos.push(video); return video;
      } });
      return stream;
    });
    const status = vi.fn(); const controller = createPresenterMedia(canvas, status);
    const starting = controller.startCamera();
    await Promise.resolve();
    expect(videos).toHaveLength(1);
    controller.stop();
    expect(stream.tracks.every((track) => track.stop.mock.calls.length === 1)).toBe(true);
    expect(videos[0]?.srcObject).toBeNull();
    playback.resolve(); await starting;
    expect(status).not.toHaveBeenCalled();
  });
});
