import type { CardView } from "./interaction-card-contract";
import { resolveLiveRuntime, type LiveRuntimeCandidate } from "./live-runtime-state";

export type CardClock = { mode: "manual" | "synchronized" | "personal" | "unavailable"; positionSeconds: number | null };
export type CardTimeline = { clock: CardClock; cards: CardView[] };
export type CardPlaybackCandidate = LiveRuntimeCandidate & { isEvergreen?: boolean; evergreenSessionStartAt?: Date | null };

/** 共同場次只相信伺服器時間；既有回放才採個人媒體時間。真直播永不套用影片排程。 */
export function resolveCardClock(live: CardPlaybackCandidate, now: Date): CardClock {
  if (live.streamMode !== "vod") return { mode: "manual", positionSeconds: null };
  if (live.isEvergreen) {
    // 浮動常青場次尚未持久化觀眾 cohort，不能以每次請求重新推算的場次冒充同步。
    const start = live.evergreenSessionStartAt?.getTime();
    const duration = live.video?.durationSec;
    const position = start === undefined ? NaN : (now.getTime() - start) / 1000;
    return start !== undefined && duration && Number.isFinite(position) && position >= 0 && position < duration
      ? { mode: "synchronized", positionSeconds: position }
      : { mode: "unavailable", positionSeconds: null };
  }
  const runtime = resolveLiveRuntime(live, now);
  if (runtime.state === "replay") return { mode: "personal", positionSeconds: null };
  if (runtime.state === "playing") return { mode: "synchronized", positionSeconds: runtime.playbackStartSeconds };
  return { mode: "unavailable", positionSeconds: null };
}

/** 半開區間、不補發；重疊時固定選最晚開始的一題，ID 打破同時開始的平手。 */
export function selectScheduledCard(cards: readonly CardView[], position: number | null): CardView | null {
  if (position === null || !Number.isFinite(position) || position < 0) return null;
  return cards.filter(card => {
    const s = card.configuration.schedule;
    return card.status === "draft" && s?.enabled && position >= s.startSeconds && position < s.startSeconds + s.durationSeconds;
  }).sort((a, b) => b.configuration.schedule!.startSeconds - a.configuration.schedule!.startSeconds || a.id.localeCompare(b.id))[0] ?? null;
}

export function timelinePosition(clock: CardClock, mediaSeconds: number | null, elapsedSeconds: number): number | null {
  if (clock.mode === "personal") return mediaSeconds;
  // 短租約避免斷線、背景節流或休眠後持續展示失效排程；恢復後必須重讀。
  return clock.mode === "synchronized" && clock.positionSeconds !== null && elapsedSeconds >= 0 && elapsedSeconds < 4
    ? clock.positionSeconds + elapsedSeconds : null;
}

/** RTT 是共同時間的不確定區間；邊界有疑慮先不顯示，避免延遲回應補出已過期問題。 */
export function selectTimelineCard(timeline: CardTimeline, mediaSeconds: number | null, age: number, roundTripSeconds: number) {
  const position = timelinePosition(timeline.clock, mediaSeconds, age);
  const card = selectScheduledCard(timeline.cards, position);
  if (timeline.clock.mode !== "synchronized" || !card || position === null) return card;
  return Number.isFinite(roundTripSeconds) && roundTripSeconds >= 0
    && selectScheduledCard(timeline.cards, position + roundTripSeconds)?.id === card.id ? card : null;
}
