import { metricPlaybackReceipt } from "./live-metric-playback-receipt";
import { createMetricCollector } from "./live-metric-collector";
import { createMetricHttpTransport } from "./live-metric-transport";

/** The application and browser QA share this exact source->collector bridge.
 * No local UUID fallback: only an acknowledged durable server intake starts it.
 */
export function createPlaybackMetricCollector(scope: { vendorId: string; liveId: string }, source: unknown,
  media: Parameters<typeof createMetricCollector>[2], now: () => number, fetcher: typeof fetch = fetch) {
  const receipt = metricPlaybackReceipt(source);
  if (!receipt) return null;
  return createMetricCollector(createMetricHttpTransport(scope.vendorId, scope.liveId, fetcher), receipt.metricRequestId, media, now);
}
