import type { createMetricDelivery } from "./live-metric-delivery";

type Delivery = Pick<ReturnType<typeof createMetricDelivery>, "sample" | "reset" | "finish">;
type Media = Pick<HTMLVideoElement, "addEventListener" | "removeEventListener" | "currentTime" | "playbackRate" | "paused" | "ended" | "seeking" | "readyState">;

/** Attach to the existing element, never control playback. Elapsed offsets
 * must be supplied by the session clock; browser wall time is not evidence.
 * A discontinuity invalidates the prior sample even without timeupdate.
 */
export function bindMetricMedia(media: Media, delivery: Delivery, elapsedMs: () => number) {
  let disposed = false;
  let buffering = media.readyState < 3;
  const reset = () => { delivery.reset(); };
  const sample = (stopping = false) => {
    if (disposed) return;
    if (buffering || (!stopping && (media.paused || media.ended)) || media.seeking || media.readyState < 3) { reset(); return; }
    delivery.sample({ elapsedMs: Math.floor(elapsedMs()), mediaMs: Math.round(media.currentTime * 1000),
      rate: media.playbackRate, playing: true });
  };
  const playing = () => { buffering = false; reset(); sample(); };
  const waiting = () => { buffering = true; reset(); };
  // Capture the last continuous interval before discarding its start. The
  // sampler still rejects a delayed event or a seek/rate discontinuity.
  const pause = () => { sample(true); reset(); };
  const ended = () => { sample(true); reset(); void delivery.finish(); };
  const listeners: Array<[string, EventListener]> = [
    ["timeupdate", () => sample()], ["playing", playing], ["waiting", waiting], ["stalled", waiting],
    ["pause", pause], ["seeking", reset], ["seeked", reset], ["ratechange", reset],
    ["emptied", waiting], ["loadstart", waiting], ["error", waiting], ["ended", ended],
  ];
  for (const [name, listener] of listeners) media.addEventListener(name, listener);
  // Attaching after issuance may occur while playback is already in progress.
  sample();
  return () => {
    if (disposed) return;
    disposed = true;
    for (const [name, listener] of listeners) media.removeEventListener(name, listener);
    reset();
    // The admission owner must await finish before releasing access. Detach
    // itself only stops sampling and cannot promise unload delivery.
  };
}
