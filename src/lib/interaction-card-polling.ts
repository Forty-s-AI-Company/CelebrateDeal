import type { CardView } from "./interaction-card-contract";
import type { CardTimeline } from "./interaction-card-timeline";

type CardSnapshot = { card: CardView | null; timeline: CardTimeline | null; receivedAt: number; roundTripSeconds: number };
type CardPollingCallbacks = {
  onSnapshot(snapshot: CardSnapshot): void;
  onInvalidate(failed: boolean): void;
  onTick(time: number): void;
};

/** 一個觀看工作階段共用輪詢、短租約時鐘與恢復事件，卸載時一併釋放。 */
export function observeInteractionCardPolling(scope: { vendorId: string; liveId: string }, callbacks: CardPollingCallbacks) {
  let active = true;
  let pending: { controller: AbortController; timeout: number } | null = null;
  let revision = 0;
  function cancel() {
    revision++;
    const previous = pending;
    pending = null;
    if (previous) { window.clearTimeout(previous.timeout); previous.controller.abort(); }
  }
  async function refresh() {
    if (!active || pending || document.hidden) return;
    const current = { controller: new AbortController(), timeout: 0 };
    pending = current;
    // abort 後不必等待 fetch settle；直接釋放槽位，下一輪才能恢復。
    current.timeout = window.setTimeout(() => {
      if (!active || pending !== current) return;
      cancel(); callbacks.onInvalidate(true);
    }, 4000);
    const sequence = ++revision;
    const started = performance.now();
    try {
      const response = await fetch(`/api/live-interactions/cards?vendorId=${encodeURIComponent(scope.vendorId)}&liveId=${encodeURIComponent(scope.liveId)}`, { cache: "no-store", signal: current.controller.signal, headers: { "x-celebratedeal-client": "web" } });
      if (!response.ok) throw new Error("互動連線中斷，正在重新連線。");
      const payload = await response.json();
      const received = performance.now();
      if (active && sequence === revision && received - started < 4000) {
        callbacks.onSnapshot({ card: payload.card, timeline: payload.timeline ?? null, receivedAt: received, roundTripSeconds: (received - started) / 1000 });
        callbacks.onTick(received);
      }
    } catch { if (active && sequence === revision) callbacks.onInvalidate(true); }
    finally { window.clearTimeout(current.timeout); if (pending === current) pending = null; }
  }
  function resume() {
    if (!active) return;
    // 先撤銷舊租約，再停止舊請求，恢復後只接受新的 snapshot。
    callbacks.onInvalidate(false); callbacks.onTick(performance.now()); cancel();
    void refresh();
  }
  void refresh();
  const timer = window.setInterval(() => void refresh(), 1500);
  const clock = window.setInterval(() => callbacks.onTick(performance.now()), 100);
  document.addEventListener("visibilitychange", resume);
  window.addEventListener("online", resume);
  return () => {
    if (!active) return;
    active = false; cancel();
    window.clearInterval(timer); window.clearInterval(clock);
    document.removeEventListener("visibilitychange", resume);
    window.removeEventListener("online", resume);
  };
}
