/** 直接觀察 HTMLMediaElement；暫停不累加，seek 中先隱藏，seeked/重播/恢復重新取樣。 */
export function observeCardMedia(video: HTMLVideoElement, publish: (seconds: number | null) => void) {
  const sample = () => publish(video.seeking || video.ended || video.readyState < 1 || !Number.isFinite(video.currentTime) ? null : video.currentTime);
  const events = ["loadedmetadata", "timeupdate", "seeking", "seeked", "play", "pause", "ended", "emptied", "ratechange"];
  for (const event of events) video.addEventListener(event, sample);
  document.addEventListener("visibilitychange", sample);
  sample();
  return () => {
    for (const event of events) video.removeEventListener(event, sample);
    document.removeEventListener("visibilitychange", sample);
  };
}
