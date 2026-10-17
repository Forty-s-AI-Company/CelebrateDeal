import { describe, expect, it, vi } from "vitest";
import { bindMetricMedia } from "./live-metric-media";
import { createMetricDelivery } from "./live-metric-delivery";

function fixture() {
  const media = Object.assign(new EventTarget(), { currentTime: 0, playbackRate: 1, paused: false, ended: false, seeking: false, readyState: 4 });
  let now = 0;
  const transport = { append: vi.fn(async (rows: readonly { sequence: number }[]) => ({ ok: true as const, lastSequence: rows.at(-1)!.sequence })), close: vi.fn(async () => ({ terminal: true })) };
  const delivery = createMetricDelivery(transport);
  const detach = bindMetricMedia(media, delivery, () => now);
  return { media, transport, delivery, detach, advance(ms: number) { now += ms; media.currentTime += ms / 1000; media.dispatchEvent(new Event("timeupdate")); } };
}

describe("existing media metric binding", () => {
  it.each(["pause", "ended"])("captures the final continuous interval on %s", async (event) => {
    const video = Object.assign(new EventTarget(), { currentTime: 0, playbackRate: 1, paused: false, ended: false, seeking: false, readyState: 4 });
    let elapsed = 0;
    const append = vi.fn(async () => ({ ok: true as const, lastSequence: 0 }));
    const delivery = createMetricDelivery({ append, close: async () => ({ terminal: true }) });
    const detach = bindMetricMedia(video, delivery, () => elapsed);
    elapsed = 250; video.currentTime = 0.25; video.paused = true; video.ended = event === "ended";
    video.dispatchEvent(new Event(event)); await delivery.flush();
    expect(append).toHaveBeenCalledWith([{ sequence: 0, startElapsedMs: 0, endElapsedMs: 250, mediaStartMs: 0, mediaEndMs: 250, rate: 1 }]);
    detach();
  });
  it("collects exposure while playing without changing the media", async () => {
    const f = fixture(); f.advance(1000); await f.delivery.flush();
    expect(f.transport.append.mock.calls[0][0]).toEqual([{ sequence: 0, startElapsedMs: 0, endElapsedMs: 1000, mediaStartMs: 0, mediaEndMs: 1000, rate: 1 }]);
    expect(f.media.paused).toBe(false); f.detach();
  });
  it.each(["pause", "seeking", "ratechange"])("does not bridge a %s discontinuity", async (event) => {
    const f = fixture(); f.media.dispatchEvent(new Event(event)); f.advance(1000);
    await f.delivery.flush(); expect(f.transport.append).not.toHaveBeenCalled(); f.detach();
  });
  it("waits for playing after buffering even if readyState recovers", async () => {
    const f = fixture(); f.media.dispatchEvent(new Event("waiting")); f.advance(1000); f.advance(1000);
    await f.delivery.flush(); expect(f.transport.append).not.toHaveBeenCalled();
    f.media.dispatchEvent(new Event("playing")); f.advance(1000); await f.delivery.flush();
    expect(f.transport.append).toHaveBeenCalledTimes(1); f.detach();
  });
  it("detaches idempotently and leaves release ordering to the owner", async () => {
    const f = fixture(); f.detach(); f.detach(); f.advance(1000);
    f.media.dispatchEvent(new Event("ended")); await f.delivery.flush();
    expect(f.transport.append).not.toHaveBeenCalled(); expect(f.transport.close).not.toHaveBeenCalled();
  });
  it("seals the session when playback ends", async () => {
    const f = fixture(); f.advance(1000); f.media.ended = true; f.media.dispatchEvent(new Event("ended"));
    await f.delivery.flush(); expect(f.transport.close).toHaveBeenCalledExactlyOnceWith(0); f.detach();
  });
});
