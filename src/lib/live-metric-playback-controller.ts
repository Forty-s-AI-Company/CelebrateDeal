import { createPlaybackMetricCollector } from "./live-metric-playback-collector";
import { metricPlaybackReceipt } from "./live-metric-playback-receipt";
import { parseSafeExternalHttpUrl } from "./external-url";

type Media = Parameters<typeof createPlaybackMetricCollector>[2];
type Collector = NonNullable<ReturnType<typeof createPlaybackMetricCollector>>;
function sourceIdentity(value: unknown) {
  if (typeof value !== "object" || value === null) return null;
  const source = value as { protocol?: unknown; playbackUrl?: unknown };
  if (source.protocol === "whep") return typeof source.playbackUrl === "string" && source.playbackUrl.startsWith("/api/live-media?") ? source.playbackUrl : null;
  return typeof source.playbackUrl === "string" ? parseSafeExternalHttpUrl(source.playbackUrl) : null;
}

/** Own successive metric sessions without changing video src/currentTime or
 * reloading HLS. Old unmatched/lost intake stays visible; recovery starts from
 * a NEW server nonce/anchor and never fills the gap with invented samples.
 */
export function createPlaybackMetricController(scope: { vendorId: string; liveId: string }, source: unknown,
  media: Media, now: () => number, fetcher: typeof fetch = fetch) {
  const identity = sourceIdentity(source);
  let active: Collector | null = identity ? createPlaybackMetricCollector(scope, source, media, now, fetcher) : null;
  let stopped = false, ended = false, restart = false, sourceChanged = !identity;
  let pending: Promise<void> | null = null;
  let requestAbort: AbortController | null = null;
  let nextProbeAt = 0;
  let lastNow = now();
  const used = new Set<string>();
  const initial = metricPlaybackReceipt(source);
  if (initial) used.add(initial.metricRequestId.toLowerCase());

  async function get(path: string) {
    const abort = new AbortController(); const timer = setTimeout(() => abort.abort(), 8000);
    requestAbort = abort;
    try {
      const response = await fetcher(path, { method: "GET", credentials: "same-origin", cache: "no-store",
        headers: { "X-CelebrateDeal-Client": "web" }, signal: abort.signal });
      return response.ok ? await response.json() as unknown : null;
    } finally { clearTimeout(timer); if (requestAbort === abort) requestAbort = null; }
  }
  async function recover() {
    await active?.finish();
    if (stopped) return;
    const readiness = await get(`/api/live-metrics/${encodeURIComponent(scope.vendorId)}/${encodeURIComponent(scope.liveId)}/sessions`);
    if (stopped || !readiness || typeof readiness !== "object" || (readiness as { ready?: unknown }).ready !== true) return;
    const query = new URLSearchParams({ vendorId: scope.vendorId, liveId: scope.liveId });
    const fresh = await get(`/api/live-playback-source?${query}`);
    if (stopped) return;
    // A temporary HTTP refusal says nothing about the media identity. Keep
    // the backoff and try again rather than disabling recovery permanently.
    if (fresh === null) return;
    // Binding metadata for another URL to this still-playing element would
    // collect the wrong content. Let the media owner replace its source first.
    if (!identity || sourceIdentity(fresh) !== identity) { sourceChanged = true; return; }
    const receipt = metricPlaybackReceipt(fresh);
    if (!receipt) { sourceChanged = true; return; }
    if (used.has(receipt.metricRequestId.toLowerCase())) return;
    // Same resource bound as the server: retain no unbounded nonce history.
    if (used.size >= 64) { sourceChanged = true; return; }
    used.add(receipt.metricRequestId.toLowerCase());
    active = createPlaybackMetricCollector(scope, fresh, media, now, fetcher);
    restart = false;
    await active?.tick();
    // Successful issuance permits the next genuine replay immediately. A
    // denied/failed recovery retains its backoff across media events.
    const state = active?.state();
    if (state?.delivery && !state.disabled && !state.delivery.rejected && !state.delivery.collectionLost) nextProbeAt = 0;
  }
  async function run() {
    const time = now();
    if (!Number.isFinite(time) || time < lastNow) { sourceChanged = true; await active?.abandon(); return; }
    lastNow = time;
    const state = active?.state();
    const needsRecovery = restart || !active || state?.disabled || state?.delivery?.rejected || state?.delivery?.collectionLost;
    if (needsRecovery) {
      if (time < nextProbeAt || sourceChanged) return;
      nextProbeAt = time + 30000;
      try { await recover(); } catch { /* Same bounded cadence; no nonce is invented. */ }
      return;
    }
    await active?.tick();
  }
  function tick() {
    if (stopped || sourceChanged || ended) return Promise.resolve();
    pending ??= run().finally(() => { pending = null; });
    return pending;
  }
  const onEnded = () => { ended = true; };
  const onPlaying = () => {
    if (ended) { ended = false; restart = true; }
    void tick();
  };
  media.addEventListener("ended", onEnded); media.addEventListener("playing", onPlaying);
  async function finish() {
    stopped = true;
    requestAbort?.abort();
    media.removeEventListener("ended", onEnded); media.removeEventListener("playing", onPlaying);
    // Stop/detach the current collector immediately, including an opening
    // request. Waiting for the controller first would permit a late media bind.
    const current = active;
    const closing = current?.finish();
    if (pending) await pending;
    await closing;
    if (active !== current) await active?.finish();
  }
  return { tick, finish, state() { return { stopped, sourceChanged, ended, restart, attempts: used.size, collector: active?.state() ?? null }; } };
}
